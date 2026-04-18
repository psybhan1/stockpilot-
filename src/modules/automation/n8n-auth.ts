/**
 * Shared helpers for authenticating inbound requests from n8n.
 *
 * Thin wrapper around the pure core in ./n8n-auth-core — this file
 * pulls in env (which transitively imports Prisma/etc), so the unit
 * tests live alongside the core file instead of here.
 */

import { env } from "@/lib/env";

import {
  verifyN8nAuthHeaders,
  type N8nAuthResult,
} from "./n8n-auth-core";

export { verifyN8nAuthHeaders, type N8nAuthResult };

export async function verifyN8nRequest(request: Request): Promise<N8nAuthResult> {
  const signature = request.headers.get("x-stockpilot-signature");
  // Only read the body when we need it for HMAC — saves the clone +
  // string allocation on plain shared-secret traffic.
  const body = signature ? await request.clone().text() : undefined;
  return verifyN8nAuthHeaders({
    secret: env.N8N_WEBHOOK_SECRET,
    signature,
    headerSecret: request.headers.get("x-stockpilot-webhook-secret"),
    body,
  });
}
