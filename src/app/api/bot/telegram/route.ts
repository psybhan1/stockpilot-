import { NextResponse } from "next/server";
import type { Prisma } from "@/lib/prisma";
import { BotChannel } from "@/lib/prisma";

import { isValidTelegramWebhook, sendTelegramMessage } from "@/lib/telegram-bot";
import {
  connectManagerBotChannel,
  readConnectTokenFromText,
} from "@/modules/operator-bot/connect";
import { handleInboundManagerBotMessage } from "@/modules/operator-bot/service";

type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
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
};

export async function POST(request: Request) {
  if (!isValidTelegramWebhook(request)) {
    return NextResponse.json({ message: "Unauthorized Telegram webhook." }, { status: 401 });
  }

  const payload = (await request.json()) as TelegramUpdate;
  const text = payload.message?.text?.trim();
  const chatId = payload.message?.chat?.id;
  const senderId = payload.message?.from?.id;

  if (!text || !chatId || !senderId) {
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

  const result = await handleInboundManagerBotMessage({
    channel: "TELEGRAM",
    senderId: String(chatId),
    senderDisplayName:
      displayName || payload.message?.from?.username || String(senderId),
    text,
    sourceMessageId,
    rawPayload: payload as unknown as Prisma.InputJsonValue,
  });

  if (!result.skipSend && result.reply) {
    await sendTelegramMessage(String(chatId), result.reply);
  }

  return NextResponse.json({
    ok: true,
    purchaseOrderId: result.purchaseOrderId ?? null,
    orderNumber: result.orderNumber ?? null,
  });
}
