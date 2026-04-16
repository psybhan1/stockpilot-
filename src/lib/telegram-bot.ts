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

// Telegram update types we subscribe to. callback_query enables inline
// keyboard button presses (one-click order approvals etc.).
const TELEGRAM_ALLOWED_UPDATES = ["message", "callback_query"];

// ── Inline keyboard helpers ────────────────────────────────────────────

export type InlineButton = {
  text: string;
  /** Callback payload. Max 64 bytes when encoded. */
  callback_data: string;
};

export type InlineKeyboard = InlineButton[][];

/** Two buttons side-by-side with an optional full-width third below. */
export function approvalKeyboard(purchaseOrderId: string): InlineKeyboard {
  return [
    [
      { text: "✅ Approve & send", callback_data: `po_approve:${purchaseOrderId}` },
      { text: "✖ Cancel", callback_data: `po_cancel:${purchaseOrderId}` },
    ],
  ];
}

export function isValidTelegramWebhook(request: Request) {
  const expectedSecret = getTelegramWebhookSecret();

  if (!expectedSecret) {
    return true;
  }

  return request.headers.get("x-telegram-bot-api-secret-token") === expectedSecret;
}

type SendTelegramMessageOptions = {
  /** Inline keyboard buttons displayed under the message. */
  replyMarkup?: InlineKeyboard;
  /** Markdown / MarkdownV2 / HTML. Defaults to Markdown (bot has always used `*bold*`). */
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
  /** Disable link preview rectangles on URLs in the body. */
  disablePreview?: boolean;
};

type SendTelegramMessageResult =
  | { ok: true; skipped: false; messageId?: number }
  | { ok: false; skipped: true; reason: string };

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options?: SendTelegramMessageOptions
): Promise<SendTelegramMessageResult> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return {
      ok: false,
      skipped: true,
      reason: "Missing TELEGRAM_BOT_TOKEN",
    };
  }

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };
  if (options?.parseMode) body.parse_mode = options.parseMode;
  if (options?.disablePreview) body.disable_web_page_preview = true;
  if (options?.replyMarkup) {
    body.reply_markup = { inline_keyboard: options.replyMarkup };
  }

  const response = await fetch(
    `${env.TELEGRAM_BOT_API_BASE_URL.replace(/\/$/, "")}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

  const payload = (await response.json().catch(() => ({}))) as {
    result?: { message_id?: number };
  };
  return {
    ok: true,
    skipped: false,
    messageId: payload.result?.message_id,
  };
}

/**
 * Sends a photo (as a Buffer) to a Telegram chat. Used for cart
 * screenshots from the browser ordering agent.
 */
export async function sendTelegramPhoto(
  chatId: string,
  photo: Buffer,
  options?: {
    caption?: string;
    parseMode?: "Markdown" | "HTML";
    replyMarkup?: InlineKeyboard;
  }
): Promise<SendTelegramMessageResult> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, skipped: true, reason: "Missing TELEGRAM_BOT_TOKEN" };
  }

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("photo", new Blob([new Uint8Array(photo)], { type: "image/jpeg" }), "cart.jpg");
  if (options?.caption) form.append("caption", options.caption);
  if (options?.parseMode) form.append("parse_mode", options.parseMode);
  if (options?.replyMarkup) {
    form.append(
      "reply_markup",
      JSON.stringify({ inline_keyboard: options.replyMarkup })
    );
  }

  const response = await fetch(
    `${env.TELEGRAM_BOT_API_BASE_URL.replace(/\/$/, "")}/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`,
    { method: "POST", body: form }
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { description?: string };
    throw new Error(
      payload.description ?? `Telegram sendPhoto failed with status ${response.status}`
    );
  }

  const payload = (await response.json().catch(() => ({}))) as {
    result?: { message_id?: number };
  };
  return { ok: true, skipped: false, messageId: payload.result?.message_id };
}

/**
 * Shows a "typing…" indicator in the Telegram chat for up to 5 seconds.
 * Helpful when a downstream call (supplier dispatch, agent tool) is
 * going to take more than ~1s — gives the user immediate feedback
 * that we saw their message.
 */
export async function sendTelegramTyping(chatId: string) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await fetch(
    `${env.TELEGRAM_BOT_API_BASE_URL.replace(/\/$/, "")}/bot${env.TELEGRAM_BOT_TOKEN}/sendChatAction`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    }
  ).catch(() => null);
}

/** Removes the loading spinner on an inline button after it's tapped. */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  showAlert = false
) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await fetch(
    `${env.TELEGRAM_BOT_API_BASE_URL.replace(/\/$/, "")}/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      }),
    }
  ).catch(() => null);
}

/** Edits a message we already sent so the user sees an immediate state change. */
export async function editTelegramMessage(
  chatId: string,
  messageId: number,
  text: string,
  options?: { replyMarkup?: InlineKeyboard | null; parseMode?: "Markdown" | "HTML" }
) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
  };
  if (options?.parseMode) body.parse_mode = options.parseMode;
  if (options?.replyMarkup !== undefined) {
    body.reply_markup = options.replyMarkup
      ? { inline_keyboard: options.replyMarkup }
      : { inline_keyboard: [] };
  }
  await fetch(
    `${env.TELEGRAM_BOT_API_BASE_URL.replace(/\/$/, "")}/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  ).catch(() => null);
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
