import { BotChannel, NotificationChannel } from "@/lib/prisma";
import type { Prisma } from "@/lib/prisma";

import { createAuditLogTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendTelegramMessage } from "@/lib/telegram-bot";
import {
  connectManagerBotChannel,
  isPublicAppUrl,
  readConnectTokenFromText,
} from "@/modules/operator-bot/connect";
import { handleInboundManagerBotMessage } from "@/modules/operator-bot/service";
import { TwilioWhatsAppNotificationProvider } from "@/providers/notification/twilio-whatsapp";

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

type TwilioMessageRecord = {
  sid?: string;
  body?: string;
  from?: string;
  to?: string;
  direction?: string;
  status?: string;
  date_created?: string;
};

export async function pollInboundBotChannels() {
  if (isPublicAppUrl(env.APP_URL)) {
    return;
  }

  await Promise.allSettled([pollTelegramUpdates(), pollTwilioWhatsAppMessages()]);
}

async function pollTelegramUpdates() {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return;
  }

  const response = await fetch(
    `${env.TELEGRAM_BOT_API_BASE_URL.replace(/\/$/, "")}/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates?limit=25&timeout=0`,
    {
      cache: "no-store",
    }
  ).catch(() => null);

  if (!response?.ok) {
    return;
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        ok?: boolean;
        result?: TelegramUpdate[];
      }
    | null;

  if (!payload?.ok || !Array.isArray(payload.result) || payload.result.length === 0) {
    return;
  }

  const updates = payload.result
    .filter((update) => typeof update.update_id === "number")
    .sort((left, right) => (left.update_id ?? 0) - (right.update_id ?? 0));

  const sourceIds = updates.map((update) => `telegram-update-${update.update_id}`);
  const processedSourceIds = await getProcessedSourceIds(sourceIds);

  for (const update of updates) {
    const sourceMessageId = `telegram-update-${update.update_id}`;
    if (processedSourceIds.has(sourceMessageId)) {
      continue;
    }

    const text = update.message?.text?.trim();
    const chatId = update.message?.chat?.id;
    const senderId = update.message?.from?.id;

    if (!text || !chatId || !senderId) {
      continue;
    }

    const displayName = [update.message?.from?.first_name, update.message?.from?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();

    const connectToken = readConnectTokenFromText({
      channel: BotChannel.TELEGRAM,
      text,
    });

    if (connectToken) {
      const connection = await connectManagerBotChannel({
        channel: BotChannel.TELEGRAM,
        token: connectToken,
        senderId: String(chatId),
        senderDisplayName: displayName || update.message?.from?.username || String(senderId),
        telegramUsername: update.message?.from?.username ?? null,
        sourceMessageId,
      });

      await sendTelegramMessage(String(chatId), connection.reply);
      continue;
    }

    const result = await handleInboundManagerBotMessage({
      channel: "TELEGRAM",
      senderId: String(senderId),
      senderDisplayName: displayName || update.message?.from?.username || String(senderId),
      text,
      sourceMessageId,
      rawPayload: update as unknown as Prisma.InputJsonValue,
    });

    await sendTelegramMessage(String(chatId), result.reply);
  }

  const highestUpdateId = updates.at(-1)?.update_id;

  if (typeof highestUpdateId === "number") {
    await fetch(
      `${env.TELEGRAM_BOT_API_BASE_URL.replace(/\/$/, "")}/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates?offset=${highestUpdateId + 1}&limit=1&timeout=0`,
      {
        cache: "no-store",
      }
    ).catch(() => null);
  }
}

async function pollTwilioWhatsAppMessages() {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_WHATSAPP_FROM) {
    return;
  }

  const toNumber = normalizeTwilioAddress(env.TWILIO_WHATSAPP_FROM);
  const authHeader = `Basic ${Buffer.from(
    `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`
  ).toString("base64")}`;

  const url = new URL(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`
  );
  url.searchParams.set("To", toNumber);
  url.searchParams.set("PageSize", "20");

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader,
    },
    cache: "no-store",
  }).catch(() => null);

  if (!response?.ok) {
    return;
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        messages?: TwilioMessageRecord[];
      }
    | null;

  if (!payload?.messages?.length) {
    return;
  }

  const inboundMessages = payload.messages
    .filter((message) => {
      const direction = message.direction?.toLowerCase() ?? "";
      return Boolean(message.sid && message.body && message.from) && direction.startsWith("inbound");
    })
    .sort((left, right) => {
      const leftDate = Date.parse(left.date_created ?? "");
      const rightDate = Date.parse(right.date_created ?? "");
      return leftDate - rightDate;
    });

  const processedSourceIds = await getProcessedSourceIds(
    inboundMessages
      .map((message) => message.sid)
      .filter((messageSid): messageSid is string => Boolean(messageSid))
  );

  const provider = new TwilioWhatsAppNotificationProvider({
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    fromNumber: env.TWILIO_WHATSAPP_FROM,
  });

  for (const message of inboundMessages) {
    if (!message.sid || processedSourceIds.has(message.sid)) {
      continue;
    }

    const body = message.body?.trim() ?? "";
    const senderId = message.from?.trim() ?? "";

    if (!body || !senderId) {
      continue;
    }

    const connectToken = readConnectTokenFromText({
      channel: BotChannel.WHATSAPP,
      text: body,
    });

    const reply = connectToken
      ? (
          await connectManagerBotChannel({
            channel: BotChannel.WHATSAPP,
            token: connectToken,
            senderId,
            sourceMessageId: message.sid,
          })
        ).reply
      : (
          await handleInboundManagerBotMessage({
            channel: "WHATSAPP",
            senderId,
            senderDisplayName: null,
            text: body,
            sourceMessageId: message.sid,
            rawPayload: message as unknown as Prisma.InputJsonValue,
          })
        ).reply;

    await provider.sendNotification({
      channel: NotificationChannel.WHATSAPP,
      recipient: senderId,
      body: reply,
    });

    await db.$transaction(async (tx) => {
      await createAuditLogTx(tx, {
        action: "bot.poll_reply_sent",
        entityType: "botChannel",
        entityId: message.sid!,
        details: {
          channel: BotChannel.WHATSAPP,
          recipient: senderId,
        },
      });
    });
  }
}

async function getProcessedSourceIds(sourceIds: string[]) {
  if (!sourceIds.length) {
    return new Set<string>();
  }

  const logs = await db.auditLog.findMany({
    where: {
      entityId: {
        in: sourceIds,
      },
      action: {
        in: [
          "bot.inbound_received",
          "bot.inbound_unlinked",
          "bot.connect_succeeded",
          "bot.connect_expired",
          "bot.connect_conflict",
          "bot.connect_invalid",
          "bot.connect_processed",
          "bot.poll_reply_sent",
        ],
      },
    },
    select: {
      entityId: true,
    },
  });

  return new Set(logs.map((log) => log.entityId));
}

function normalizeTwilioAddress(value: string) {
  return value.startsWith("whatsapp:") ? value : `whatsapp:${value}`;
}
