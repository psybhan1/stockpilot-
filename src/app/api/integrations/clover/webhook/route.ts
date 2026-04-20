import { NextResponse } from "next/server";

import { queueCloverWebhookSyncs } from "@/modules/pos/service";
import { extractCloverEvents } from "@/modules/pos/clover-webhook";

/**
 * Clover webhook receiver.
 *
 * Clover webhooks have a two-phase setup:
 *
 *   1. Verification handshake. When you set/update a webhook URL in
 *      the Clover dev dashboard, Clover POSTs a body containing a
 *      `verificationCode`. You must respond 200 with the code in the
 *      response body to prove you own the endpoint. We do that here
 *      before any auth checks so the dashboard registration succeeds.
 *
 *   2. Live events. Shape:
 *        { appId, merchants: { <merchantId>: [ { objectId, type, ts } ] } }
 *      Authenticated by the `X-Clover-Auth` header value matching the
 *      auth token Clover issued when the webhook was verified. We
 *      don't have that token persisted yet (no UI to paste it), so
 *      for now we accept unsigned Clover webhooks and rely on the
 *      merchant id → PosIntegration lookup to scope to real installs.
 *      TODO: persist CLOVER_WEBHOOK_AUTH_TOKEN once dashboard save
 *      UX lands, then require header equality here.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  let payload: unknown = {};

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { accepted: false, message: "Clover webhook payload was not valid JSON." },
        { status: 400 }
      );
    }
  }

  // Phase 1: verification handshake. Echo back the code.
  const verificationCode = (payload as { verificationCode?: string })?.verificationCode;
  if (verificationCode && typeof verificationCode === "string") {
    return new NextResponse(verificationCode, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // Phase 2: live event — flatten + queue one job per (merchantId, jobType).
  const events = extractCloverEvents(payload);
  if (events.length === 0) {
    return NextResponse.json(
      { accepted: true, message: "Clover webhook received, no syncable events." },
      { status: 200 }
    );
  }

  const results = [];
  for (const event of events) {
    const queued = await queueCloverWebhookSyncs({
      eventType: event.jobType,
      eventId: event.objectId,
      merchantId: event.merchantId,
      locationId: event.merchantId,
    });
    results.push(queued);
  }

  return NextResponse.json(
    { accepted: true, events: results.length, results },
    { status: 200 }
  );
}
