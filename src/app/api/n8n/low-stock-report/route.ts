import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AlertSeverity } from "@/lib/prisma";

function validateSecret(request: NextRequest) {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) return true;
  return request.headers.get("X-StockPilot-Webhook-Secret") === secret;
}

export async function GET(request: NextRequest) {
  if (!validateSecret(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get the first location (single-location setup)
    const location = await db.location.findFirst({
      select: { id: true, name: true },
    });

    if (!location) {
      return NextResponse.json({ message: "No location found" }, { status: 404 });
    }

    // Get all items below par level with snapshot data
    const lowStockItems = await db.inventoryItem.findMany({
      where: {
        locationId: location.id,
        snapshot: {
          urgency: { in: [AlertSeverity.WARNING, AlertSeverity.CRITICAL] },
        },
      },
      select: {
        id: true,
        name: true,
        stockOnHandBase: true,
        parLevelBase: true,
        lowStockThresholdBase: true,
        displayUnit: true,
        primarySupplier: { select: { name: true } },
        snapshot: {
          select: {
            urgency: true,
            daysLeft: true,
            projectedRunoutAt: true,
          },
        },
      },
      orderBy: [
        { snapshot: { urgency: "desc" } },
        { name: "asc" },
      ],
    });

    const items = lowStockItems.map((item) => ({
      id: item.id,
      name: item.name,
      onHand: item.stockOnHandBase,
      par: item.parLevelBase,
      unit: item.displayUnit.toLowerCase(),
      urgency: item.snapshot?.urgency ?? "INFO",
      daysLeft: item.snapshot?.daysLeft ?? null,
      supplier: item.primarySupplier?.name ?? null,
      shortage: Math.max(0, item.parLevelBase - item.stockOnHandBase),
    }));

    const critical = items.filter((i) => i.urgency === "CRITICAL");
    const warning = items.filter((i) => i.urgency === "WARNING");

    return NextResponse.json({
      ok: true,
      locationName: location.name,
      generatedAt: new Date().toISOString(),
      totalLowStock: items.length,
      critical: critical.length,
      warning: warning.length,
      items,
    });
  } catch (error) {
    console.error("[low-stock-report] error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
