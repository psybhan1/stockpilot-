/**
 * Global search endpoint for the command palette. Returns up to N
 * results across inventory items, suppliers, purchase orders, and
 * menu variants — scoped to the signed-in location.
 *
 * Sort priority is "exact prefix match > contains > recent" within
 * each kind, then the UI groups by kind. We keep per-kind `take`
 * small (6-8) so a broad query like "milk" returns a manageable
 * number of results across multiple categories instead of flooding
 * one section.
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

  const [items, suppliers, purchaseOrders, menuVariants] = await Promise.all([
    db.inventoryItem.findMany({
      where: {
        locationId: session.locationId,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, sku: true, category: true },
      take: 8,
      orderBy: { name: "asc" },
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
      orderBy: { name: "asc" },
    }),
    db.purchaseOrder.findMany({
      where: {
        locationId: session.locationId,
        OR: [
          { orderNumber: { contains: q, mode: "insensitive" } },
          { supplier: { name: { contains: q, mode: "insensitive" } } },
        ],
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
    db.menuItemVariant.findMany({
      where: {
        menuItem: { locationId: session.locationId },
        active: true,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { menuItem: { name: { contains: q, mode: "insensitive" } } },
        ],
      },
      select: {
        id: true,
        name: true,
        menuItem: { select: { id: true, name: true } },
      },
      take: 6,
    }),
  ]);

  return NextResponse.json({
    ok: true,
    results: [
      ...items.map((i) => ({
        kind: "item" as const,
        id: i.id,
        label: i.name,
        detail: i.sku ?? i.category.replaceAll("_", " ").toLowerCase(),
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
      ...menuVariants.map((v) => ({
        kind: "menu_variant" as const,
        id: v.id,
        label: v.menuItem.name + (v.name ? ` · ${v.name}` : ""),
        detail: "menu item · recipe",
        href: `/recipes?menuItem=${encodeURIComponent(v.menuItem.id)}`,
      })),
    ],
  });
}
