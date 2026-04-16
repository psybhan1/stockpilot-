/**
 * Typed wrapper around credential-encryption for supplier website
 * logins. Two credential kinds are supported:
 *
 *   - "password": classic username + password. The Amazon adapter
 *     will attempt a form login. Best for sites without 2FA / captcha.
 *
 *   - "cookies": session-cookie paste. The user logs in once on their
 *     own browser, exports their cookies for the supplier domain (a
 *     one-click bookmarklet generates the JSON), and pastes it. The
 *     agent injects those cookies before the first navigation, so the
 *     session is already authenticated. This is the reliable path for
 *     Amazon / Costco / anything with bot detection or 2FA.
 *
 * The blob is encrypted with the existing AES-256-GCM helper and
 * stored in Supplier.websiteCredentials. Decrypt only at PO-dispatch
 * time inside the browser-agent process — never log the plaintext.
 */

import {
  decryptCredential,
  encryptCredential,
  isEncrypted,
} from "@/lib/credential-encryption";

export type SupplierWebsiteCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export type SupplierWebsiteCredentials =
  | {
      kind: "password";
      username: string;
      password: string;
      /** Optional URL of the supplier login page (overrides default-derivation). */
      loginUrl?: string;
    }
  | {
      kind: "cookies";
      /** Parsed cookie array — must be JSON-serialisable, will be set via Page.setCookie. */
      cookies: SupplierWebsiteCookie[];
    };

/**
 * Validates and encrypts a credential blob for storage. Returns the
 * encrypted ciphertext to write to Supplier.websiteCredentials.
 * Throws on malformed input so callers can surface a friendly error.
 */
export function encryptSupplierCredentials(
  payload: SupplierWebsiteCredentials
): string {
  if (payload.kind === "password") {
    const username = payload.username.trim();
    const password = payload.password;
    if (!username) throw new Error("Username is required.");
    if (!password) throw new Error("Password is required.");
    const blob: SupplierWebsiteCredentials = {
      kind: "password",
      username,
      password,
      ...(payload.loginUrl?.trim() ? { loginUrl: payload.loginUrl.trim() } : {}),
    };
    return encryptCredential(JSON.stringify(blob));
  }

  if (payload.kind === "cookies") {
    if (!Array.isArray(payload.cookies) || payload.cookies.length === 0) {
      throw new Error("At least one cookie is required.");
    }
    const cleaned: SupplierWebsiteCookie[] = [];
    for (const c of payload.cookies) {
      if (!c?.name || typeof c.value !== "string") {
        throw new Error("Each cookie needs at minimum a name and a string value.");
      }
      cleaned.push({
        name: c.name,
        value: c.value,
        ...(c.domain ? { domain: c.domain } : {}),
        ...(c.path ? { path: c.path } : {}),
        ...(typeof c.expires === "number" ? { expires: c.expires } : {}),
        ...(typeof c.httpOnly === "boolean" ? { httpOnly: c.httpOnly } : {}),
        ...(typeof c.secure === "boolean" ? { secure: c.secure } : {}),
        ...(c.sameSite ? { sameSite: c.sameSite } : {}),
      });
    }
    return encryptCredential(JSON.stringify({ kind: "cookies", cookies: cleaned }));
  }

  throw new Error(`Unknown credential kind: ${(payload as { kind?: string }).kind}`);
}

/**
 * Decrypts and parses the stored blob. Returns null if the field is
 * empty or undecryptable (don't crash dispatch on bad data — fall
 * back to anonymous mode).
 */
export function decryptSupplierCredentials(
  encoded: string | null | undefined
): SupplierWebsiteCredentials | null {
  if (!encoded) return null;
  try {
    const plaintext = decryptCredential(encoded);
    const parsed = JSON.parse(plaintext) as SupplierWebsiteCredentials;
    if (parsed?.kind === "password" && parsed.username && parsed.password) {
      return parsed;
    }
    if (parsed?.kind === "cookies" && Array.isArray(parsed.cookies) && parsed.cookies.length > 0) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * UI-safe summary of what's stored — never returns the secret material.
 * Use this on the Settings page to show "Connected via cookies (4 cookies, exported 2026-04-15)"
 * without ever sending the plaintext over the wire to the browser.
 */
export function summariseStoredCredentials(
  encoded: string | null | undefined
):
  | { kind: "none" }
  | { kind: "password"; username: string }
  | { kind: "cookies"; cookieCount: number; primaryDomain: string | null } {
  if (!encoded) return { kind: "none" };
  if (!isEncrypted(encoded)) {
    // Pre-encryption value or stale plain JSON — treat as broken to
    // avoid leaking. UI will show "stored credentials unreadable —
    // re-enter to fix".
    return { kind: "none" };
  }
  const decoded = decryptSupplierCredentials(encoded);
  if (!decoded) return { kind: "none" };
  if (decoded.kind === "password") return { kind: "password", username: decoded.username };
  const primaryDomain =
    decoded.cookies.find((c) => c.domain)?.domain?.replace(/^\./, "") ?? null;
  return { kind: "cookies", cookieCount: decoded.cookies.length, primaryDomain };
}

/**
 * Parse a pasted cookie JSON string into our typed shape. Tolerates
 * the two common export formats: (a) a plain array (`[{...},{...}]`),
 * (b) the Chrome DevTools `document.cookie` JSON shape with `cookies`
 * key. Returns the array or throws a friendly error.
 */
export function parseCookieJson(raw: string): SupplierWebsiteCookie[] {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Paste a cookie JSON export to continue.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("That doesn't look like JSON. Paste the raw cookie export.");
  }
  const list =
    Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { cookies?: unknown[] }).cookies)
        ? (parsed as { cookies: unknown[] }).cookies
        : null;
  if (!list || list.length === 0) {
    throw new Error("No cookies found in the pasted JSON.");
  }
  const out: SupplierWebsiteCookie[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.name !== "string" || typeof e.value !== "string") continue;
    out.push({
      name: e.name,
      value: e.value,
      ...(typeof e.domain === "string" ? { domain: e.domain } : {}),
      ...(typeof e.path === "string" ? { path: e.path } : {}),
      ...(typeof e.expires === "number" ? { expires: e.expires } : {}),
      ...(typeof e.expirationDate === "number" ? { expires: Math.floor(e.expirationDate as number) } : {}),
      ...(typeof e.httpOnly === "boolean" ? { httpOnly: e.httpOnly } : {}),
      ...(typeof e.secure === "boolean" ? { secure: e.secure } : {}),
      ...(typeof e.sameSite === "string" && ["Strict", "Lax", "None"].includes(e.sameSite as string)
        ? { sameSite: e.sameSite as "Strict" | "Lax" | "None" }
        : {}),
    });
  }
  if (out.length === 0) {
    throw new Error("Cookies in the JSON were missing name or value fields.");
  }
  return out;
}
