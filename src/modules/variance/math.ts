/**
 * Pure variance math. Split out from `report.ts` so the correctness-
 * critical classification + per-item rollup can be unit-tested
 * without pulling Prisma into the test harness.
 *
 * All the doc commentary on thresholds lives in report.ts — this
 * file is the reference implementation those docs describe.
 */

export type VarianceSeverity = "clean" | "watch" | "review";

export type MovementBreakdown = {
  pos_depletion: number;
  waste: number;
  breakage: number;
  transfer: number;
  correction: number;
  count_adjustment: number;
  received: number;
  returned: number;
};

export type VarianceRow = {
  inventoryItemId: string;
  itemName: string;
  category: string | null;
  displayUnit: string;
  packSizeBase: number;
  /** cents per purchase pack (null if no supplier price on file) */
  unitCostCents: number | null;

  /** Base-unit quantities for the range — all positive numbers. */
  receivedBase: number;
  theoreticalUsageBase: number;
  trackedWasteBase: number;
  shrinkageBase: number;

  /** Dollar values. Null when unitCostCents is null. */
  theoreticalUsageCents: number | null;
  trackedWasteCents: number | null;
  shrinkageCents: number | null;

  /** shrinkage as a fraction of theoretical usage, 0..∞. null when no theoretical. */
  shrinkagePct: number | null;

  severity: VarianceSeverity;

  /** Breakdown of the shrinkage bucket — handy for the detail view */
  movementBreakdown: MovementBreakdown;
};

export const LOSS_DOLLAR_WATCH_CENTS = 1500; // $15
export const LOSS_DOLLAR_REVIEW_CENTS = 5000; // $50
export const SHRINK_PCT_WATCH = 0.02;
export const SHRINK_PCT_REVIEW = 0.05;

export function classifyVarianceSeverity(input: {
  shrinkageCents: number | null;
  shrinkagePct: number | null;
}): VarianceSeverity {
  const cents = input.shrinkageCents ?? 0;
  const pct = input.shrinkagePct ?? 0;
  if (cents >= LOSS_DOLLAR_REVIEW_CENTS || pct >= SHRINK_PCT_REVIEW) return "review";
  if (cents >= LOSS_DOLLAR_WATCH_CENTS || pct >= SHRINK_PCT_WATCH) return "watch";
  return "clean";
}

export function emptyBuckets(): MovementBreakdown {
  return {
    pos_depletion: 0,
    waste: 0,
    breakage: 0,
    transfer: 0,
    correction: 0,
    count_adjustment: 0,
    received: 0,
    returned: 0,
  };
}

export function calculateVarianceRow(input: {
  inventoryItemId: string;
  itemName: string;
  category: string | null;
  displayUnit: string;
  packSizeBase: number;
  unitCostCents: number | null;
  buckets: MovementBreakdown;
}): VarianceRow {
  const b = input.buckets;
  const trackedWasteBase = Math.abs(b.waste) + Math.abs(b.breakage) + Math.abs(b.transfer);
  // Shrinkage = non-tracked loss. Correction + manual count adjustment
  // can go either direction. Negative deltas (lost more than the
  // books knew) are loss; positive deltas (found more than expected)
  // offset. We keep the SIGN here so an item with +adjustment shows
  // negative shrinkage — it means the books were pessimistic and
  // you actually have more than you thought.
  // `+ 0` normalizes -0 → 0 so JSON / equality checks don't surface signed-zero.
  const shrinkageBase = -(b.correction + b.count_adjustment) + 0;
  const theoreticalUsageBase = Math.abs(b.pos_depletion);

  const costPerBase =
    input.unitCostCents != null && input.packSizeBase > 0
      ? input.unitCostCents / input.packSizeBase
      : null;

  const theoreticalUsageCents =
    costPerBase != null ? Math.round(theoreticalUsageBase * costPerBase) : null;
  const trackedWasteCents =
    costPerBase != null ? Math.round(trackedWasteBase * costPerBase) : null;
  // Shrinkage cost uses absolute value — "money lost" is positive
  // whether books were over- or under-pessimistic.
  const shrinkageCents =
    costPerBase != null ? Math.round(Math.abs(shrinkageBase) * costPerBase) : null;

  const shrinkagePct =
    theoreticalUsageBase > 0 ? shrinkageBase / theoreticalUsageBase : null;

  const severity = classifyVarianceSeverity({
    shrinkageCents,
    shrinkagePct: shrinkagePct != null ? Math.abs(shrinkagePct) : null,
  });

  return {
    inventoryItemId: input.inventoryItemId,
    itemName: input.itemName,
    category: input.category,
    displayUnit: input.displayUnit,
    packSizeBase: input.packSizeBase,
    unitCostCents: input.unitCostCents,
    receivedBase: Math.abs(b.received),
    theoreticalUsageBase,
    trackedWasteBase,
    shrinkageBase,
    theoreticalUsageCents,
    trackedWasteCents,
    shrinkageCents,
    shrinkagePct,
    severity,
    movementBreakdown: b,
  };
}
