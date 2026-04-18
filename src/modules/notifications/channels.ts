export type NotificationDeliveryChannel = "EMAIL" | "PUSH" | "WHATSAPP";

type TestNotificationDraft = {
  subject: string;
  body: string;
};

export function getDefaultTestNotificationDraft(
  channel: NotificationDeliveryChannel
): TestNotificationDraft {
  switch (channel) {
    case "PUSH":
      return {
        subject: "StockPilot test push",
        body: "Test push notification from StockPilot. Use this for urgent low-stock nudges once a real Expo device token is connected.",
      };
    case "WHATSAPP":
      return {
        subject: "StockPilot test WhatsApp",
        body: "Test WhatsApp message from StockPilot. Supplier escalations and manager alerts can route here once Twilio is configured.",
      };
    case "EMAIL":
    default:
      return {
        subject: "StockPilot test email",
        body: "This is a test delivery from the StockPilot notifications workspace.",
      };
  }
}

export function getSuggestedTestRecipient(input: {
  channel: NotificationDeliveryChannel;
  sessionEmail: string;
  expoTestPushToken?: string;
  twilioTestWhatsappTo?: string;
}) {
  if (input.channel === "EMAIL") {
    return input.sessionEmail;
  }

  if (input.channel === "PUSH") {
    return input.expoTestPushToken?.trim() ?? "";
  }

  return input.twilioTestWhatsappTo?.trim() ?? "";
}

export function validateNotificationRecipient(
  channel: NotificationDeliveryChannel,
  recipient: string
) {
  const trimmedRecipient = recipient.trim();

  if (!trimmedRecipient) {
    return channel === "PUSH"
      ? "Enter a real Expo push token before queuing a live push test."
      : channel === "WHATSAPP"
        ? "Enter a WhatsApp number in international format, for example +14155550123."
        : "Enter an email address for the test notification.";
  }

  if (channel === "EMAIL" && !isValidEmailRecipient(trimmedRecipient)) {
    return "Enter a valid email address before queuing the test notification.";
  }

  if (channel === "PUSH" && !isExpoPushRecipient(trimmedRecipient)) {
    return "Enter a valid Expo push token. It should look like ExponentPushToken[...] or ExpoPushToken[...].";
  }

  if (channel === "WHATSAPP" && !isWhatsAppRecipient(trimmedRecipient)) {
    return "Enter a valid WhatsApp number in E.164 format, for example +14155550123.";
  }

  return null;
}

export function isExpoPushRecipient(recipient: string) {
  const normalized = normalizeExpoRecipient(recipient);
  return /^(Expo|Exponent)PushToken\[[^\]]+\]$/.test(normalized);
}

export function normalizeExpoRecipient(recipient: string) {
  return recipient.trim().replace(/^expo:/i, "");
}

export function normalizeWhatsAppRecipient(recipient: string) {
  // Twilio requires the prefix lowercase; strip any casing variant
  // then re-add so stored values like "WhatsApp:+1…" don't get
  // double-prefixed to "whatsapp:WhatsApp:+1…".
  const stripped = recipient.trim().replace(/^whatsapp:\s*/i, "");
  return `whatsapp:${stripped}`;
}

export function isWhatsAppRecipient(recipient: string) {
  const normalized = normalizeWhatsAppRecipient(recipient).replace(/^whatsapp:/i, "");
  return /^\+[1-9]\d{7,14}$/.test(normalized);
}

function isValidEmailRecipient(recipient: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim());
}
