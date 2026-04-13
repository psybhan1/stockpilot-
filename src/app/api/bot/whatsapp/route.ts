import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { BotChannel } from "@/lib/prisma";
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
  const result = await handleInboundManagerBotMessage({
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

  return new NextResponse(
    result.skipSend ? buildTwimlEmptyResponse() : buildTwimlMessageResponse(result.reply),
    { headers: XML_HEADERS }
  );
}
