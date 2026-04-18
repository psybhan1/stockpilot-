import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { BotChannel } from "@/lib/prisma";
import {
  buildTwimlEmptyResponse,
  buildTwimlMessageResponse,
  isValidTwilioWebhook,
} from "@/lib/twilio-webhook";
import {
  downloadTwilioMediaAsDataUrl,
  isSupportedImageContentType,
  transcribeWhatsAppVoice,
} from "@/lib/whatsapp-bot";
import {
  connectManagerBotChannel,
  readConnectTokenFromText,
} from "@/modules/operator-bot/connect";
import { readLocationPairingCode } from "@/modules/operator-bot/connect-primitives";
import { completeWhatsAppChannelPairing } from "@/modules/channels/service";
import { handleInboundManagerBotMessage } from "@/modules/operator-bot/service";

const XML_HEADERS = { "Content-Type": "text/xml; charset=utf-8" };

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

  // ── Resolve message text + media (text, voice transcription, image) ────────
  let text = formFields.get("Body")?.trim() ?? "";
  let isVoice = false;
  const imageDataUrls: string[] = [];

  const mediaUrl = formFields.get("MediaUrl0");
  const mediaType = formFields.get("MediaContentType0") ?? "";

  if (mediaUrl) {
    if (!text && (mediaType.includes("audio") || mediaType.includes("ogg") || mediaType.includes("amr"))) {
      const transcription = await transcribeWhatsAppVoice(mediaUrl, mediaType);
      if (transcription) {
        text = transcription;
        isVoice = true;
      }
    } else if (isSupportedImageContentType(mediaType)) {
      // Image — download, base64 it, hand to the multimodal agent.
      // Caption (if any) arrived as Body; we keep it as `text`.
      const dataUrl = await downloadTwilioMediaAsDataUrl(mediaUrl, mediaType);
      if (dataUrl) imageDataUrls.push(dataUrl);
    }
  }

  if (!text && imageDataUrls.length === 0) {
    // No text, no voice, no image — ignore silently (e.g. unsupported
    // media type like a stray PDF). Previously a no-body webhook
    // burned a TwiML response and a Twilio delivery cost for nothing.
    return new NextResponse(buildTwimlEmptyResponse(), { headers: XML_HEADERS });
  }

  // ── Location-level pairing code (SB-XXXXXX) ────────────────────────────────
  // Pairing / connect tokens are text-only flows; skip them when
  // the inbound was image-only so we don't accidentally parse the
  // caption (which may be empty) against the location-code regex.
  const locationPairingCode = text ? readLocationPairingCode(text) : null;
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
  const connectToken = text
    ? readConnectTokenFromText({ channel: BotChannel.WHATSAPP, text })
    : null;
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
    images: imageDataUrls.length > 0 ? imageDataUrls : undefined,
    rawPayload: {
      ...Object.fromEntries(formFields.entries()),
      isVoiceTranscription: isVoice,
      hasImage: imageDataUrls.length > 0,
    },
  });

  return new NextResponse(
    result.skipSend ? buildTwimlEmptyResponse() : buildTwimlMessageResponse(result.reply),
    { headers: XML_HEADERS }
  );
}
