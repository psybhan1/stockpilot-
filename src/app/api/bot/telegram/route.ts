import { NextResponse } from "next/server";
import type { Prisma } from "@/lib/prisma";
import { BotChannel } from "@/lib/prisma";

import {
  answerCallbackQuery,
  editTelegramMessage,
  isValidTelegramWebhook,
  sendTelegramMessage,
  sendTelegramTyping,
  type InlineKeyboard,
} from "@/lib/telegram-bot";
import {
  connectManagerBotChannel,
  readConnectTokenFromText,
} from "@/modules/operator-bot/connect";
import { readLocationPairingCode } from "@/modules/operator-bot/connect-primitives";
import { handleInboundManagerBotMessage } from "@/modules/operator-bot/service";
import { handleTelegramCallback } from "@/modules/operator-bot/telegram-callbacks";
import { completeTelegramChannelPairing } from "@/modules/channels/service";
import { env } from "@/lib/env";

type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    voice?: {
      file_id: string;
      duration: number;
      mime_type?: string;
      file_size?: number;
    };
    chat?: {
      id?: number;
    };
    from?: {
      id?: number;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    message?: {
      message_id: number;
      chat: { id: number };
    };
    data?: string;
  };
};

/** Discriminated failure so the caller can tell the user the right thing. */
type VoiceTranscriptionResult =
  | { kind: "ok"; text: string }
  | { kind: "no_api_key" }     // server misconfig — ops-visible, user-soft
  | { kind: "rate_limited" }   // Groq TPD/TPM exhausted
  | { kind: "download_failed" } // Telegram couldn't get the audio
  | { kind: "empty" }           // Whisper returned no words
  | { kind: "error"; detail: string }; // anything else

/**
 * Downloads a voice message from Telegram and transcribes it via Groq
 * Whisper. Returns a discriminated result so the caller can say the
 * right thing to the user instead of a bland "couldn't make out."
 */
async function transcribeVoiceMessage(fileId: string): Promise<VoiceTranscriptionResult> {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const groqKey = process.env.GROQ_API_KEY;

  if (!botToken || !groqKey) return { kind: "no_api_key" };

  try {
    const baseUrl = env.TELEGRAM_BOT_API_BASE_URL.replace(/\/$/, "");

    // Step 1: get the file path from Telegram
    const fileRes = await fetch(`${baseUrl}/bot${botToken}/getFile?file_id=${fileId}`);
    if (!fileRes.ok) return { kind: "download_failed" };

    const fileData = (await fileRes.json()) as {
      ok?: boolean;
      result?: { file_path?: string };
    };
    const filePath = fileData?.result?.file_path;
    if (!filePath) return { kind: "download_failed" };

    // Step 2: download the OGG audio file
    const audioRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
    if (!audioRes.ok) return { kind: "download_failed" };

    const audioBuffer = await audioRes.arrayBuffer();
    const audioBlob = new Blob([audioBuffer], { type: "audio/ogg" });

    // Step 3: send to Groq Whisper for transcription
    const formData = new FormData();
    formData.append("file", audioBlob, "voice.ogg");
    formData.append("model", "whisper-large-v3-turbo");
    formData.append("response_format", "json");

    const whisperRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqKey}`,
      },
      body: formData,
      signal: AbortSignal.timeout(60000),
    });

    if (whisperRes.status === 429) return { kind: "rate_limited" };
    if (!whisperRes.ok) {
      const body = await whisperRes.text().catch(() => "");
      return { kind: "error", detail: `Whisper ${whisperRes.status}: ${body.slice(0, 120)}` };
    }

    const whisperData = (await whisperRes.json()) as { text?: string };
    const transcription = whisperData?.text?.trim();

    if (!transcription) return { kind: "empty" };
    return { kind: "ok", text: transcription };
  } catch (err) {
    return {
      kind: "error",
      detail: err instanceof Error ? err.message.slice(0, 200) : "unknown",
    };
  }
}

export async function POST(request: Request) {
  if (!isValidTelegramWebhook(request)) {
    return NextResponse.json({ message: "Unauthorized Telegram webhook." }, { status: 401 });
  }

  const payload = (await request.json()) as TelegramUpdate;

  // Per-sender rate limit. A single chat flooding us (bot, user typo,
  // network retry storm) must not block other users' messages by
  // hogging the webhook's serialized processing. 15 messages per 60s
  // is well above real human usage (even a manic typer tops at ~5)
  // and low enough to contain abuse.
  const rateLimitKey =
    payload.callback_query?.from?.id ?? payload.message?.from?.id ?? null;
  if (rateLimitKey) {
    const { rateLimit } = await import("@/lib/rate-limit");
    const rl = rateLimit({
      key: `tg:${rateLimitKey}`,
      windowMs: 60_000,
      max: 15,
    });
    if (!rl.allowed) {
      const chatId =
        payload.callback_query?.message?.chat?.id ?? payload.message?.chat?.id;
      if (chatId) {
        await sendTelegramMessage(
          String(chatId),
          `⚠ You're sending messages too fast — give me ${rl.retryAfterSec}s and try again.`
        ).catch(() => null);
      }
      return NextResponse.json({ ok: false, rateLimited: true }, { status: 200 });
    }
  }

  try {
    return await handleTelegramUpdate(payload);
  } catch (err) {
    // FINAL SAFETY NET. If anything else in the webhook throws
    // (DB outage, Prisma connection pool, unexpected model error,
    // etc.) we still want the user to get SOME reply rather than
    // stare at a chat that looks dead. Best-effort — if even this
    // try/catch's body fails, Telegram will at least see our 200
    // and not retry the webhook.
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[telegram webhook] unhandled error:", errMsg);
    const chatId =
      payload.callback_query?.message?.chat?.id ??
      payload.message?.chat?.id ??
      null;
    if (chatId) {
      await sendTelegramMessage(
        String(chatId),
        "⚠ Something went wrong on my end. Give me a minute and try again — if it keeps happening, your manager can check Settings → Alerts."
      ).catch(() => null);
    }
    // Always return 200 so Telegram doesn't hammer us with retries
    // on transient failures.
    return NextResponse.json({ ok: false, handled: "safety_net" });
  }
}

async function handleTelegramUpdate(payload: TelegramUpdate) {

  // ── Inline-button callback (one-click order approval / cancel etc.) ──
  if (payload.callback_query) {
    const cb = payload.callback_query;
    const data = cb.data ?? "";
    const cbChatId = cb.message?.chat?.id;
    const cbMessageId = cb.message?.message_id;

    // Show a typing indicator in the chat — approve-and-dispatch can
    // take a second or two (supplier email send), so give the user
    // immediate feedback that the tap registered.
    if (cbChatId) void sendTelegramTyping(String(cbChatId));

    const result = await handleTelegramCallback(data, {
      chatId: cbChatId ? String(cbChatId) : "",
      senderId: String(cb.from.id),
    });

    // Toast above the button (closes the spinner).
    await answerCallbackQuery(cb.id, result.toast || undefined);

    // Edit the original message in place so the user immediately sees
    // the action outcome. The handler tells us what keyboard (if any)
    // the new message should carry — e.g. a Retry button on a failed
    // dispatch, or no keyboard on a terminal state.
    if (result.editText && cbChatId && cbMessageId) {
      await editTelegramMessage(String(cbChatId), cbMessageId, result.editText, {
        parseMode: "Markdown",
        replyMarkup: result.editKeyboard === undefined ? null : result.editKeyboard,
      });
    }

    return NextResponse.json({ ok: result.ok });
  }

  const chatId = payload.message?.chat?.id;
  const senderId = payload.message?.from?.id;

  // Resolve the message text — either a direct text or a transcribed voice message
  let text = payload.message?.text?.trim() ?? null;
  let isVoice = false;
  let voiceFailure: VoiceTranscriptionResult["kind"] | null = null;

  if (!text && payload.message?.voice?.file_id) {
    const transcription = await transcribeVoiceMessage(payload.message.voice.file_id);
    if (transcription.kind === "ok") {
      text = transcription.text.trim();
      isVoice = true;
    } else {
      voiceFailure = transcription.kind;
      isVoice = true;
    }
  }

  // Normalise: strip whitespace-only messages. Previously a voice
  // message that transcribed to "   " slipped through and the user
  // got no feedback at all. Now we tell them we couldn't hear.
  if (text && text.length === 0) text = null;

  if (!chatId || !senderId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (!text) {
    if (isVoice) {
      // Match the reply to the actual failure so the user knows what
      // to do. "Couldn't make out" is only right for empty/noisy audio.
      const voiceReply: Record<VoiceTranscriptionResult["kind"], string> = {
        ok: "", // won't hit this branch
        empty:
          "I couldn't make out your voice message — try again, maybe a bit louder or closer to the mic.",
        no_api_key:
          "Voice transcription is off on this server. Please type your message instead.",
        rate_limited:
          "Voice transcription is busy right now — give me a minute, or type your message.",
        download_failed:
          "I couldn't download your voice message from Telegram. Try sending it again.",
        error:
          "Something went wrong transcribing your voice message. Please type it instead.",
      };
      await sendTelegramMessage(
        String(chatId),
        voiceReply[voiceFailure ?? "empty"] ?? voiceReply.empty
      );
    }
    return NextResponse.json({ ok: true, ignored: true });
  }

  const displayName = [payload.message?.from?.first_name, payload.message?.from?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const connectToken = readConnectTokenFromText({
    channel: BotChannel.TELEGRAM,
    text,
  });
  const sourceMessageId =
    typeof payload.update_id === "number"
      ? `telegram-update-${payload.update_id}`
      : typeof payload.message?.message_id === "number"
        ? `telegram-message-${payload.message.message_id}`
        : null;

  // Location-level pairing code (SB-XXXXXX) — connects the whole location's
  // notification channel, not an individual user's bot access.
  const locationPairingCode = readLocationPairingCode(text);
  if (locationPairingCode) {
    const result = await completeTelegramChannelPairing({
      pairingCode: locationPairingCode,
      chatId: String(chatId),
      senderDisplayName: displayName || payload.message?.from?.username || String(senderId),
    });

    const reply = result.ok
      ? `✅ This chat is now connected to *${result.locationName}* on StockPilot.\n\nStock alerts and order approvals will be sent here automatically.`
      : result.reason === "Code expired"
        ? "⏱ That code has expired. Open StockPilot → Settings → Channels → Telegram and generate a new code."
        : "❌ Pairing code not recognised. Open StockPilot → Settings → Channels → Telegram and copy the current code.";

    await sendTelegramMessage(String(chatId), reply);
    return NextResponse.json({ ok: result.ok, pairingCode: true });
  }

  if (connectToken) {
    const connection = await connectManagerBotChannel({
      channel: BotChannel.TELEGRAM,
      token: connectToken,
      senderId: String(chatId),
      senderDisplayName: displayName || payload.message?.from?.username || String(senderId),
      telegramUsername: payload.message?.from?.username ?? null,
      sourceMessageId,
      inboundText: text,
    });

    if (!connection.skipSend && connection.reply) {
      await sendTelegramMessage(String(chatId), connection.reply);
    }

    return NextResponse.json({
      ok: connection.ok,
      status: connection.status,
    });
  }

  // Hard 45s ceiling on the whole bot turn. If the underlying agent
  // is stuck (Groq 30s timeout × 3 retries, metadata fetch hanging,
  // etc.) we don't want the webhook to block forever — Telegram
  // retries after ~60s on its end, which creates duplicate-processing
  // storms. Return a safe "try again" instead.
  const result = await Promise.race([
    handleInboundManagerBotMessage({
      channel: "TELEGRAM",
      senderId: String(chatId),
      senderDisplayName:
        displayName || payload.message?.from?.username || String(senderId),
      text,
      sourceMessageId,
      rawPayload: {
        ...(payload as unknown as Record<string, unknown>),
        isVoiceTranscription: isVoice,
      } as unknown as Prisma.InputJsonValue,
    }),
    new Promise<{
      ok: boolean;
      reply: string;
      purchaseOrderId?: string | null;
      orderNumber?: string | null;
      skipSend?: boolean;
    }>((resolve) =>
      setTimeout(
        () =>
          resolve({
            ok: false,
            reply:
              "⌛ Taking longer than expected — try again in a moment. Complex operations like searching Amazon can take 30+ seconds.",
            skipSend: false,
          }),
        45000
      )
    ),
  ]);

  if (!result.skipSend && result.reply) {
    // If the bot just drafted a purchase order, attach inline approval
    // buttons so the manager can approve/send or cancel in one tap.
    const keyboard: InlineKeyboard | undefined = result.purchaseOrderId
      ? [
          [
            {
              text: "✅ Approve & send",
              callback_data: `po_approve:${result.purchaseOrderId}`,
            },
            {
              text: "✖ Cancel",
              callback_data: `po_cancel:${result.purchaseOrderId}`,
            },
          ],
        ]
      : undefined;
    await sendTelegramMessage(String(chatId), result.reply, {
      parseMode: "Markdown",
      replyMarkup: keyboard,
    });
  }

  return NextResponse.json({
    ok: true,
    purchaseOrderId: result.purchaseOrderId ?? null,
    orderNumber: result.orderNumber ?? null,
    isVoiceTranscription: isVoice,
  });
}
