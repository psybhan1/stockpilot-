import { NextRequest, NextResponse } from "next/server";
import { processSaleEventById } from "@/modules/inventory/ledger";
import { verifyN8nRequest } from "@/modules/automation/n8n-auth";

export async function POST(request: NextRequest) {
  const auth = await verifyN8nRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ message: auth.reason }, { status: 401 });
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
