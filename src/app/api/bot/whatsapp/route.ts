import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { BotChannel } from "@/lib/prisma";
import {
  buildTwimlEmptyResponse,
  buildTwimlMessageResponse,
  isValidTwilioWebhook,
} from "@/lib/twilio-webhook";
import {
  connectManagerBotChannel,
  readConnectTokenFromText,
} from "@/modules/operator-bot/connect";
import { handleInboundManagerBotMessage } from "@/modules/operator-bot/service";

export async function POST(request: Request) {
  const formData = await request.formData();
  const formFields = new URLSearchParams();

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      formFields.append(key, value);
    }
  }

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
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
      },
    });
  }

  const body = formFields.get("Body")?.trim() ?? "";
  const senderId = formFields.get("From")?.trim() ?? "";

  if (!body || !senderId) {
    return new NextResponse(buildTwimlMessageResponse("I need a message body and sender to process that request."), {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
      },
    });
  }

  const connectToken = readConnectTokenFromText({
    channel: BotChannel.WHATSAPP,
    text: body,
  });

  if (connectToken) {
    const connection = await connectManagerBotChannel({
      channel: BotChannel.WHATSAPP,
      token: connectToken,
      senderId,
      senderDisplayName: formFields.get("ProfileName"),
      sourceMessageId: formFields.get("MessageSid"),
      inboundText: body,
    });

    return new NextResponse(
      connection.skipSend ? buildTwimlEmptyResponse() : buildTwimlMessageResponse(connection.reply),
      {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
      },
    });
  }

  const result = await handleInboundManagerBotMessage({
    channel: "WHATSAPP",
    senderId,
    senderDisplayName: formFields.get("ProfileName"),
    text: body,
    sourceMessageId: formFields.get("MessageSid"),
    rawPayload: Object.fromEntries(formFields.entries()),
  });

  return new NextResponse(result.skipSend ? buildTwimlEmptyResponse() : buildTwimlMessageResponse(result.reply), {
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
    },
  });
}
