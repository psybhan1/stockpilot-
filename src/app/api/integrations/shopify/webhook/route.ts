import { NextResponse } from "next/server";

import { ShopifyProvider } from "@/providers/pos/shopify";
import { queueShopifyWebhookSyncs } from "@/modules/pos/service";

/**
 * Shopify webhook receiver.
 *
 * Shopify signs every webhook with HMAC-SHA256 of the raw body using
 * the app's client secret, base64-encoded, in `X-Shopify-Hmac-Sha256`.
 * The ShopifyProvider.handleWebhook method verifies this; anything
 * unverified returns 401 and gets ignored.
 *
 * Shop domain arrives in `X-Shopify-Shop-Domain`; topic (e.g.
 * "orders/create", "products/update") arrives in `X-Shopify-Topic`.
 * We use the topic prefix to decide whether to re-sync catalog vs
 * sales, same pattern as Square/Clover.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  let payload: unknown = {};

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { accepted: false, message: "Shopify webhook payload was not valid JSON." },
        { status: 400 }
      );
    }
  }

  const signature = request.headers.get("x-shopify-hmac-sha256");
  const shopDomain = request.headers.get("x-shopify-shop-domain");
  const topic = request.headers.get("x-shopify-topic");

  const provider = new ShopifyProvider();
  const result = await provider.handleWebhook({
    payload,
    rawBody,
    signature,
    notificationUrl: request.url,
  });

  if (!result.accepted) {
    return NextResponse.json(result, { status: 401 });
  }

  const queued = await queueShopifyWebhookSyncs({
    topic,
    shopDomain,
    eventId: result.eventId,
  });

  return NextResponse.json({ ...result, queue: queued }, { status: 200 });
}
