/**
 * Pure parsers for Telegram OIDC cookie + ID-token payloads.
 *
 * telegram-oidc.ts does crypto + env + fetch work that isn't
 * testable. The JSON-shape validation and the "which field is the
 * user id" lookup are both pure — extracted here so tests can lock
 * them without spinning up JWKS or touching the Telegram auth URL.
 */

export const TELEGRAM_OIDC_TTL_SECONDS = 15 * 60;

export type TelegramOidcCookiePayload = {
  state: string;
  codeVerifier: string;
  issuedAt: number;
};

/**
 * Parse and TTL-validate a Telegram OIDC cookie value.
 *
 * Returns null when:
 *   - value is missing / empty
 *   - JSON parsing fails
 *   - the parsed object is missing or malformed fields
 *   - the cookie is older than TELEGRAM_OIDC_TTL_SECONDS
 *
 * `now` is injectable so tests can drive the TTL check
 * deterministically; callers in runtime code should pass Date.now().
 */
export function parseTelegramOidcCookie(
  value: string | undefined,
  now: number
): TelegramOidcCookiePayload | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as TelegramOidcCookiePayload;

    if (
      !parsed ||
      typeof parsed.state !== "string" ||
      typeof parsed.codeVerifier !== "string" ||
      typeof parsed.issuedAt !== "number"
    ) {
      return null;
    }

    if (now - parsed.issuedAt > TELEGRAM_OIDC_TTL_SECONDS * 1000) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Extract the Telegram user id from an OIDC ID-token payload.
 *
 * The canonical Telegram field is `id`, but the standard OIDC
 * `sub` claim is also populated — we accept either. Both can be
 * string or number (Telegram IDs are 64-bit, so number is fine
 * below 2^53; we coerce to string either way since downstream
 * code keys a DB row off it).
 *
 * Returns null when neither field is present in a usable form.
 */
export function extractTelegramUserId(
  payload: Record<string, unknown>
): string | null {
  if (typeof payload.id === "string" || typeof payload.id === "number") {
    return String(payload.id);
  }

  if (typeof payload.sub === "string" || typeof payload.sub === "number") {
    return String(payload.sub);
  }

  return null;
}
