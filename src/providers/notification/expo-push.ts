import type { NotificationProvider } from "@/providers/contracts";
import { NotificationChannel } from "@/lib/prisma";
import {
  isExpoPushRecipient,
  normalizeExpoRecipient,
} from "@/modules/notifications/channels";
import {
  readExpoTicketError,
  readExpoTicketId,
} from "./expo-ticket-parse";

type ExpoPushProviderOptions = {
  accessToken?: string;
};

export class ExpoPushNotificationProvider implements NotificationProvider {
  constructor(private readonly options: ExpoPushProviderOptions) {}

  async sendNotification(input: {
    notificationId?: string;
    channel: NotificationChannel;
    recipient: string;
    subject?: string;
    body: string;
  }) {
    if (!isExpoPushRecipient(input.recipient)) {
      throw new Error(
        "Expo push delivery requires a real Expo push token, for example ExponentPushToken[...]."
      );
    }

    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.options.accessToken
          ? { Authorization: `Bearer ${this.options.accessToken}` }
          : {}),
      },
      body: JSON.stringify({
        to: normalizeExpoRecipient(input.recipient),
        title: input.subject ?? "StockPilot",
        body: input.body,
        data: {
          notificationId: input.notificationId ?? null,
          channel: input.channel,
        },
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(
        typeof payload.errors === "object"
          ? JSON.stringify(payload.errors)
          : "Expo push delivery failed."
      );
    }

    const ticketError = readExpoTicketError(payload);
    if (ticketError) {
      throw new Error(ticketError);
    }

    return {
      providerMessageId: readExpoTicketId(payload),
      deliveryState: "sent" as const,
      metadata: payload,
    };
  }

  async sendAlert(input: { recipient: string; subject: string; body: string }) {
    return this.sendNotification({
      channel: NotificationChannel.PUSH,
      recipient: input.recipient,
      subject: input.subject,
      body: input.body,
    });
  }
}

