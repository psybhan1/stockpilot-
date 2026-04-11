import { NextResponse } from "next/server";

import { getPosProvider } from "@/providers/pos-provider";
import { queueSquareWebhookSyncs } from "@/modules/pos/service";

export async function POST(request: Request) {
  const rawBody = await request.text();
  let payload: unknown = {};

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        {
          accepted: false,
          message: "Square webhook payload was not valid JSON.",
        },
        { status: 400 }
      );
    }
  }

  const provider = getPosProvider();
  const result = await provider.handleWebhook({
    payload,
    rawBody,
    signature: request.headers.get("x-square-hmacsha256-signature"),
    notificationUrl: request.url,
  });

  if (!result.accepted) {
    return NextResponse.json(result, { status: 400 });
  }

  const queued = await queueSquareWebhookSyncs({
    eventType: result.eventType,
    eventId: result.eventId,
    merchantId: result.merchantId,
    locationId: result.locationId,
  });

  return NextResponse.json(
    {
      ...result,
      queue: queued,
    },
    { status: 200 }
  );
}
