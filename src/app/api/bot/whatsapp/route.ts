import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { BotChannel } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import {
  buildTwimlEmptyResponse,
  buildTwimlMessageResponse,
  isValidTwilioWebhook,
} from "@/lib/twilio-webhook";
import { transcribeWhatsAppVoice } from "@/lib/whatsapp-bot";
import {
  connectManagerBotChannel,
  readConnectTokenFromText,
} from "@/modules/operator-bot/connect";
import { completeWhatsAppChannelPairing } from "@/modules/channels/service";
import { handleInboundManagerBotMessage } from "@/modules/operator-bot/service";

const XML_HEADERS = { "Content-Type": "text/xml; charset=utf-8" };

/** Detects a StockPilot location pairing code like "SB-AB1234" */
function readLocationPairingCode(text: string): string | null {
  const match = text.trim().match(/^(SB-[A-Z0-9]{6})$/i);
  return match ? match[1].toUpperCase() : null;
}

export async function POST(request: Request) {
  try {
    return await handleWhatsAppWebhook(request);
  } catch (err) {
    // Safety net: any unhandled throw (DB outage, provider error, etc.)
    // must still return a TwiML reply so the user sees *something*
    // instead of a silent 500. Twilio would retry 5xx and spam the
    // user's chat with duplicates.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[whatsapp webhook] unhandled error:", message);
    return new NextResponse(
      buildTwimlMessageResponse(
        "⚠ Something went wrong on my end. Give me a minute and try again — if it keeps happening, your manager can check Settings → Alerts."
      ),
      { headers: XML_HEADERS }
    );
  }
}

async function handleWhatsAppWebhook(request: Request) {
  // ── Parse form fields ───────────────────────────────────────────────────────
  const formData = await request.formData();
  const formFields = new URLSearchParams();
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") formFields.append(key, value);
  }

  // ── Validate Twilio signature ───────────────────────────────────────────────
  const webhookUrl = `${env.APP_URL.replace(/\/$/, "")}/api/bot/whatsapp`;
  const isValid = isValidTwilioWebhook({
    authToken: env.TWILIO_AUTH_TOKEN,
    signature: request.headers.get("x-twilio-signature"),
    url: webhookUrl,
    formFields,
  });

  if (!isValid) {
    return new NextResponse(buildTwimlMessageResponse("Webhook signature validation failed."), {
      status: 401,
      headers: XML_HEADERS,
    });
  }

  const senderId = formFields.get("From")?.trim() ?? "";
  const profileName = formFields.get("ProfileName") ?? null;
  const messageSid = formFields.get("MessageSid") ?? null;

  if (!senderId) {
    return new NextResponse(buildTwimlEmptyResponse(), { headers: XML_HEADERS });
  }

  // Per-sender rate limit — matches the Telegram route. 15 messages
  // per 60s is well above real human usage and contains abuse /
  // retry storms without blocking other users.
  const rl = rateLimit({ key: `wa:${senderId}`, windowMs: 60_000, max: 15 });
  if (!rl.allowed) {
    return new NextResponse(
      buildTwimlMessageResponse(
        `⚠ You're sending messages too fast — give me ${rl.retryAfterSec}s and try again.`
      ),
      { headers: XML_HEADERS }
    );
  }

  // ── Resolve message text (text or transcribed voice) ───────────────────────
  let text = formFields.get("Body")?.trim() ?? "";
  let isVoice = false;

  if (!text) {
    // Twilio sends media as MediaUrl0, MediaContentType0 (up to MediaUrl9)
    const mediaUrl = formFields.get("MediaUrl0");
    const mediaType = formFields.get("MediaContentType0") ?? "";

    if (mediaUrl && (mediaType.includes("audio") || mediaType.includes("ogg") || mediaType.includes("amr"))) {
      const transcription = await transcribeWhatsAppVoice(mediaUrl, mediaType);
      if (transcription) {
        text = transcription;
        isVoice = true;
      }
    }
  }

  if (!text) {
    // No text and no transcribable voice — ignore silently
    return new NextResponse(buildTwimlEmptyResponse(), { headers: XML_HEADERS });
  }

  // ── Location-level pairing code (SB-XXXXXX) ────────────────────────────────
  const locationPairingCode = readLocationPairingCode(text);
  if (locationPairingCode) {
    const result = await completeWhatsAppChannelPairing({
      pairingCode: locationPairingCode,
      phone: senderId,
      senderDisplayName: profileName,
    });

    const reply = result.ok
      ? `✅ This WhatsApp number is now connected to *${result.locationName}* on StockPilot.\n\nStock alerts and order approvals will be sent here automatically.`
      : result.reason === "Code expired"
        ? "⏱ That code has expired. Open StockPilot → Settings → Channels → WhatsApp and generate a new code."
        : "❌ Pairing code not recognised. Open StockPilot → Settings → Channels → WhatsApp and copy the current code.";

    return new NextResponse(buildTwimlMessageResponse(reply), { headers: XML_HEADERS });
  }

  // ── Personal bot connect token ──────────────────────────────────────────────
  const connectToken = readConnectTokenFromText({ channel: BotChannel.WHATSAPP, text });
  if (connectToken) {
    const connection = await connectManagerBotChannel({
      channel: BotChannel.WHATSAPP,
      token: connectToken,
      senderId,
      senderDisplayName: profileName,
      sourceMessageId: messageSid,
      inboundText: text,
    });

    return new NextResponse(
      connection.skipSend ? buildTwimlEmptyResponse() : buildTwimlMessageResponse(connection.reply),
      { headers: XML_HEADERS }
    );
  }

  // ── Regular bot message ─────────────────────────────────────────────────────
  // Hard 45s ceiling on the whole turn — mirrors the Telegram route.
  // If the underlying agent hangs (LLM timeout × retries, metadata
  // fetch stuck, etc.) we don't want Twilio to time us out at ~15s
  // and retry; we'd rather return a human-friendly "try again."
  //
  // Wrap the inner work in .catch() so a late rejection (after the
  // timeout arm wins) doesn't become an unhandled promise rejection.
  const inner = handleInboundManagerBotMessage({
    channel: "WHATSAPP",
    senderId,
    senderDisplayName: profileName,
    text,
    sourceMessageId: messageSid,
    rawPayload: {
      ...Object.fromEntries(formFields.entries()),
      isVoiceTranscription: isVoice,
    },
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[whatsapp webhook] agent throw:", msg);
    return {
      ok: false,
      reply:
        "⚠ I hit an error processing that. Try again in a moment — if it keeps happening your manager can check Settings → Alerts.",
      skipSend: false,
    };
  });

  const result = await Promise.race([
    inner,
    new Promise<{ ok: boolean; reply: string; skipSend?: boolean }>((resolve) =>
      setTimeout(
        () =>
          resolve({
            ok: false,
            reply:
              "⌛ Taking longer than expected — try again in a moment. Complex operations can take 30+ seconds.",
            skipSend: false,
          }),
        45000
      )
    ),
  ]);

  return new NextResponse(
    result.skipSend ? buildTwimlEmptyResponse() : buildTwimlMessageResponse(result.reply),
    { headers: XML_HEADERS }
  );
}
