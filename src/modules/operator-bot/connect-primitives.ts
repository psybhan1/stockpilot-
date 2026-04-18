/**
 * Pure helpers for the bot connect flow.
 *
 * connect.ts does db / audit / env / prisma work that tests can't
 * easily mock. The URL builders, inbound-text token parser, APP_URL
 * shape check, and Twilio sandbox detector are all pure — extracted
 * here so tests can lock them without spinning up Prisma or reading
 * env. connect.ts re-exports everything here so downstream callers
 * don't break.
 */

export type ConnectChannel = "WHATSAPP" | "TELEGRAM";

/**
 * Extract a connect token from a bot-inbound message.
 *
 * Telegram: `/start connect-<token>` (Telegram's deep-link format;
 * case-insensitive on the verb, token preserves case).
 *
 * WhatsApp: matches two formats — the current template
 * `Code: <token>` (appears inside the wa.me pre-filled body) and a
 * legacy `connect <token>` form kept for older links in the wild.
 * Returns null on empty / malformed input.
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

  // WhatsApp: pretty format wins over legacy when both appear —
  // pretty is what wa.me currently populates, so that's the
  // canonical intent.
  const prettyMatch = normalized.match(/code:\s*([A-Za-z0-9_-]+)/i);
  if (prettyMatch) return prettyMatch[1] ?? null;
  const legacyMatch = normalized.match(/^connect\s+([A-Za-z0-9_-]+)$/i);
  return legacyMatch?.[1] ?? null;
}

/**
 * Build the t.me deep link the user taps to open the bot with a
 * connect token pre-populated. Strips any leading `@` and surrounding
 * whitespace from the bot username.
 *
 * BUG FIX: the previous impl called `.replace(/^@/,"").trim()` — if
 * the caller passed a username with leading whitespace (e.g. from a
 * settings form or a getMe response with extra padding), the `^@`
 * regex missed the `@` (because it wasn't at position 0), and trim
 * only removed the outer spaces, leaving `@botname`. The resulting
 * URL `https://t.me/@botname?start=…` is a broken Telegram deep
 * link. Order is now trim → strip.
 */
export function buildTelegramConnectUrl(
  botUsername: string,
  token: string
): string {
  const normalizedBotUsername = botUsername.trim().replace(/^@/, "");
  return `https://t.me/${normalizedBotUsername}?start=connect-${token}`;
}

/**
 * Build the wa.me pre-filled message URL for WhatsApp connect. The
 * number is stripped to bare digits (wa.me spec: "omit any zeroes,
 * brackets, or dashes"), the prefix `whatsapp:` is tolerated but
 * discarded, and the template body is URL-encoded.
 */
export function buildWhatsAppConnectUrl(
  senderNumber: string,
  token: string
): string {
  const normalizedSender = senderNumber
    .replace(/^whatsapp:/i, "")
    .replace(/[^\d]/g, "");
  const message = encodeURIComponent(
    `🔗 Link my StockPilot account\nCode: ${token}`
  );
  return `https://wa.me/${normalizedSender}?text=${message}`;
}

/**
 * Returns true when APP_URL points at an internet-reachable HTTPS
 * host — the prerequisite for Telegram / Twilio webhooks to actually
 * hit us. False for http, localhost, 127.0.0.1, 0.0.0.0, or
 * un-parseable strings.
 *
 * The polling loop uses this to decide whether to fall back to
 * long-poll (local dev) instead of waiting for webhooks that will
 * never arrive.
 */
export function isPublicAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    if (
      parsed.protocol !== "https:" &&
      hostname !== "localhost" &&
      hostname !== "127.0.0.1"
    ) {
      return false;
    }

    return !["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname);
  } catch {
    return false;
  }
}

/**
 * Twilio's shared sandbox number is +14155238886. Admin UI shows an
 * "enable the sandbox first" callout when the configured From matches,
 * since regular outbound WhatsApp from a sandbox requires the
 * recipient to have opted in by messaging the magic phrase.
 */
export function isTwilioSandboxSender(
  value: string | null | undefined
): boolean {
  if (!value) {
    return false;
  }

  return value.replace(/^whatsapp:/i, "") === "+14155238886";
}
