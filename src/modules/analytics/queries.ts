/**
 * Analytics queries powering /analytics.
 *
 * All queries are scoped to a single locationId and a rolling
 * 30-day window. We compute on-the-fly — no materialised views.
 * For a single-tenant café workload this is fine (<1k POs / month);
 * if it ever stops being fine, swap the per-query aggregates for
 * cached snapshot tables.
 */

import {
  CommunicationDirection,
  CommunicationStatus,
  PurchaseOrderStatus,
  type Prisma,
} from "@/lib/prisma";
import { db } from "@/lib/db";

const WINDOW_DAYS = 30;

export type AnalyticsOverview = {
  windowDays: number;
  ordersSent: number;
  ordersConfirmed: number;
  ordersFailed: number;
  ordersOutOfStock: number;
  totalSpendCents: number;
  averageReplyHours: number | null;
  rescueOrders: number;
  topSuppliers: SupplierScore[];
  topItems: ItemVolume[];
  dailyOrders: Array<{ date: string; count: number }>;
  recentActivity: Array<{
    id: string;
    type: string;
    label: string;
    at: string;
  }>;
};

export type SupplierScore = {
  supplierId: string;
  name: string;
  totalOrders: number;
  confirmed: number;
  declined: number;
  pending: number;
  confirmRate: number; // 0..1
  avgReplyHours: number | null;
  lastActivityAt: string | null;
};

export type ItemVolume = {
  inventoryItemId: string;
  name: string;
  orderCount: number;
  totalQuantityOrdered: number;
  unit: string;
};

export async function getAnalyticsOverview(
  locationId: string
): Promise<AnalyticsOverview> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [
    poAgg,
    outboundEmails,
    inboundReplies,
    rescueCount,
    topSuppliers,
    topItems,
    dailyCountsRaw,
    recentAudit,
  ] = await Promise.all([
    // 1. PO status breakdown
    db.purchaseOrder.groupBy({
      by: ["status"],
      where: {
        locationId,
        createdAt: { gte: since },
      },
      _count: true,
    }),
    // 2. Outbound emails → we pair against INBOUND for avg reply time
    db.supplierCommunication.findMany({
      where: {
        direction: CommunicationDirection.OUTBOUND,
        purchaseOrder: { locationId },
        createdAt: { gte: since },
      },
      select: {
        id: true,
        purchaseOrderId: true,
        createdAt: true,
      },
    }),
    db.supplierCommunication.findMany({
      where: {
        direction: CommunicationDirection.INBOUND,
        purchaseOrder: { locationId },
        createdAt: { gte: since },
      },
      select: {
        purchaseOrderId: true,
        createdAt: true,
        metadata: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    // 3. Rescue orders created in window
    db.purchaseOrder.count({
      where: {
        locationId,
        createdAt: { gte: since },
        metadata: { path: ["source"], equals: "rescue" },
      },
    }),
    // 4. Top suppliers by volume
    getSupplierScorecards(locationId, since),
    // 5. Top items by reorder count
    getTopItems(locationId, since),
    // 6. Daily PO counts
    db.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
      FROM "PurchaseOrder"
      WHERE "locationId" = ${locationId} AND "createdAt" >= ${since}
      GROUP BY day
      ORDER BY day ASC
    `,
    // 7. Recent audit entries — gives a "live feed" feel
    db.auditLog.findMany({
      where: {
        locationId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        id: true,
        action: true,
        entityType: true,
        createdAt: true,
        details: true,
      },
    }),
  ]);

  const ordersSent = sumCount(poAgg, [
    PurchaseOrderStatus.SENT,
    PurchaseOrderStatus.ACKNOWLEDGED,
    PurchaseOrderStatus.DELIVERED,
  ]);
  const ordersFailed = sumCount(poAgg, [PurchaseOrderStatus.FAILED]);

  // Count inbound replies by intent for CONFIRMED / OUT_OF_STOCK.
  let ordersConfirmed = 0;
  let ordersOutOfStock = 0;
  const firstInboundByPo = new Map<string, Date>();
  for (const reply of inboundReplies) {
    const meta = (reply.metadata ?? {}) as Record<string, unknown>;
    const intent = String(meta.intent ?? "").toUpperCase();
    if (intent === "CONFIRMED") ordersConfirmed += 1;
    if (intent === "OUT_OF_STOCK") ordersOutOfStock += 1;
    if (reply.purchaseOrderId && !firstInboundByPo.has(reply.purchaseOrderId)) {
      firstInboundByPo.set(reply.purchaseOrderId, reply.createdAt);
    }
  }

  // Avg reply hours = avg (firstInbound - outbound) across paired pairs.
  const diffs: number[] = [];
  const outboundByPo = new Map<string, Date>();
  for (const o of outboundEmails) {
    if (!o.purchaseOrderId) continue;
    if (!outboundByPo.has(o.purchaseOrderId)) {
      outboundByPo.set(o.purchaseOrderId, o.createdAt);
    }
  }
  for (const [poId, sent] of outboundByPo) {
    const replied = firstInboundByPo.get(poId);
    if (!replied) continue;
    const ms = replied.getTime() - sent.getTime();
    if (ms > 0) diffs.push(ms / (60 * 60 * 1000));
  }
  const averageReplyHours =
    diffs.length > 0
      ? diffs.reduce((a, b) => a + b, 0) / diffs.length
      : null;

  // Spend: sum of latestCostCents × quantityOrdered across all lines
  // on SENT/ACKNOWLEDGED/DELIVERED POs in the window.
  const spendLines = await db.purchaseOrderLine.findMany({
    where: {
      purchaseOrder: {
        locationId,
        createdAt: { gte: since },
        status: {
          in: [
            PurchaseOrderStatus.SENT,
            PurchaseOrderStatus.ACKNOWLEDGED,
            PurchaseOrderStatus.DELIVERED,
          ],
        },
      },
    },
    select: { quantityOrdered: true, latestCostCents: true },
  });
  const totalSpendCents = spendLines.reduce(
    (sum, l) => sum + (l.latestCostCents ?? 0) * l.quantityOrdered,
    0
  );

  const dailyOrders = dailyCountsRaw.map((row) => ({
    date: row.day.toISOString().slice(0, 10),
    count: Number(row.count),
  }));

  const recentActivity = recentAudit.map((a) => ({
    id: a.id,
    type: a.action,
    label: humanizeAudit(a),
    at: a.createdAt.toISOString(),
  }));

  return {
    windowDays: WINDOW_DAYS,
    ordersSent,
    ordersConfirmed,
    ordersFailed,
    ordersOutOfStock,
    totalSpendCents,
    averageReplyHours,
    rescueOrders: rescueCount,
    topSuppliers,
    topItems,
    dailyOrders,
    recentActivity,
  };
}

async function getSupplierScorecards(
  locationId: string,
  since: Date
): Promise<SupplierScore[]> {
  const suppliers = await db.supplier.findMany({
    where: { locationId },
    select: {
      id: true,
      name: true,
      purchaseOrders: {
        where: { createdAt: { gte: since } },
        select: {
          id: true,
          status: true,
          createdAt: true,
          communications: {
            select: {
              direction: true,
              createdAt: true,
              metadata: true,
              status: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  return suppliers
    .map((s): SupplierScore => {
      const total = s.purchaseOrders.length;
      let confirmed = 0;
      let declined = 0;
      let pending = 0;
      const replyDiffs: number[] = [];
      let lastActivity: Date | null = null;
      for (const po of s.purchaseOrders) {
        const outbound = po.communications.find(
          (c) => c.direction === CommunicationDirection.OUTBOUND
        );
        const inbound = po.communications.find(
          (c) => c.direction === CommunicationDirection.INBOUND
        );
        if (outbound && !lastActivity) lastActivity = outbound.createdAt;
        if (outbound && lastActivity && outbound.createdAt > lastActivity)
          lastActivity = outbound.createdAt;
        if (inbound) {
          const meta = (inbound.metadata ?? {}) as Record<string, unknown>;
          const intent = String(meta.intent ?? "").toUpperCase();
          if (intent === "CONFIRMED") confirmed += 1;
          else if (intent === "OUT_OF_STOCK") declined += 1;
          if (outbound) {
            const ms = inbound.createdAt.getTime() - outbound.createdAt.getTime();
            if (ms > 0) replyDiffs.push(ms / (60 * 60 * 1000));
          }
        } else if (
          po.status === PurchaseOrderStatus.SENT ||
          po.status === PurchaseOrderStatus.APPROVED
        ) {
          pending += 1;
        }
      }
      const confirmRate =
        confirmed + declined > 0 ? confirmed / (confirmed + declined) : 0;
      const avgReplyHours =
        replyDiffs.length > 0
          ? replyDiffs.reduce((a, b) => a + b, 0) / replyDiffs.length
          : null;
      return {
        supplierId: s.id,
        name: s.name,
        totalOrders: total,
        confirmed,
        declined,
        pending,
        confirmRate,
        avgReplyHours,
        lastActivityAt: lastActivity ? lastActivity.toISOString() : null,
      };
    })
    .filter((s) => s.totalOrders > 0)
    .sort((a, b) => b.totalOrders - a.totalOrders)
    .slice(0, 10);
}

async function getTopItems(
  locationId: string,
  since: Date
): Promise<ItemVolume[]> {
  const lines = await db.purchaseOrderLine.findMany({
    where: {
      purchaseOrder: { locationId, createdAt: { gte: since } },
    },
    select: {
      inventoryItemId: true,
      quantityOrdered: true,
      purchaseUnit: true,
      inventoryItem: { select: { name: true, displayUnit: true } },
    },
  });
  const byItem = new Map<
    string,
    { name: string; count: number; total: number; unit: string }
  >();
  for (const line of lines) {
    const prev = byItem.get(line.inventoryItemId) ?? {
      name: line.inventoryItem.name,
      count: 0,
      total: 0,
      unit: line.inventoryItem.displayUnit.toLowerCase(),
    };
    byItem.set(line.inventoryItemId, {
      ...prev,
      count: prev.count + 1,
      total: prev.total + line.quantityOrdered,
    });
  }
  return Array.from(byItem.entries())
    .map(([id, v]) => ({
      inventoryItemId: id,
      name: v.name,
      orderCount: v.count,
      totalQuantityOrdered: v.total,
      unit: v.unit,
    }))
    .sort((a, b) => b.orderCount - a.orderCount)
    .slice(0, 10);
}

function sumCount(
  rows: Array<{ status: PurchaseOrderStatus; _count: number }>,
  statuses: PurchaseOrderStatus[]
): number {
  return rows
    .filter((r) => statuses.includes(r.status))
    .reduce((sum, r) => sum + r._count, 0);
}

function humanizeAudit(a: {
  action: string;
  entityType: string;
  details: Prisma.JsonValue | null;
}): string {
  const parts = a.action.split(".");
  const last = parts[parts.length - 1]?.replace(/_/g, " ") ?? a.action;
  return `${last}`;
}
