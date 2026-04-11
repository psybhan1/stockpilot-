import { env } from "@/lib/env";
import type { NotificationProvider } from "@/providers/contracts";
import { ConsoleEmailProvider } from "@/providers/email/console-email";
import { ResendEmailProvider } from "@/providers/email/resend-email";
import { NotificationChannel } from "@/lib/prisma";
import { ExpoPushNotificationProvider } from "@/providers/notification/expo-push";
import { N8nNotificationProvider } from "@/providers/notification/n8n-notification";
import { TwilioWhatsAppNotificationProvider } from "@/providers/notification/twilio-whatsapp";
import { isExpoPushRecipient } from "@/modules/notifications/channels";

class RoutedNotificationProvider implements NotificationProvider {
  constructor(
    private readonly options: {
      emailProvider: NotificationProvider;
      fallbackProvider: NotificationProvider;
      externalProvider?: NotificationProvider;
      pushProvider?: NotificationProvider;
      whatsappProvider?: NotificationProvider;
    }
  ) {}

  async sendNotification(input: {
    notificationId?: string;
    channel: NotificationChannel;
    recipient: string;
    subject?: string;
    body: string;
    callbackUrl?: string;
    callbackSecret?: string | null;
  }) {
    if (input.channel === NotificationChannel.EMAIL) {
      return this.options.emailProvider.sendNotification(input);
    }

    if (
      input.channel === NotificationChannel.PUSH &&
      this.options.pushProvider &&
      isExpoPushRecipient(input.recipient)
    ) {
      return this.options.pushProvider.sendNotification(input);
    }

    if (input.channel === NotificationChannel.WHATSAPP && this.options.whatsappProvider) {
      return this.options.whatsappProvider.sendNotification(input);
    }

    if (this.options.externalProvider) {
      return this.options.externalProvider.sendNotification(input);
    }

    return this.options.fallbackProvider.sendNotification(input);
  }

  async sendAlert(input: { recipient: string; subject: string; body: string }) {
    return this.options.emailProvider.sendAlert(input);
  }
}

export function getNotificationProvider(): NotificationProvider {
  const fallbackProvider = new ConsoleEmailProvider();
  const emailProvider =
    env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY
      ? new ResendEmailProvider({
          apiKey: env.RESEND_API_KEY,
          fromEmail: env.RESEND_FROM_EMAIL,
        })
      : fallbackProvider;
  const externalProvider = env.N8N_NOTIFICATION_WEBHOOK_URL
    ? new N8nNotificationProvider({
        webhookUrl: env.N8N_NOTIFICATION_WEBHOOK_URL,
        secret: env.N8N_WEBHOOK_SECRET,
      })
    : undefined;
  const pushProvider = new ExpoPushNotificationProvider({
    accessToken: env.EXPO_ACCESS_TOKEN,
  });
  const whatsappProvider =
    env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM
      ? new TwilioWhatsAppNotificationProvider({
          accountSid: env.TWILIO_ACCOUNT_SID,
          authToken: env.TWILIO_AUTH_TOKEN,
          fromNumber: env.TWILIO_WHATSAPP_FROM,
        })
      : undefined;

  return new RoutedNotificationProvider({
    emailProvider,
    fallbackProvider,
    externalProvider,
    pushProvider,
    whatsappProvider,
  });
}
