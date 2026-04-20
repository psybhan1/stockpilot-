/**
 * Pure helpers for the server-side sign-in session module.
 *
 * signin-session.ts holds the live Chrome browser + puppeteer
 * session map and isn't unit-testable (it launches real browsers).
 * The bits below are pure functions used by that module — key
 * allowlisting, scroll-delta clamping, cookie shape normalization,
 * session-expiry math — extracted so they can be locked in with
 * assertion-level tests.
 */

export const SIGNIN_IDLE_TIMEOUT_MS = 12 * 60 * 1000;
export const SIGNIN_MAX_TOTAL_MS = 20 * 60 * 1000;

/**
 * Allowlist of named keys the sign-in session accepts. Anything
 * else is dropped — we don't want arbitrary string → KeyInput
 * coercion going into `puppeteer.keyboard.press`.
 */
export const ALLOWED_SIGNIN_KEYS = [
  "Enter",
  "Tab",
  "Backspace",
  "Escape",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Delete",
  "Home",
  "End",
] as const;

export type AllowedSigninKey = (typeof ALLOWED_SIGNIN_KEYS)[number];

/**
 * Return the matched key name if the input is exactly one of the
 * allowed keys, otherwise null. Case-sensitive on purpose — the
 * puppeteer KeyInput type uses these exact casings.
 */
export function pickAllowedSigninKey(key: string): AllowedSigninKey | null {
  const match = ALLOWED_SIGNIN_KEYS.find((k) => k === key);
  return match ?? null;
}

/**
 * Clamp scroll deltas to [-2000, 2000] and round to integer. A
 * rogue client could otherwise fire an enormous scroll and stall
 * puppeteer's wheel event handler. Non-finite inputs collapse to 0.
 */
export function clampScrollDelta(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-2000, Math.min(2000, Math.round(v)));
}

type RawCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
};

export type NormalizedSigninCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

/**
 * Shape a puppeteer cookie into the persisted form:
 *   - expires: only kept when > 0 (puppeteer returns -1 for
 *     session cookies; we drop those so downstream persistence
 *     never writes a sentinel value)
 *   - sameSite: narrowed to the three standard values; anything
 *     else (undefined, empty, "no_restriction", etc.) becomes
 *     undefined.
 */
export function normalizeSigninCookie(c: RawCookie): NormalizedSigninCookie {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: typeof c.expires === "number" && c.expires > 0 ? c.expires : undefined,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite:
      c.sameSite === "Strict" || c.sameSite === "Lax" || c.sameSite === "None"
        ? c.sameSite
        : undefined,
  };
}

type SessionTimestamps = {
  createdAt: number;
  lastActivityAt: number;
};

/**
 * Return true if a sign-in session has either been idle longer
 * than SIGNIN_IDLE_TIMEOUT_MS or exceeded the SIGNIN_MAX_TOTAL_MS
 * hard ceiling. Either condition is enough to force cleanup.
 */
export function isSigninSessionExpired(
  session: SessionTimestamps,
  now: number
): boolean {
  return (
    now - session.lastActivityAt > SIGNIN_IDLE_TIMEOUT_MS ||
    now - session.createdAt > SIGNIN_MAX_TOTAL_MS
  );
}
