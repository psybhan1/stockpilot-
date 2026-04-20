import { NextRequest, NextResponse } from "next/server";
import { sendTelegramChannelMessage } from "@/modules/channels/service";

function validateSecret(request: NextRequest) {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) return true;
  return request.headers.get("X-StockPilot-Webhook-Secret") === secret;
}

/**
 * POST /api/notify/telegram
 *
 * Called by n8n (or any internal service) to send a Telegram message to a
 * specific location's connected Telegram chat.
 *
 * Body: { locationId: string, message: string }
 */
export async function POST(request: NextRequest) {
  if (!validateSecret(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { locationId?: string; message?: string };
  const { locationId, message } = body;

  if (!locationId || !message) {
    return NextResponse.json(
      { message: "Missing required fields: locationId, message" },
      { status: 400 }
    );
  }

  try {
    await sendTelegramChannelMessage(locationId, message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[notify/telegram] error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to send Telegram message" },
      { status: 500 }
    );
  }
}
