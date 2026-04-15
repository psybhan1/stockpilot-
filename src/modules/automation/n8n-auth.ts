/**
 * Shared helpers for authenticating inbound requests from n8n.
 *
 * Every request from n8n carries one of:
 *   - `x-stockpilot-webhook-secret: <shared-secret>`  (simple)
 *   - `x-stockpilot-signature: <hex-hmac-sha256(body)>` (stronger)
 *
 * The second form is preferred because it proves the body wasn't
 * tampered with in transit; both are accepted so existing workflows
 * keep working. Configure N8N_WEBHOOK_SECRET to enable either.
 *
 * When no secret is configured we fall back to accepting all requests
 * — useful for local development, hard-failing in prod is handled via
 * a boot check elsewhere.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

export type N8nAuthResult =
  | { ok: true; mode: "unconfigured" | "shared-secret" | "hmac" }
  | { ok: false; reason: string };

export async function verifyN8nRequest(request: Request): Promise<N8nAuthResult> {
  const secret = env.N8N_WEBHOOK_SECRET?.trim();

  // No secret set — dev mode, accept everything.
  if (!secret) return { ok: true, mode: "unconfigured" };

  // 1) HMAC signature on the body (strongest).
  const signature = request.headers.get("x-stockpilot-signature");
  if (signature) {
    // Clone so downstream reads still have the body.
    const body = await request.clone().text();
    const computed = createHmac("sha256", secret).update(body).digest("hex");
    if (constantTimeEqualHex(signature, computed)) {
      return { ok: true, mode: "hmac" };
    }
    return { ok: false, reason: "HMAC signature mismatch." };
  }

  // 2) Shared-secret header (simple).
  const headerSecret = request.headers.get("x-stockpilot-webhook-secret");
  if (headerSecret && constantTimeEqualStrings(headerSecret, secret)) {
    return { ok: true, mode: "shared-secret" };
  }

  return {
    ok: false,
    reason: "Missing or invalid x-stockpilot-signature / x-stockpilot-webhook-secret header.",
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
