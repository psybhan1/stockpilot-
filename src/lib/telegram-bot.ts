import { createHash } from "node:crypto";

import { env } from "@/lib/env";

type TelegramWebhookInfo = {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  last_synchronization_error_date?: number;
  max_connections?: number;
  allowed_updates?: string[];
};

type TelegramWebhookResult =
  | {
      ok: true;
      changed: boolean;
      webhookUrl: string;
      info: TelegramWebhookInfo | null;
    }
  | {
      ok: false;
      reason: string;
    };

const TELEGRAM_ALLOWED_UPDATES = ["message"]; // includes text + voice messages

export function isValidTelegramWebhook(request: Request) {
  const expectedSecret = getTelegramWebhookSecret();

  if (!expectedSecret) {
    return true;
  }

  return request.headers.get("x-telegram-bot-api-secret-token") === expectedSecret;
}

export async function sendTelegramMessage(chatId: string, text: string) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return {
      ok: false,
      skipped: true,
      reason: "Missing TELEGRAM_BOT_TOKEN",
    };
  }

  const response = await fetch(
    `${env.TELEGRAM_BOT_API_BASE_URL.replace(/\/$/, "")}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    }
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      description?: string;
    };
    throw new Error(
      payload.description ?? `Telegram sendMessage failed with status ${response.status}`
    );
  }

  return {
    ok: true,
    skipped: false,
  };
}

export function getTelegramWebhookSecret() {
  if (env.TELEGRAM_WEBHOOK_SECRET?.trim()) {
    return env.TELEGRAM_WEBHOOK_SECRET.trim();
  }

  if (!env.SESSION_SECRET?.trim()) {
    return null;
  }

  return createHash("sha256")
    .update(`${env.SESSION_SECRET}:telegram-webhook`)
    .digest("base64url")
    .slice(0, 48);
}

export function getTelegramWebhookUrl() {
  if (!env.APP_URL) {
    return null;
  }

  const normalized = env.APP_URL.replace(/\/$/, "");

  try {
    const parsed = new URL(`${normalized}/api/bot/telegram`);
    if (parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export async function getTelegramWebhookInfo() {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return null;
  }

  const response = await fetch(
    `${env.TELEGRAM_BOT_API_BASE_URL.replace(/\/$/, "")}/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`,
    {
      cache: "no-store",
    }
  ).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        ok?: boolean;
        result?: TelegramWebhookInfo;
      }
    | null;

  return payload?.ok ? payload.result ?? null : null;
}

export async function ensureTelegramWebhook(): Promise<TelegramWebhookResult> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return {
      ok: false,
      reason: "Telegram bot token is missing.",
    };
  }

  const webhookUrl = getTelegramWebhookUrl();

  if (!webhookUrl) {
    return {
      ok: false,
      reason: "Telegram webhook setup needs a public HTTPS APP_URL.",
    };
  }

  const secretToken = getTelegramWebhookSecret();

  if (!secretToken) {
    return {
      ok: false,
      reason: "Telegram webhook setup needs a usable session secret.",
    };
  }

  const currentInfo = await getTelegramWebhookInfo();
  const hasExpectedUrl = currentInfo?.url === webhookUrl;
  const hasExpectedAllowedUpdates =
    Array.isArray(currentInfo?.allowed_updates) &&
    currentInfo.allowed_updates.length === TELEGRAM_ALLOWED_UPDATES.length &&
    TELEGRAM_ALLOWED_UPDATES.every((update) => currentInfo.allowed_updates?.includes(update));

  if (hasExpectedUrl && hasExpectedAllowedUpdates) {
    return {
      ok: true,
      changed: false,
      webhookUrl,
      info: currentInfo,
    };
  }

  const response = await fetch(
    `${env.TELEGRAM_BOT_API_BASE_URL.replace(/\/$/, "")}/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secretToken,
        allowed_updates: TELEGRAM_ALLOWED_UPDATES,
      }),
    }
  ).catch(() => null);

  if (!response?.ok) {
    if (hasExpectedUrl && hasExpectedAllowedUpdates) {
      return {
        ok: true,
        changed: false,
        webhookUrl,
        info: currentInfo,
      };
    }

    return {
      ok: false,
      reason: `Telegram webhook setup failed with status ${response?.status ?? "unknown"}.`,
    };
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        ok?: boolean;
        description?: string;
      }
    | null;

  if (!payload?.ok) {
    if (hasExpectedUrl && hasExpectedAllowedUpdates) {
      return {
        ok: true,
        changed: false,
        webhookUrl,
        info: currentInfo,
      };
    }

    return {
      ok: false,
      reason: payload?.description ?? "Telegram rejected the webhook configuration.",
    };
  }

  const refreshedInfo = await getTelegramWebhookInfo();

  return {
    ok: true,
    changed: true,
    webhookUrl,
    info: refreshedInfo,
  };
}
