import { NextResponse, after } from "next/server";

import { env } from "@/lib/env";
import { BotChannel } from "@/lib/prisma";
import {
  buildTwimlEmptyResponse,
  buildTwimlMessageResponse,
  isValidTwilioWebhook,
} from "@/lib/twilio-webhook";
import { sendWhatsAppMessage, transcribeWhatsAppVoice } from "@/lib/whatsapp-bot";
import {
  connectManagerBotChannel,
  readConnectTokenFromText,
} from "@/modules/operator-bot/connect";
import { completeWhatsAppChannelPairing } from "@/modules/channels/service";
import {
  handleInboundManagerBotMessage,
  type BotHandlingResult,
} from "@/modules/operator-bot/service";

const XML_HEADERS = { "Content-Type": "text/xml; charset=utf-8" };

// Twilio's webhook receiver times out around 15s. We race the agent at
// 12s so there's headroom for network + TwiML round-trip, and defer the
// rest of the work to an after() callback that sends the real reply via
// the Twilio REST API once the agent finishes.
const AGENT_TIMEOUT_MS = 12_000;

/** Detects a StockPilot location pairing code like "SB-AB1234" */
function readLocationPairingCode(text: string): string | null {
  const match = text.trim().match(/^(SB-[A-Z0-9]{6})$/i);
  return match ? match[1].toUpperCase() : null;
}

export async function POST(request: Request) {
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

  // Per-sender rate limit — matches the Telegram webhook. A single
  // number flooding us (bot, user retry storm, Twilio redelivery bug)
  // must not block other users' messages. 15 per 60s is well above
  // real human usage but low enough to contain abuse.
  const { rateLimit } = await import("@/lib/rate-limit");
  const rl = rateLimit({ key: `wa:${senderId}`, windowMs: 60_000, max: 15 });
  if (!rl.allowed) {
    return new NextResponse(
      buildTwimlMessageResponse(
        `⚠ You're sending messages too fast — give me ${rl.retryAfterSec}s and try again.`
      ),
      { headers: XML_HEADERS }
    );
  }

  try {
    return await handleWhatsAppRequest({
      formFields,
      senderId,
      profileName,
      messageSid,
    });
  } catch (err) {
    // FINAL SAFETY NET. Mirrors the Telegram webhook. If anything below
    // throws (DB outage, Prisma pool, unexpected model error, etc.) the
    // user should still get SOME reply instead of a silent failure.
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[whatsapp webhook] unhandled error:", errMsg);
    return new NextResponse(
      buildTwimlMessageResponse(
        "⚠ Something went wrong on my end. Give me a minute and try again — if it keeps happening, your manager can check Settings → Alerts."
      ),
      { headers: XML_HEADERS }
    );
  }
}

async function handleWhatsAppRequest(args: {
  formFields: URLSearchParams;
  senderId: string;
  profileName: string | null;
  messageSid: string | null;
}) {
  const { formFields, senderId, profileName, messageSid } = args;

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
  // Race the agent against AGENT_TIMEOUT_MS. If it finishes in time we
  // reply in the TwiML response. If it takes longer we tell the user
  // we're still working on it and push the real reply out-of-band via
  // the Twilio REST API once the agent is done.
  const handlerPromise = handleInboundManagerBotMessage({
    channel: "WHATSAPP",
    senderId,
    senderDisplayName: profileName,
    text,
    sourceMessageId: messageSid,
    rawPayload: {
      ...Object.fromEntries(formFields.entries()),
      isVoiceTranscription: isVoice,
    },
  });

  const raced = await Promise.race([
    handlerPromise.then(
      (result): { kind: "done"; result: BotHandlingResult } => ({ kind: "done", result }),
      (err: unknown): { kind: "error"; err: unknown } => ({ kind: "error", err })
    ),
    new Promise<{ kind: "timeout" }>((resolve) =>
      setTimeout(() => resolve({ kind: "timeout" }), AGENT_TIMEOUT_MS)
    ),
  ]);

  if (raced.kind === "timeout") {
    // Continue waiting for the agent and send the real reply via REST
    // after the TwiML response flushes. Swallow errors so we never
    // crash the deferred task — the user already got an ack reply.
    after(async () => {
      try {
        const result = await handlerPromise;
        if (!result.skipSend && result.reply) {
          await sendWhatsAppMessage(senderId, result.reply).catch(() => null);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("[whatsapp webhook] deferred handler error:", errMsg);
        await sendWhatsAppMessage(
          senderId,
          "⚠ Something went wrong on my end. Give me a minute and try again."
        ).catch(() => null);
      }
    });

    return new NextResponse(
      buildTwimlMessageResponse(
        "⌛ Still working on it — I'll reply in a moment. Complex operations like searching Amazon can take 30+ seconds."
      ),
      { headers: XML_HEADERS }
    );
  }

  if (raced.kind === "error") {
    // Re-throw so the outer safety net catches it and returns the
    // generic "something went wrong" reply.
    throw raced.err;
  }

  const result = raced.result;
  return new NextResponse(
    result.skipSend ? buildTwimlEmptyResponse() : buildTwimlMessageResponse(result.reply),
    { headers: XML_HEADERS }
  );
}
