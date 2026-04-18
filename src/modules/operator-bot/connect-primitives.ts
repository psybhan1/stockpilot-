/**
 * Pure helpers for the manager-bot connect flow.
 *
 * Extracted from connect.ts so they can be unit-tested without pulling
 * in the DB / env / crypto imports. connect.ts re-exports everything
 * from here.
 *
 * All functions in this file MUST remain side-effect free and
 * dependency-free so they can run in a plain vitest/node:test
 * environment.
 */

/**
 * Minimal local shape of the BotChannel enum + Prisma JsonValue so
 * this file stays dependency-free and runs under plain node:test
 * without pulling in the generated Prisma client. Matches the
 * string values Prisma emits for the enum.
 */
type BotChannelValue = "TELEGRAM" | "WHATSAPP";
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// ── Connect / pairing token readers ─────────────────────────────────────────

/**
 * Detects a StockPilot location pairing code like "SB-AB1234".
 *
 * Used by both the Telegram and WhatsApp webhook routes to detect
 * when a user pastes a location-level pairing code (six alphanumerics
 * after the `SB-` prefix). The match is anchored so stray words
 * around the code don't accidentally trigger pairing.
 *
 * Returns the upper-cased code, or null if the text isn't a pure
 * pairing code.
 */
export function readLocationPairingCode(text: string): string | null {
  const match = text.trim().match(/^(SB-[A-Z0-9]{6})$/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Extracts the connect token a manager pasted into Telegram or
 * WhatsApp.
 *
 * Telegram: the deep-link the app hands out is `/start connect-<tok>`.
 * Anchored at both ends — any extra text fails the match.
 *
 * WhatsApp: wa.me prefills the user's message with
 *   "🔗 Link my StockPilot account\nCode: <tok>"
 * so we look for a `Code: <tok>` line. We also accept the older
 * "connect <tok>" legacy form.
 *
 * BUG FIX (2026-04): the WhatsApp pretty matcher used to accept
 * `code:\s*([A-Za-z0-9_-]+)` anywhere in the message, which meant a
 * manager writing "hey bot, check the discount code: SAVE20" got
 * redirected into the connect flow and saw "this link is no longer
 * valid." The matcher now requires `code:` to be at the start of a
 * line and the token to sit at the end of the trimmed message, which
 * matches the wa.me prefill exactly while rejecting conversational
 * mentions of "code:".
 */
export function readConnectTokenFromText(input: {
  channel: BotChannelValue;
  text: string;
}): string | null {
  const normalized = input.text.trim();

  if (input.channel === "TELEGRAM") {
    const match = normalized.match(/^\/start\s+connect-([A-Za-z0-9_-]+)$/i);
    return match?.[1] ?? null;
  }

  // Pretty format: `Code: <tok>` at start of a line, token at end of
  // message. Matches the wa.me prefill we hand out in
  // buildWhatsAppConnectUrl.
  const prettyMatch = normalized.match(
    /(?:^|\n)\s*code:\s*([A-Za-z0-9_-]+)\s*$/i
  );
  if (prettyMatch) return prettyMatch[1];

  // Legacy format some early users typed by hand. Already anchored.
  const legacyMatch = normalized.match(/^connect\s+([A-Za-z0-9_-]+)$/i);
  return legacyMatch?.[1] ?? null;
}

// ── Connect URL builders ────────────────────────────────────────────────────

/**
 * Builds the https://t.me/<bot>?start=connect-<token> deep link the
 * UI renders on the Telegram connect page. Accepts the bot username
 * with or without a leading `@`.
 */
export function buildTelegramConnectUrl(botUsername: string, token: string) {
  const normalizedBotUsername = botUsername.replace(/^@/, "").trim();
  return `https://t.me/${normalizedBotUsername}?start=connect-${token}`;
}

/**
 * Builds the https://wa.me/<number>?text=... deep link the UI renders
 * on the WhatsApp connect page. The prefilled message is
 *   "🔗 Link my StockPilot account\nCode: <token>"
 * which is what readConnectTokenFromText expects to see back.
 *
 * The sender number is stripped of any `whatsapp:` prefix and any
 * formatting characters so `wa.me` sees a bare digit string (wa.me
 * rejects `+` and spaces).
 */
export function buildWhatsAppConnectUrl(senderNumber: string, token: string) {
  const normalizedSender = senderNumber
    .replace(/^whatsapp:/i, "")
    .replace(/[^\d]/g, "");
  const message = encodeURIComponent(
    `🔗 Link my StockPilot account\nCode: ${token}`
  );
  return `https://wa.me/${normalizedSender}?text=${message}`;
}

// ── URL / sender classifiers ────────────────────────────────────────────────

/**
 * Returns true when the URL is reachable by an external webhook
 * (Telegram, Twilio). Blocks loopback + 0.0.0.0 hosts and any non-
 * HTTPS scheme except the localhost carve-out used in dev.
 *
 * BUG FIX (2026-04): the previous implementation only checked the
 * v4 loopback literals, so `https://[::1]/...` slipped through as
 * "public" — it's the IPv6 loopback and equally unreachable. We
 * now block `::1` in both its bracketed and un-bracketed form.
 *
 * Intentionally narrow: private IP ranges (10.x, 192.168.x, 172.16-
 * 31.x) are NOT rejected here. That's deliberate — this check runs
 * before showing the connect QR and only needs to catch the common
 * misconfiguration (forgot to set APP_URL, still pointing at
 * localhost). Networking errors from unreachable private IPs are
 * surfaced by Telegram/Twilio later.
 */
export function isPublicAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const isLoopbackIpv4 = hostname === "localhost" || hostname === "127.0.0.1";
    const isLoopbackIpv6 = hostname === "[::1]" || hostname === "::1";

    if (
      parsed.protocol !== "https:" &&
      !isLoopbackIpv4 &&
      !isLoopbackIpv6
    ) {
      return false;
    }

    if (isLoopbackIpv4 || isLoopbackIpv6) return false;
    if (hostname === "0.0.0.0") return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Twilio assigns every sandbox a shared "from" number
 * (+14155238886). The UI shows different instructions when the
 * sender is the sandbox (there's an extra `join <phrase>` step).
 */
export function isTwilioSandboxSender(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  return value.replace(/^whatsapp:/i, "") === "+14155238886";
}

// ── Normalisers for sender identifiers ──────────────────────────────────────

/**
 * Normalise a WhatsApp "From" value into a canonical E.164 phone
 * number suitable for storing against `User.phoneNumber`.
 *
 * Twilio hands us values like `whatsapp:+14155550123`; users pasting
 * into the connect flow might send `+1 (415) 555-0123`. We strip
 * every non-digit / non-`+` char, then force a single leading `+`.
 *
 * Returns null when the input contains no digits at all (pure
 * punctuation, empty string, etc.) — the caller treats null as
 * "unreadable sender id" and refuses to connect.
 */
export function normalizePhoneNumber(value: string): string | null {
  const normalized = value.replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");
  if (!normalized) {
    return null;
  }

  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

/** Trim-only normaliser for the Telegram chat id (already numeric). */
export function normalizeTelegramChatId(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Ensure a Telegram username is stored with a leading `@`.
 * Returns null when the raw value is empty / null so the column is
 * set back to NULL rather than `"@"` on unlink.
 */
export function normalizeTelegramUsername(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.startsWith("@") ? value : `@${value}`;
}

// ── Receipt metadata reader ─────────────────────────────────────────────────

export type ConnectStatus = "connected" | "expired" | "invalid" | "conflict";

/**
 * Decode the `connectStatus` field off a bot-message-receipt's
 * metadata JSON. Used when we deduplicate a retried webhook and
 * need to return the SAME status to the user rather than re-running
 * the connect flow.
 */
export function readConnectStatus(
  metadata: JsonValue | null | undefined
): ConnectStatus {
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
