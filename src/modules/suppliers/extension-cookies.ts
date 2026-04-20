/**
 * Validation + normalisation of cookies posted by the StockPilot
 * browser extension. Kept separate from the route handler so it's
 * unit-testable without booting Next.js.
 */
import type { SupplierWebsiteCookie } from "@/modules/suppliers/website-credentials";

export const MAX_COOKIES = 200;
export const MAX_NAME_LENGTH = 256;
export const MAX_VALUE_LENGTH = 8192;
export const MAX_DOMAIN_LENGTH = 253;
export const MAX_PATH_LENGTH = 1024;

type RawCookie = {
  name?: unknown;
  value?: unknown;
  domain?: unknown;
  path?: unknown;
  expires?: unknown;
  httpOnly?: unknown;
  secure?: unknown;
  sameSite?: unknown;
};

export type NormaliseResult =
  | { ok: true; cookies: SupplierWebsiteCookie[] }
  | { ok: false; reason: string };

export function normaliseExtensionCookies(raw: unknown): NormaliseResult {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: "cookies must be an array" };
  }
  if (raw.length === 0) {
    return { ok: false, reason: "at least one cookie is required" };
  }
  if (raw.length > MAX_COOKIES) {
    return { ok: false, reason: `too many cookies (max ${MAX_COOKIES})` };
  }
  const out: SupplierWebsiteCookie[] = [];
  for (const entry of raw as RawCookie[]) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.name !== "string" || typeof entry.value !== "string") continue;
    if (entry.name.length === 0 || entry.name.length > MAX_NAME_LENGTH) continue;
    if (entry.value.length > MAX_VALUE_LENGTH) continue;
    const cookie: SupplierWebsiteCookie = {
      name: entry.name,
      value: entry.value,
    };
    if (typeof entry.domain === "string" && entry.domain.length <= MAX_DOMAIN_LENGTH) {
      cookie.domain = entry.domain;
    }
    if (typeof entry.path === "string" && entry.path.length <= MAX_PATH_LENGTH) {
      cookie.path = entry.path;
    }
    if (
      typeof entry.expires === "number" &&
      Number.isFinite(entry.expires) &&
      entry.expires > 0
    ) {
      cookie.expires = Math.floor(entry.expires);
    }
    if (typeof entry.httpOnly === "boolean") cookie.httpOnly = entry.httpOnly;
    if (typeof entry.secure === "boolean") cookie.secure = entry.secure;
    if (
      entry.sameSite === "Strict" ||
      entry.sameSite === "Lax" ||
      entry.sameSite === "None"
    ) {
      cookie.sameSite = entry.sameSite;
    }
    out.push(cookie);
  }
  if (out.length === 0) {
    return { ok: false, reason: "no well-formed cookies in payload" };
  }
  return { ok: true, cookies: out };
}
