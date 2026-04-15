/**
 * Tiny HMAC-signed token used in supplier action links embedded in
 * PO emails. The token is a URL-safe base64 string containing a
 * JSON payload + an HMAC SHA-256 signature over the same payload
 * using N8N_WEBHOOK_SECRET (the same shared secret we already trust
 * for webhook auth).
 *
 * Why not JWT: we don't need audience/issuer semantics or anyone
 * else to verify this — it's an internal-to-StockPilot tamper check
 * on a URL that suppliers visit. Keeping it dependency-free + tiny.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

export type SupplierActionPayload = {
  /** The purchase order being acted on. */
  poId: string;
  /** When the link was issued (epoch ms). */
  iat: number;
  /** When the link expires (epoch ms). */
  exp: number;
};

const DEFAULT_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

function getSecret(): string {
  const secret = env.N8N_WEBHOOK_SECRET ?? "";
  if (!secret) {
    throw new Error(
      "N8N_WEBHOOK_SECRET must be set — supplier action links cannot be signed without it."
    );
  }
  return secret;
}

function base64urlEncode(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? 0 : 4 - (input.length % 4);
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(normalized, "base64");
}

export function signSupplierActionToken(
  poId: string,
  ttlMs: number = DEFAULT_TTL_MS
): string {
  const now = Date.now();
  const payload: SupplierActionPayload = {
    poId,
    iat: now,
    exp: now + ttlMs,
  };
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = createHmac("sha256", getSecret()).update(payloadB64).digest();
  return `${payloadB64}.${base64urlEncode(sig)}`;
}

export function verifySupplierActionToken(
  token: string
): { ok: true; payload: SupplierActionPayload } | { ok: false; reason: string } {
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return { ok: false, reason: "malformed" };

  let expectedSig: Buffer;
  try {
    expectedSig = createHmac("sha256", getSecret()).update(payloadB64).digest();
  } catch {
    return { ok: false, reason: "secret_missing" };
  }

  let actualSig: Buffer;
  try {
    actualSig = base64urlDecode(sigB64);
  } catch {
    return { ok: false, reason: "bad_signature_encoding" };
  }
  if (actualSig.length !== expectedSig.length) {
    return { ok: false, reason: "bad_signature" };
  }
  if (!timingSafeEqual(actualSig, expectedSig)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: SupplierActionPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "bad_payload" };
  }

  if (!payload.poId || typeof payload.poId !== "string") {
    return { ok: false, reason: "bad_payload" };
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}

export function buildSupplierActionUrl(baseUrl: string, poId: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/suppliers/${signSupplierActionToken(poId)}`;
}
