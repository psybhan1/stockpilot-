/**
 * Global search endpoint for the command palette. Returns up to N
 * results across inventory items, suppliers, and purchase orders,
 * scoped to the signed-in location.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/modules/auth/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length === 0) {
    return NextResponse.json({ ok: true, results: [] });
  }

  const [items, suppliers, purchaseOrders] = await Promise.all([
    db.inventoryItem.findMany({
      where: {
        locationId: session.locationId,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, sku: true },
      take: 8,
    }),
    db.supplier.findMany({
      where: {
        locationId: session.locationId,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, email: true },
      take: 6,
    }),
    db.purchaseOrder.findMany({
      where: {
        locationId: session.locationId,
        orderNumber: { contains: q, mode: "insensitive" },
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        supplier: { select: { name: true } },
      },
      take: 6,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    results: [
      ...items.map((i) => ({
        kind: "item" as const,
        id: i.id,
        label: i.name,
        detail: i.sku,
        href: `/inventory/${i.id}`,
      })),
      ...suppliers.map((s) => ({
        kind: "supplier" as const,
        id: s.id,
        label: s.name,
        detail: s.email ?? "no email",
        href: `/suppliers/${s.id}`,
      })),
      ...purchaseOrders.map((p) => ({
        kind: "purchase_order" as const,
        id: p.id,
        label: p.orderNumber,
        detail: `${p.supplier.name} · ${p.status.toLowerCase()}`,
        href: `/purchase-orders/${p.id}`,
      })),
    ],
  });
}
