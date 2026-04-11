import type { NotificationProvider } from "@/providers/contracts";
import { NotificationChannel } from "@/lib/prisma";
import {
  isExpoPushRecipient,
  normalizeExpoRecipient,
} from "@/modules/notifications/channels";

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

function readExpoTicketId(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.data)) {
    return undefined;
  }

  const firstEntry = payload.data[0];
  return firstEntry && typeof firstEntry === "object" && !Array.isArray(firstEntry)
    ? (firstEntry as Record<string, unknown>).id as string | undefined
    : undefined;
}

function readExpoTicketError(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.data)) {
    return null;
  }

  const firstEntry = payload.data[0];
  if (!firstEntry || typeof firstEntry !== "object" || Array.isArray(firstEntry)) {
    return null;
  }

  const record = firstEntry as Record<string, unknown>;
  if (record.status !== "error") {
    return null;
  }

  const details =
    record.details && typeof record.details === "object" && !Array.isArray(record.details)
      ? record.details
      : null;
  const detailError: string | null =
    details && typeof (details as Record<string, unknown>).error === "string"
      ? ((details as Record<string, unknown>).error as string)
      : null;

  if (typeof record.message === "string" && record.message.trim()) {
    return detailError ? `${record.message} (${detailError})` : record.message;
  }

  return detailError ?? "Expo push delivery failed.";
}
