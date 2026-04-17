/**
 * Per-ingredient price history, derived from the actual-cost data
 * the invoice OCR / manual receive flow has been capturing since
 * `PurchaseOrderLine.actualUnitCostCents` shipped.
 *
 * Data source: every delivered PO line with a non-null
 * `actualUnitCostCents` is a data point at `PurchaseOrder.
 * deliveredAt`. No new schema, no new writes — we're reading a
 * time-series that's been accumulating on its own.
 *
 * Use cases:
 *   - Sparkline next to each ingredient on the variance page
 *   - /pricing dashboard that ranks ingredients by absolute %
 *     swing, so the manager sees "milk went up 12% this month"
 *     at a glance
 *   - "Affected menu items" count per ingredient (via recipe
 *     components), so the dashboard answers "your latte's COGS
 *     is up because of this supplier change"
 *
 * Pure math (summarizePriceChange + classifyPriceTrend) split
 * from DB queries so tests can drive both without mocking.
 */
import { db } from "@/lib/db";

export type PriceHistoryPoint = {
  at: string; // ISO date (PO deliveredAt)
  unitCostCents: number;
  supplierId: string;
  supplierName: string;
  purchaseOrderId: string;
  orderNumber: string;
};

export type PriceHistory = {
  inventoryItemId: string;
  points: PriceHistoryPoint[];
};

export type PriceTrend = "up" | "down" | "flat" | "unknown";

export type PriceChangeSummary = {
  currentCents: number | null;
  baselineCents: number | null;
  deltaCents: number | null;
  deltaPct: number | null;
  trend: PriceTrend;
  severity: "clean" | "watch" | "review";
  points: number;
};

/**
 * Summarise a time-series of price points into a headline
 * delta. "Current" = latest point; "baseline" = earliest in the
 * window. Returns null deltas when fewer than 2 points are
 * available so the UI can honestly say "not enough data yet."
 *
 * Severity is driven by absolute percentage swing, matching the
 * variance-report thresholds so the UI reads consistently:
 *
 *   ≥ 15% absolute swing      → review (significant)
 *   ≥ 5% absolute swing       → watch (worth noting)
 *   otherwise                 → clean
 *
 * Positive delta + review severity = ingredient cost creep
 * (margin attack). Negative delta + review = you might have a new
 * cheaper source and the reorder engine should know.
 */
export function summarizePriceChange(points: PriceHistoryPoint[]): PriceChangeSummary {
  if (points.length === 0) {
    return {
      currentCents: null,
      baselineCents: null,
      deltaCents: null,
      deltaPct: null,
      trend: "unknown",
      severity: "clean",
      points: 0,
    };
  }
  const sorted = [...points].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );
  const currentCents = sorted[sorted.length - 1].unitCostCents;
  if (sorted.length === 1) {
    return {
      currentCents,
      baselineCents: null,
      deltaCents: null,
      deltaPct: null,
      trend: "unknown",
      severity: "clean",
      points: 1,
    };
  }
  const baselineCents = sorted[0].unitCostCents;
  const deltaCents = currentCents - baselineCents;
  const deltaPct = baselineCents > 0 ? deltaCents / baselineCents : null;
  const absPct = deltaPct != null ? Math.abs(deltaPct) : 0;
  const trend: PriceTrend =
    deltaCents > 0 ? "up" : deltaCents < 0 ? "down" : "flat";
  const severity =
    absPct >= 0.15 ? "review" : absPct >= 0.05 ? "watch" : "clean";
  return {
    currentCents,
    baselineCents,
    deltaCents,
    deltaPct,
    trend,
    severity,
    points: sorted.length,
  };
}

/**
 * Fetch price history for a set of inventory items at a location.
 * Returns a map keyed by item id — items with no delivered-with-
 * actual-cost PO lines get an empty points array rather than being
 * absent, so callers can always look up "how many data points does
 * this item have."
 *
 * Queries a window bounded by `opts.days` (default 90) so we don't
 * drag in data from years ago — a restaurant changing suppliers 2
 * years ago shouldn't dominate this month's "biggest swing" list.
 */
export async function getPriceHistoryBatch(
  locationId: string,
  inventoryItemIds: string[],
  opts?: { days?: number; from?: Date; to?: Date }
): Promise<Map<string, PriceHistory>> {
  const to = opts?.to ?? new Date();
  const from =
    opts?.from ??
    new Date(to.getTime() - (opts?.days ?? 90) * 24 * 60 * 60 * 1000);

  const out = new Map<string, PriceHistory>();
  for (const id of inventoryItemIds) {
    out.set(id, { inventoryItemId: id, points: [] });
  }
  if (inventoryItemIds.length === 0) return out;

  const lines = await db.purchaseOrderLine.findMany({
    where: {
      inventoryItemId: { in: inventoryItemIds },
      actualUnitCostCents: { not: null },
      purchaseOrder: {
        locationId,
        deliveredAt: { gte: from, lte: to, not: null },
      },
    },
    select: {
      inventoryItemId: true,
      actualUnitCostCents: true,
      purchaseOrder: {
        select: {
          id: true,
          orderNumber: true,
          deliveredAt: true,
          supplier: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { purchaseOrder: { deliveredAt: "asc" } },
  });

  for (const line of lines) {
    if (line.actualUnitCostCents == null) continue;
    if (line.purchaseOrder.deliveredAt == null) continue;
    const bucket = out.get(line.inventoryItemId);
    if (!bucket) continue;
    bucket.points.push({
      at: line.purchaseOrder.deliveredAt.toISOString(),
      unitCostCents: line.actualUnitCostCents,
      supplierId: line.purchaseOrder.supplier.id,
      supplierName: line.purchaseOrder.supplier.name,
      purchaseOrderId: line.purchaseOrder.id,
      orderNumber: line.purchaseOrder.orderNumber,
    });
  }
  return out;
}

/**
 * Single-item convenience wrapper.
 */
export async function getPriceHistory(
  locationId: string,
  inventoryItemId: string,
  opts?: { days?: number; from?: Date; to?: Date }
): Promise<PriceHistory> {
  const map = await getPriceHistoryBatch(locationId, [inventoryItemId], opts);
  return map.get(inventoryItemId) ?? { inventoryItemId, points: [] };
}

// ── Dashboard query: ranked "biggest price swings" ──────────────────

export type PricingRow = {
  inventoryItemId: string;
  itemName: string;
  category: string | null;
  displayUnit: string;
  packSizeBase: number;
  summary: PriceChangeSummary;
  /** How many approved recipes reference this ingredient — a
   *  proxy for blast-radius when the price moves. */
  affectedMenuCount: number;
  /** Latest data point's supplier, for "priced by X" context. */
  currentSupplierName: string | null;
  /** Sparkline sampling: the raw points, trimmed to the last N
   *  (default 12) so a long list of dots doesn't dominate the
   *  rendered chart. */
  points: PriceHistoryPoint[];
};

export type PricingDashboard = {
  from: Date;
  to: Date;
  /** All items sorted by |deltaPct| descending — biggest swing first. */
  rows: PricingRow[];
  /** # of items flagged as review / watch severity. */
  reviewCount: number;
  watchCount: number;
};

const SPARK_POINTS = 12;

export async function getPricingDashboard(
  locationId: string,
  opts?: { days?: number }
): Promise<PricingDashboard> {
  const to = new Date();
  const from = new Date(to.getTime() - (opts?.days ?? 90) * 24 * 60 * 60 * 1000);

  // One pass: all items that have ANY price-history data in the
  // window. Items with no actuals yet are filtered out — they're
  // just noise in a "price trends" view.
  const items = await db.inventoryItem.findMany({
    where: {
      locationId,
      purchaseOrderLines: {
        some: {
          actualUnitCostCents: { not: null },
          purchaseOrder: {
            deliveredAt: { gte: from, lte: to, not: null },
          },
        },
      },
    },
    select: {
      id: true,
      name: true,
      category: true,
      displayUnit: true,
      packSizeBase: true,
      recipeComponents: {
        where: {
          recipe: { status: "APPROVED" },
        },
        select: { recipeId: true },
      },
    },
  });

  if (items.length === 0) {
    return { from, to, rows: [], reviewCount: 0, watchCount: 0 };
  }

  const historyMap = await getPriceHistoryBatch(
    locationId,
    items.map((i) => i.id),
    { from, to }
  );

  const rows: PricingRow[] = [];
  for (const item of items) {
    const history = historyMap.get(item.id);
    if (!history || history.points.length === 0) continue;
    const summary = summarizePriceChange(history.points);
    rows.push({
      inventoryItemId: item.id,
      itemName: item.name,
      category: item.category,
      displayUnit: item.displayUnit,
      packSizeBase: item.packSizeBase,
      summary,
      // Count distinct recipes rather than components (a recipe
      // can reference the same item twice — once as ingredient,
      // once as packaging).
      affectedMenuCount: new Set(
        item.recipeComponents.map((c) => c.recipeId)
      ).size,
      currentSupplierName:
        history.points[history.points.length - 1]?.supplierName ?? null,
      points: history.points.slice(-SPARK_POINTS),
    });
  }

  rows.sort((a, b) => {
    const ap = Math.abs(a.summary.deltaPct ?? 0);
    const bp = Math.abs(b.summary.deltaPct ?? 0);
    if (ap === bp) return b.summary.points - a.summary.points;
    return bp - ap;
  });

  const reviewCount = rows.filter((r) => r.summary.severity === "review").length;
  const watchCount = rows.filter((r) => r.summary.severity === "watch").length;

  return { from, to, rows, reviewCount, watchCount };
}
