/**
 * Pure price-history math. Kept separate from history.ts so the
 * summarisation logic can be unit-tested without dragging a DB in.
 */

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
