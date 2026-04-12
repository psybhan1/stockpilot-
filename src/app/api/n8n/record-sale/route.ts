import { NextRequest, NextResponse } from "next/server";
import { processSaleEventById } from "@/modules/inventory/ledger";

function validateSecret(request: NextRequest) {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) return true;
  return request.headers.get("X-StockPilot-Webhook-Secret") === secret;
}

export async function POST(request: NextRequest) {
  if (!validateSecret(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const saleEventId = String(body.saleEventId ?? "").trim();

    if (!saleEventId) {
      return NextResponse.json({ message: "Missing saleEventId" }, { status: 400 });
    }

    await processSaleEventById(saleEventId);

    return NextResponse.json({
      ok: true,
      saleEventId,
    });
  } catch (error) {
    console.error("[record-sale] error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
