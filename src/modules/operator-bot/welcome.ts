import { NotificationChannel } from "@/lib/prisma";
import { env } from "@/lib/env";
import { sendTelegramMessage } from "@/lib/telegram-bot";
import { TwilioWhatsAppNotificationProvider } from "@/providers/notification/twilio-whatsapp";

export type BotWelcomeDeliveryResult = {
  status: "sent" | "skipped" | "not_configured" | "failed";
  detail?: string;
};

export async function sendManagerBotWelcomeMessages(input: {
  userName: string;
  phoneNumber?: string | null;
  telegramChatId?: string | null;
}) {
  const welcomeMessage = buildWelcomeMessage(input.userName);

  const whatsapp = await sendWhatsAppWelcome(input.phoneNumber, welcomeMessage);
  const telegram = await sendTelegramWelcome(input.telegramChatId, welcomeMessage);

  return {
    whatsapp,
    telegram,
  };
}

function buildWelcomeMessage(userName: string) {
  return [
    `StockBuddy is now connected for ${userName}! 👋`,
    `Send a text or voice message like: "Whole milk 2 left, order more."`,
    `I'll log the count, restock to par, and route the order — all automatically.`,
  ].join("\n");
}

async function sendWhatsAppWelcome(
  phoneNumber: string | null | undefined,
  body: string
): Promise<BotWelcomeDeliveryResult> {
  if (!phoneNumber) {
    return {
      status: "skipped",
      detail: "No WhatsApp number was provided.",
    };
  }

  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_WHATSAPP_FROM) {
    return {
      status: "not_configured",
      detail: "Twilio WhatsApp credentials are not configured yet.",
    };
  }

  try {
    const provider = new TwilioWhatsAppNotificationProvider({
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      fromNumber: env.TWILIO_WHATSAPP_FROM,
    });

    await provider.sendNotification({
      channel: NotificationChannel.WHATSAPP,
      recipient: phoneNumber,
      body,
    });

    return {
      status: "sent",
    };
  } catch (error) {
    return {
      status: "failed",
      detail: error instanceof Error ? error.message : "Unknown WhatsApp send failure.",
    };
  }
}

async function sendTelegramWelcome(
  chatId: string | null | undefined,
  body: string
): Promise<BotWelcomeDeliveryResult> {
  if (!chatId) {
    return {
      status: "skipped",
      detail: "No Telegram chat id was provided.",
    };
  }

  if (!env.TELEGRAM_BOT_TOKEN) {
    return {
      status: "not_configured",
      detail: "Telegram bot token is not configured yet.",
    };
  }

  try {
    const result = await sendTelegramMessage(chatId, body);

    if (result.skipped) {
      return {
        status: "not_configured",
        detail: result.reason,
      };
    }

    return {
      status: "sent",
    };
  } catch (error) {
    return {
      status: "failed",
      detail: error instanceof Error ? error.message : "Unknown Telegram send failure.",
    };
  }
}
