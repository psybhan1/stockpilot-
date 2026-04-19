/**
 * Pure helpers for the operator-bot connect flow.
 *
 * The Telegram/WhatsApp "connect" handshake has a dozen little
 * string-shaping and validation steps — building the deep-link URL,
 * extracting a connect token out of a /start message, normalizing a
 * WhatsApp sender to E.164, etc. None of them need Prisma or env to
 * run, but they all sit in the big connect.ts file that DOES import
 * those heavy runtime deps (for the DB writes and token hashing).
 *
 * Split out here so each helper can be pinned with unit tests. Each
 * one is load-bearing for an externally-visible auth / deep-link
 * flow, so locking behaviour across refactors matters.
 */

export type ConnectChannel = "TELEGRAM" | "WHATSAPP";

export type ConnectStatus = "connected" | "expired" | "invalid" | "conflict";

/**
 * Build the t.me deep link that embeds a connect token. Strips a
 * leading '@' from the bot username if someone accidentally includes
 * it, and produces `/start connect-<token>` — the exact payload the
 * Telegram client sends us back when the user taps "Start".
 */
export function buildTelegramConnectUrl(botUsername: string, token: string): string {
  // trim first, then strip '@' — reversing these silently fails on pasted " @bot ".
  const normalizedBotUsername = botUsername.trim().replace(/^@/, "");
  return `https://t.me/${normalizedBotUsername}?start=connect-${token}`;
}

/**
 * Build the wa.me deep link for WhatsApp connection. Strips the
 * "whatsapp:" prefix and any non-digit characters (wa.me wants a
 * bare international number). Pre-fills a message body containing
 * the connect code so the user just taps Send.
 */
export function buildWhatsAppConnectUrl(senderNumber: string, token: string): string {
  const normalizedSender = senderNumber
    .replace(/^whatsapp:/i, "")
    .replace(/[^\d]/g, "");
  const message = encodeURIComponent(`🔗 Link my StockPilot account\nCode: ${token}`);
  return `https://wa.me/${normalizedSender}?text=${message}`;
}

/**
 * Parse a connect token out of an inbound message. Two formats:
 *   TELEGRAM:  "/start connect-<TOKEN>" (the platform-standard deep-
 *              link-payload shape — Telegram injects it verbatim when
 *              the user taps our t.me link)
 *   WHATSAPP:  "Code: <TOKEN>" (pretty format) OR "connect <TOKEN>"
 *              (legacy — kept for users with old paired messages in
 *              their chat history)
 *
 * Token charset: [A-Za-z0-9_-] (URL-safe). Returns null when no match.
 */
export function readConnectTokenFromText(input: {
  channel: ConnectChannel;
  text: string;
}): string | null {
  const normalized = input.text.trim();

  if (input.channel === "TELEGRAM") {
    const match = normalized.match(/^\/start\s+connect-([A-Za-z0-9_-]+)$/i);
    return match?.[1] ?? null;
  }

  const prettyMatch = normalized.match(/\bcode:\s*([A-Za-z0-9_-]+)/i);
  if (prettyMatch) return prettyMatch[1];
  const legacyMatch = normalized.match(/^connect\s+([A-Za-z0-9_-]+)$/i);
  return legacyMatch?.[1] ?? null;
}

/**
 * True when the URL is suitable for receiving webhooks from external
 * services (Telegram / Twilio). Gates production-only code paths:
 * locally we fall back to polling instead of webhooks. The rule:
 *   - Protocol MUST be https (or localhost/127.0.0.1 for dev)
 *   - Hostname MUST NOT be localhost / 127.0.0.1 / 0.0.0.0
 *
 * Note the subtle composition — http://localhost is treated as
 * private-but-valid so dev environments don't crash, but isPublicAppUrl
 * still returns false for them (they can't receive real webhooks).
 * Malformed URLs return false rather than throwing.
 */
export function isPublicAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    if (parsed.protocol !== "https:" && hostname !== "localhost" && hostname !== "127.0.0.1") {
      return false;
    }

    return !["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname);
  } catch {
    return false;
  }
}

/**
 * Twilio's free-tier sandbox number is shared across every account
 * on the planet. A message arriving "from" this number means the
 * user texted the sandbox bot, not a real connected WhatsApp line.
 * Detecting it lets us show the right instructions ("Join the
 * sandbox with this code") instead of the normal connect flow.
 */
export function isTwilioSandboxSender(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.replace(/^whatsapp:/i, "") === "+14155238886";
}

/**
 * Normalize a phone number to E.164-ish (leading '+' then digits).
 * Strips the "whatsapp:" prefix, then everything that isn't a digit
 * or a '+'. Returns null for empty results.
 *
 * Not a full E.164 validator — that's downstream's problem. The goal
 * here is "dedupe numbers that are written differently" so two users
 * typing "+1 (415) 555-0100" and "14155550100" don't collide.
 */
export function normalizePhoneNumber(value: string): string | null {
  const normalized = value.replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");
  if (!normalized) return null;
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

/**
 * Normalize a Telegram chat ID. Trims; returns null when the result
 * is empty. The chat ID stays as a string because Telegram's JSON
 * uses integers that can exceed JS's safe-integer bound for
 * channels/supergroups (10^12+).
 */
export function normalizeTelegramChatId(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Ensure a Telegram username carries a leading '@'. Input can come
 * from the API (no '@') or from the user pasting their handle (with
 * or without '@'). Null in → null out.
 */
export function normalizeTelegramUsername(value: string | null): string | null {
  if (!value) return null;
  return value.startsWith("@") ? value : `@${value}`;
}

/**
 * Read the connectStatus field out of a BotChannel.metadata JSON blob.
 * Defensive against the field being missing, wrongly-typed, or
 * containing an unexpected value — all of those collapse to the
 * safe "connected" default. Without this narrowing, a corrupt
 * metadata row could inject an arbitrary status string through to
 * the UI.
 */
export function readConnectStatus(metadata: unknown): ConnectStatus {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "connected";
  }

  const connectStatus = (metadata as Record<string, unknown>).connectStatus;

  if (
    connectStatus === "connected" ||
    connectStatus === "expired" ||
    connectStatus === "invalid" ||
    connectStatus === "conflict"
  ) {
    return connectStatus;
  }

  return "connected";
}
