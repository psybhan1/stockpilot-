import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

function validateSecret(request: NextRequest) {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) return true;
  return request.headers.get("X-StockPilot-Webhook-Secret") === secret;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateSecret(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const po = await db.purchaseOrder.findUnique({
      where: { id },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        createdAt: true,
        supplier: {
          select: {
            id: true,
            name: true,
            email: true,
            orderingMode: true,
            contactName: true,
          },
        },
        lines: {
          select: {
            description: true,
            quantityOrdered: true,
            purchaseUnit: true,
            latestCostCents: true,
            inventoryItem: { select: { name: true } },
          },
        },
        location: { select: { name: true } },
      },
    });

    if (!po) {
      return NextResponse.json({ message: "Purchase order not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      purchaseOrder: {
        id: po.id,
        orderNumber: po.orderNumber,
        status: po.status,
        createdAt: po.createdAt,
        locationName: po.location.name,
        supplier: {
          id: po.supplier.id,
          name: po.supplier.name,
          email: po.supplier.email,
          orderingMode: po.supplier.orderingMode,
          contactName: po.supplier.contactName,
        },
        lines: po.lines.map((l) => ({
          description: l.description,
          quantity: l.quantityOrdered,
          unit: l.purchaseUnit.toLowerCase(),
          itemName: l.inventoryItem.name,
          unitCostCents: l.latestCostCents ?? null,
        })),
      },
    });
  } catch (error) {
    console.error("[purchase-order] error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
