import type { NotificationProvider } from "@/providers/contracts";
import { NotificationChannel } from "@/lib/prisma";
import { normalizeWhatsAppRecipient } from "@/modules/notifications/channels";

type TwilioWhatsAppProviderOptions = {
  accountSid: string;
  authToken: string;
  fromNumber: string;
};

export class TwilioWhatsAppNotificationProvider implements NotificationProvider {
  constructor(private readonly options: TwilioWhatsAppProviderOptions) {}

  async sendNotification(input: {
    notificationId?: string;
    channel: NotificationChannel;
    recipient: string;
    subject?: string;
    body: string;
  }) {
    const body = new URLSearchParams({
      From: normalizeWhatsAppAddress(this.options.fromNumber),
      To: normalizeWhatsAppAddress(input.recipient),
      Body: input.subject ? `${input.subject}\n\n${input.body}` : input.body,
    });

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.options.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${this.options.accountSid}:${this.options.authToken}`
          ).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      }
    );

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(
        typeof payload.message === "string"
          ? payload.message
          : "Twilio WhatsApp delivery failed."
      );
    }

    return {
      providerMessageId:
        typeof payload.sid === "string" ? payload.sid : undefined,
      deliveryState: "sent" as const,
      metadata: payload,
    };
  }

  async sendAlert(input: { recipient: string; subject: string; body: string }) {
    return this.sendNotification({
      channel: NotificationChannel.WHATSAPP,
      recipient: input.recipient,
      subject: input.subject,
      body: input.body,
    });
  }
}

function normalizeWhatsAppAddress(value: string) {
  return normalizeWhatsAppRecipient(value);
}
