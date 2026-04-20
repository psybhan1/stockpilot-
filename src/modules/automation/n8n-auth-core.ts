/**
 * Pure verification core for inbound n8n requests. Lives in its own
 * file so the unit tests don't transitively pull in `@/lib/env` (and
 * the whole DB / Prisma chain). `n8n-auth.ts` is the thin wrapper
 * that reads env + Request and delegates here.
 *
 * Two accepted auth modes:
 *   - `x-stockpilot-webhook-secret: <shared-secret>`        (simple)
 *   - `x-stockpilot-signature: <hex-hmac-sha256(body)>`     (stronger)
 *
 * The HMAC form is preferred — it proves the body wasn't tampered
 * with in transit. Both are accepted so existing workflows keep
 * working. When no secret is configured we accept all requests; the
 * boot check elsewhere hard-fails in prod if the env var is missing.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type N8nAuthResult =
  | { ok: true; mode: "unconfigured" | "shared-secret" | "hmac" }
  | { ok: false; reason: string };

/**
 * Decision tree:
 *   1. No secret configured                → ok unconfigured (dev mode)
 *   2. Signature header present            → verify HMAC; mismatch is
 *                                            an immediate reject — do
 *                                            NOT fall through to the
 *                                            shared-secret branch (a
 *                                            wrong signature is hostile)
 *   3. Shared-secret header matches        → ok shared-secret
 *   4. Neither / both wrong                → reject
 */
export function verifyN8nAuthHeaders(input: {
  secret: string | null | undefined;
  signature: string | null | undefined;
  headerSecret: string | null | undefined;
  body?: string;
}): N8nAuthResult {
  const secret = input.secret?.trim();
  if (!secret) return { ok: true, mode: "unconfigured" };

  if (input.signature) {
    const body = input.body ?? "";
    const computed = createHmac("sha256", secret).update(body).digest("hex");
    if (constantTimeEqualHex(input.signature, computed)) {
      return { ok: true, mode: "hmac" };
    }
    return { ok: false, reason: "HMAC signature mismatch." };
  }

  if (
    input.headerSecret &&
    constantTimeEqualStrings(input.headerSecret, secret)
  ) {
    return { ok: true, mode: "shared-secret" };
  }

  return {
    ok: false,
    reason:
      "Missing or invalid x-stockpilot-signature / x-stockpilot-webhook-secret header.",
  };
}

function constantTimeEqualStrings(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function constantTimeEqualHex(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}
