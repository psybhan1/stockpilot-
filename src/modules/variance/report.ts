/**
 * Theoretical-vs-actual variance report.
 *
 * This is the feature that turns an inventory app from "nice
 * dashboard" into "catches $500/week in waste you didn't know
 * about." Competitors charge $300-500/mo for this.
 *
 * ## The math
 *
 * Over a date range, for each inventory item we split the
 * period's StockMovements into three buckets and one reference:
 *
 *   - Theoretical usage (reference): POS_DEPLETION. The ledger
 *     already derives these from `sale × recipe` — so it IS the
 *     recipe-implied depletion, by construction.
 *
 *   - Tracked waste: WASTE + BREAKAGE + TRANSFER. Losses someone
 *     explicitly logged (pour-over mistakes, drops, inter-location
 *     transfers). These are known and already-accounted-for, but
 *     surface them so managers see HOW much they lose to things
 *     they're paying attention to vs. things they aren't.
 *
 *   - Unknown shrinkage: CORRECTION + MANUAL_COUNT_ADJUSTMENT.
 *     These are the "mystery delta" movements — the gap that
 *     surfaces when a count shows less (or more) than the books
 *     predicted. This is the actual theoretical-vs-actual signal:
 *     everything the POS and recipe should have accounted for, vs
 *     what you can physically count. Over-pouring, un-rung sales,
 *     spillage nobody logged, bad initial counts, theft.
 *
 *   - RETURN and RECEIVING are not loss sources and aren't bucketed
 *     here — they show up in "received" for context only.
 *
 * Shrinkage and waste both cost money: `|unit_delta| × cost_per_unit_base`.
 * Cost per base unit comes from the cheapest SupplierItem with a
 * recorded price — same policy as the margin dashboard, so numbers
 * line up across pages.
 *
 * ## Severity
 *
 * Two axes: absolute dollar loss AND percent of theoretical usage.
 * A 10% shrinkage on an item that moves $500/wk is a bigger deal
 * than 10% on one that moves $20/wk — but both matter.
 *
 *   review: shrinkage% > 5%  OR  shrinkage$ > $50 (over the range)
 *   watch:  shrinkage% > 2%  OR  shrinkage$ > $15
 *   clean:  otherwise
 *
 * Thresholds are tunable per business later.
 */

import type { MovementType } from "@/lib/prisma";

import { db } from "@/lib/db";
import {
  calculateVarianceRow,
  classifyVarianceSeverity,
  emptyBuckets,
  type MovementBreakdown,
  type VarianceRow,
  type VarianceSeverity,
} from "./math";

export { calculateVarianceRow, classifyVarianceSeverity };
export type { VarianceRow, VarianceSeverity };

export type VarianceSummary = {
  from: Date;
  to: Date;
  totalLossCents: number;
  trackedWasteCents: number;
  shrinkageCents: number;
  itemCount: number;
  flaggedCount: number;
  rows: VarianceRow[];
};

export async function getVarianceReport(
  locationId: string,
  opts?: { days?: number; from?: Date; to?: Date }
): Promise<VarianceSummary> {
  const to = opts?.to ?? new Date();
  const from =
    opts?.from ??
    new Date(to.getTime() - (opts?.days ?? 7) * 24 * 60 * 60 * 1000);

  // One grouped query gets all the movement totals per item × type.
  // groupBy returns numeric sums; we reshape into per-item buckets.
  const groups = await db.stockMovement.groupBy({
    by: ["inventoryItemId", "movementType"],
    where: {
      locationId,
      performedAt: { gte: from, lte: to },
    },
    _sum: { quantityDeltaBase: true },
  });

  // Resolve item + supplier pricing in a single follow-up query.
  const itemIds = Array.from(new Set(groups.map((g) => g.inventoryItemId)));
  if (itemIds.length === 0) {
    return {
      from,
      to,
      totalLossCents: 0,
      trackedWasteCents: 0,
      shrinkageCents: 0,
      itemCount: 0,
      flaggedCount: 0,
      rows: [],
    };
  }
  const items = await db.inventoryItem.findMany({
    where: { id: { in: itemIds }, locationId },
    select: {
      id: true,
      name: true,
      category: true,
      displayUnit: true,
      packSizeBase: true,
      supplierItems: {
        where: { lastUnitCostCents: { not: null } },
        select: { lastUnitCostCents: true },
        orderBy: { lastUnitCostCents: "asc" },
        take: 1,
      },
    },
  });
  const itemById = new Map(items.map((i) => [i.id, i]));

  // Aggregate groups into per-item buckets.
  const bucketsByItem = new Map<string, MovementBreakdown>();
  for (const g of groups) {
    const bucket = bucketsByItem.get(g.inventoryItemId) ?? emptyBuckets();
    const delta = g._sum.quantityDeltaBase ?? 0;
    bucket[movementTypeToBucket(g.movementType)] += delta;
    bucketsByItem.set(g.inventoryItemId, bucket);
  }

  const rows: VarianceRow[] = [];
  for (const [id, buckets] of bucketsByItem.entries()) {
    const item = itemById.get(id);
    if (!item) continue;
    rows.push(
      calculateVarianceRow({
        inventoryItemId: id,
        itemName: item.name,
        category: item.category,
        displayUnit: item.displayUnit,
        packSizeBase: item.packSizeBase,
        unitCostCents: item.supplierItems[0]?.lastUnitCostCents ?? null,
        buckets,
      })
    );
  }

  // Worst offenders first.
  rows.sort((a, b) => {
    const ba = a.shrinkageCents ?? -1;
    const bb = b.shrinkageCents ?? -1;
    if (ba !== bb) return bb - ba;
    return (b.trackedWasteCents ?? 0) - (a.trackedWasteCents ?? 0);
  });

  const totalLossCents = rows.reduce(
    (sum, r) => sum + (r.trackedWasteCents ?? 0) + (r.shrinkageCents ?? 0),
    0
  );
  const trackedWasteCents = rows.reduce(
    (sum, r) => sum + (r.trackedWasteCents ?? 0),
    0
  );
  const shrinkageCents = rows.reduce(
    (sum, r) => sum + (r.shrinkageCents ?? 0),
    0
  );
  const flaggedCount = rows.filter((r) => r.severity !== "clean").length;

  return {
    from,
    to,
    totalLossCents,
    trackedWasteCents,
    shrinkageCents,
    itemCount: rows.length,
    flaggedCount,
    rows,
  };
}

/**
 * Full list of variance-contributing movements for a single item,
 * so the UI can show "here's every CORRECTION / WASTE / count that
 * made up the reported loss number."
 */
export async function getItemVarianceDetail(
  locationId: string,
  inventoryItemId: string,
  opts?: { days?: number; from?: Date; to?: Date }
) {
  const to = opts?.to ?? new Date();
  const from =
    opts?.from ??
    new Date(to.getTime() - (opts?.days ?? 7) * 24 * 60 * 60 * 1000);

  const item = await db.inventoryItem.findFirst({
    where: { id: inventoryItemId, locationId },
    select: {
      id: true,
      name: true,
      displayUnit: true,
      packSizeBase: true,
      supplierItems: {
        where: { lastUnitCostCents: { not: null } },
        select: { lastUnitCostCents: true },
        orderBy: { lastUnitCostCents: "asc" },
        take: 1,
      },
    },
  });
  if (!item) return null;

  const movements = await db.stockMovement.findMany({
    where: {
      locationId,
      inventoryItemId,
      performedAt: { gte: from, lte: to },
    },
    orderBy: { performedAt: "desc" },
    take: 500,
    select: {
      id: true,
      movementType: true,
      quantityDeltaBase: true,
      notes: true,
      performedAt: true,
      sourceType: true,
      sourceId: true,
    },
  });

  return {
    from,
    to,
    item: {
      id: item.id,
      name: item.name,
      displayUnit: item.displayUnit,
      packSizeBase: item.packSizeBase,
      unitCostCents: item.supplierItems[0]?.lastUnitCostCents ?? null,
    },
    movements: movements.map((m) => ({
      id: m.id,
      type: m.movementType,
      deltaBase: m.quantityDeltaBase,
      notes: m.notes,
      performedAt: m.performedAt.toISOString(),
      sourceType: m.sourceType,
      sourceId: m.sourceId,
    })),
  };
}

// ── helpers ─────────────────────────────────────────────────────────

function movementTypeToBucket(t: MovementType): keyof MovementBreakdown {
  switch (t) {
    case "POS_DEPLETION":
      return "pos_depletion";
    case "WASTE":
      return "waste";
    case "BREAKAGE":
      return "breakage";
    case "TRANSFER":
      return "transfer";
    case "CORRECTION":
      return "correction";
    case "MANUAL_COUNT_ADJUSTMENT":
      return "count_adjustment";
    case "RECEIVING":
      return "received";
    case "RETURN":
      return "returned";
    default:
      // Exhaustive switch — if MovementType grows we want a compile error.
      return absurd(t);
  }
}

function absurd(_x: never): never {
  throw new Error(`Unhandled movement type`);
}
