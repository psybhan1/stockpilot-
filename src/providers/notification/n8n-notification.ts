import { NotificationChannel } from "@/lib/prisma";
import type { NotificationProvider } from "@/providers/contracts";

type N8nNotificationProviderOptions = {
  webhookUrl: string;
  secret?: string;
};

export class N8nNotificationProvider implements NotificationProvider {
  constructor(private readonly options: N8nNotificationProviderOptions) {}

  async sendNotification(input: {
    notificationId?: string;
    channel: NotificationChannel;
    recipient: string;
    subject?: string;
    body: string;
    callbackUrl?: string;
    callbackSecret?: string | null;
  }) {
    const response = await fetch(this.options.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "stockpilot/0.1",
        ...(this.options.secret
          ? { "X-StockPilot-Webhook-Secret": this.options.secret }
          : {}),
      },
      body: JSON.stringify({
        event: "stockpilot.notification.send",
        occurredAt: new Date().toISOString(),
        notification: {
          notificationId: input.notificationId,
          callbackUrl: input.callbackUrl,
          callbackSecret: input.callbackSecret,
          channel: input.channel,
          recipient: input.recipient,
          subject: input.subject,
          body: input.body,
        },
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!response.ok) {
      const message =
        typeof payload.message === "string"
          ? payload.message
          : `n8n notification dispatch failed with status ${response.status}`;
      throw new Error(message);
    }

    return {
      providerMessageId:
        typeof payload.providerMessageId === "string"
          ? payload.providerMessageId
          : typeof payload.executionId === "string"
          ? payload.executionId
          : typeof payload.runId === "string"
          ? payload.runId
          : undefined,
      deliveryState: "queued" as const,
      metadata: payload,
    };
  }

  async sendAlert(input: { recipient: string; subject: string; body: string }) {
    return this.sendNotification({
      channel: NotificationChannel.EMAIL,
      recipient: input.recipient,
      subject: input.subject,
      body: input.body,
    });
  }
}
