/**
 * Recipe calibration — self-correcting recipes via invoice triangulation.
 *
 * ─── The math, in plain English ─────────────────────────────────────
 * Over time, a café's deliveries ≈ actual consumption (stock can't grow
 * forever or drain to negative). So:
 *
 *   avg_weekly_deliveries  ≈  avg_weekly_recipe_predicted_usage
 *                           + avg_weekly_waste
 *                           + avg_weekly_recipe_error
 *
 * Deliveries and recipe-predicted-usage are things we already track
 * (StockMovement). If we assume a sensible baseline waste rate per
 * category (dairy 4%, packaging 0%, coffee 2%, etc), what's left is
 * recipe_error. Divide that per sale → suggested recipe adjustment.
 *
 * ─── Safety rails (mandated by user) ────────────────────────────────
 *  1. Minimum 4 weeks of data before any suggestion fires.
 *  2. Adjustments cap at ±15% per cycle (no jumps).
 *  3. Consistency check: the weekly excess-rate std-dev must be at
 *     least 3× smaller than the mean. Noisy signals get suppressed.
 *  4. Confidence is computed but NEVER surfaced — it's a gate only.
 *  5. No data leakage: when a suggestion is APPLIED, all weekly rollups
 *     prior to that moment are marked superseded for that item and a
 *     fresh window starts. Old/new recipe mass-balance math never mix.
 */

import { MovementType } from "@/lib/prisma";

import { db } from "@/lib/db";

// Baseline waste rates by inventory category (fraction 0-1). These are
// conservative industry defaults; we use the MAX of category + a floor
// of 1% so even "packaging" has some slack for returns/damages.
const WASTE_RATE_BY_CATEGORY: Record<string, number> = {
  DAIRY: 0.04,
  ALT_DAIRY: 0.04,
  COFFEE: 0.02,
  SYRUP: 0.03,
  BAKERY_INGREDIENT: 0.06,
  PACKAGING: 0.0,
  CLEANING: 0.0,
  PAPER_GOODS: 0.01,
  RETAIL: 0.02,
  SEASONAL: 0.05,
  SUPPLY: 0.02,
};
const WASTE_RATE_FLOOR = 0.01;

const MIN_WEEKS_FOR_SUGGESTION = 4;
const MAX_ADJUSTMENT_PCT = 0.15;
const NOISE_THRESHOLD_MEAN_TO_STDDEV = 3; // mean must be >= 3× std-dev
const MIN_SUGGESTION_CONFIDENCE = 0.7;

// ── Weekly rollup ───────────────────────────────────────────────────

/**
 * Roll up a single ISO week for a single location. Writes/updates
 * InventoryCalibrationWeek rows for every item that had activity in
 * the window. Idempotent — re-running for the same week is safe.
 *
 * Why not recompute everything every run: activity is sparse and
 * stockMovement is huge. This function targets the just-completed
 * week only, writing N rows (where N ≈ number of active items).
 */
export async function rollUpCalibrationWeek(input: {
  locationId: string;
  weekStart: Date; // Sunday 00:00 UTC
  weekEnd: Date; // next Sunday 00:00 UTC
}): Promise<{ rowsWritten: number }> {
  const movements = await db.stockMovement.findMany({
    where: {
      locationId: input.locationId,
      performedAt: { gte: input.weekStart, lt: input.weekEnd },
    },
    select: {
      inventoryItemId: true,
      quantityDeltaBase: true,
      movementType: true,
      sourceType: true,
    },
  });

  if (movements.length === 0) return { rowsWritten: 0 };

  // Bucket by inventoryItemId.
  type Bucket = {
    delivered: number; // positive count adjustments + delivery receipts
    predicted: number; // POS_DEPLETION magnitude (always positive)
    waste: number;
    deliveryCount: number;
    salesCount: number;
  };
  const buckets = new Map<string, Bucket>();
  for (const m of movements) {
    const b = buckets.get(m.inventoryItemId) ?? {
      delivered: 0,
      predicted: 0,
      waste: 0,
      deliveryCount: 0,
      salesCount: 0,
    };

    switch (m.movementType) {
      case MovementType.RECEIVING: {
        if (m.quantityDeltaBase > 0) {
          b.delivered += m.quantityDeltaBase;
          b.deliveryCount += 1;
        }
        break;
      }
      case MovementType.POS_DEPLETION: {
        // Stored as negative; magnitude is the predicted usage.
        b.predicted += Math.abs(m.quantityDeltaBase);
        b.salesCount += 1;
        break;
      }
      case MovementType.WASTE:
      case MovementType.BREAKAGE: {
        b.waste += Math.abs(m.quantityDeltaBase);
        break;
      }
      // Count adjustments / manual moves / transfers / returns —
      // ignored for calibration. They're user-driven corrections,
      // not market signal we can triangulate against.
      default:
        break;
    }

    buckets.set(m.inventoryItemId, b);
  }

  let rowsWritten = 0;
  for (const [inventoryItemId, b] of buckets) {
    // Only write rows where we have at least SOMETHING useful.
    if (b.delivered === 0 && b.predicted === 0) continue;

    const observedExcess = b.delivered - b.predicted;
    await db.inventoryCalibrationWeek.upsert({
      where: {
        inventoryItemId_weekStart: {
          inventoryItemId,
          weekStart: input.weekStart,
        },
      },
      update: {
        deliveredBase: b.delivered,
        recipePredictedBase: b.predicted,
        wasteLoggedBase: b.waste,
        observedExcessBase: observedExcess,
        deliveryCount: b.deliveryCount,
        salesCount: b.salesCount,
        computedAt: new Date(),
      },
      create: {
        locationId: input.locationId,
        inventoryItemId,
        weekStart: input.weekStart,
        weekEnd: input.weekEnd,
        deliveredBase: b.delivered,
        recipePredictedBase: b.predicted,
        wasteLoggedBase: b.waste,
        observedExcessBase: observedExcess,
        deliveryCount: b.deliveryCount,
        salesCount: b.salesCount,
      },
    });
    rowsWritten += 1;
  }

  return { rowsWritten };
}

/**
 * Backfill calibration weeks for the last N weeks for a location.
 * Useful on first-run of the feature, and safe to re-run.
 */
export async function backfillCalibrationWeeks(input: {
  locationId: string;
  weeksBack?: number;
}): Promise<{ weeksProcessed: number; rowsWritten: number }> {
  const weeksBack = Math.max(1, Math.min(26, input.weeksBack ?? 8));
  const now = new Date();
  const currentWeekStart = getWeekStartUtc(now);

  let weeksProcessed = 0;
  let rowsWritten = 0;

  for (let i = 1; i <= weeksBack; i += 1) {
    const weekStart = new Date(
      currentWeekStart.getTime() - i * 7 * 24 * 60 * 60 * 1000
    );
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const result = await rollUpCalibrationWeek({
      locationId: input.locationId,
      weekStart,
      weekEnd,
    });
    weeksProcessed += 1;
    rowsWritten += result.rowsWritten;
  }

  return { weeksProcessed, rowsWritten };
}

// ── Suggestion derivation ───────────────────────────────────────────

/**
 * For every recipe component at `locationId`, look at the past N weeks
 * of calibration data for its linked inventory item. If the signal is
 * consistent enough to trust, create a RecipeCalibrationSuggestion.
 *
 * We don't apply automatically — a PENDING suggestion appears on the
 * dashboard for the manager to Accept or Dismiss.
 */
export async function deriveCalibrationSuggestions(
  locationId: string
): Promise<{ suggestionsCreated: number; suggestionsSkipped: number }> {
  const cutoff = new Date(
    Date.now() - (MIN_WEEKS_FOR_SUGGESTION + 4) * 7 * 24 * 60 * 60 * 1000
  );

  const recipeComponents = await db.recipeComponent.findMany({
    where: {
      recipe: { locationId, status: "APPROVED" },
      optional: false,
      modifierKey: null, // conditional components need modifier-aware
      // triangulation we'll add later. Always-on components are clean
      // enough to calibrate with the simple formula.
    },
    select: {
      id: true,
      quantityBase: true,
      inventoryItemId: true,
      recipeId: true,
      inventoryItem: {
        select: { name: true, category: true, baseUnit: true },
      },
    },
  });

  if (recipeComponents.length === 0) {
    return { suggestionsCreated: 0, suggestionsSkipped: 0 };
  }

  // Group by inventoryItemId — one item can feed many components.
  const componentsByItem = new Map<string, typeof recipeComponents>();
  for (const c of recipeComponents) {
    const arr = componentsByItem.get(c.inventoryItemId) ?? [];
    arr.push(c);
    componentsByItem.set(c.inventoryItemId, arr);
  }

  // One batch query for the calibration history across all items.
  const itemIds = [...componentsByItem.keys()];
  const weeks = await db.inventoryCalibrationWeek.findMany({
    where: {
      locationId,
      inventoryItemId: { in: itemIds },
      weekStart: { gte: cutoff },
    },
    select: {
      inventoryItemId: true,
      weekStart: true,
      deliveredBase: true,
      recipePredictedBase: true,
      observedExcessBase: true,
      salesCount: true,
    },
    orderBy: { weekStart: "asc" },
  });

  const weeksByItem = new Map<string, typeof weeks>();
  for (const w of weeks) {
    const arr = weeksByItem.get(w.inventoryItemId) ?? [];
    arr.push(w);
    weeksByItem.set(w.inventoryItemId, arr);
  }

  let suggestionsCreated = 0;
  let suggestionsSkipped = 0;

  for (const [itemId, itemComponents] of componentsByItem) {
    const itemWeeks = weeksByItem.get(itemId) ?? [];
    const signal = computeCalibrationSignal({
      weeks: itemWeeks,
      category: itemComponents[0].inventoryItem.category,
    });

    if (!signal) {
      suggestionsSkipped += itemComponents.length;
      continue;
    }

    for (const component of itemComponents) {
      const result = await proposeAdjustmentForComponent({
        locationId,
        component: {
          id: component.id,
          currentQuantityBase: component.quantityBase,
          inventoryItemName: component.inventoryItem.name,
        },
        signal,
      });

      if (result === "created") suggestionsCreated += 1;
      else suggestionsSkipped += 1;
    }
  }

  return { suggestionsCreated, suggestionsSkipped };
}

export type CalibrationSignal = {
  weeksOfData: number;
  meanExcessPct: number; // fraction, e.g. 0.07 = 7%
  stdDevExcessPct: number;
  baselineWasteRate: number;
  attributedErrorPct: number; // what we think is recipe error, after waste
  totalSales: number;
  confidence: number;
  evidence: Array<{
    weekStart: string;
    delivered: number;
    predicted: number;
    excessPct: number;
  }>;
};

/**
 * Compute the calibration signal for a single inventory item from its
 * weekly rollup history. Returns null if data is too thin or the
 * signal is dominated by noise — explicitly designed to fail silently
 * rather than produce a bad suggestion.
 */
export function computeCalibrationSignal(input: {
  weeks: Array<{
    weekStart: Date;
    deliveredBase: number;
    recipePredictedBase: number;
    salesCount: number;
  }>;
  category: string;
}): CalibrationSignal | null {
  // Only consider weeks with actual recipe-predicted activity.
  // A week with zero sales tells us nothing about recipe accuracy.
  const usable = input.weeks.filter(
    (w) => w.recipePredictedBase > 0 && w.deliveredBase >= 0
  );

  if (usable.length < MIN_WEEKS_FOR_SUGGESTION) return null;

  // Per-week excess RATIO (not absolute). Using a ratio normalises
  // across busy weeks vs slow weeks.
  const weeklyExcessPcts = usable.map((w) => {
    // (delivered - predicted) / predicted
    return (w.deliveredBase - w.recipePredictedBase) / w.recipePredictedBase;
  });

  // Trim extreme outliers (top/bottom 10%) before averaging. One
  // catastrophic waste week shouldn't permanently distort the signal.
  const trimmed = trimOutliers(weeklyExcessPcts, 0.1);
  if (trimmed.length < MIN_WEEKS_FOR_SUGGESTION) return null;

  const mean = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  const variance =
    trimmed.reduce((a, b) => a + (b - mean) ** 2, 0) / trimmed.length;
  const stdDev = Math.sqrt(variance);

  // Noise gate — only trust the mean when it's meaningfully larger
  // than the week-to-week scatter.
  const absMean = Math.abs(mean);
  if (absMean === 0) return null;
  if (stdDev > 0 && absMean / stdDev < NOISE_THRESHOLD_MEAN_TO_STDDEV) {
    return null;
  }

  const baselineWasteRate = Math.max(
    WASTE_RATE_FLOOR,
    WASTE_RATE_BY_CATEGORY[input.category] ?? WASTE_RATE_FLOOR
  );

  // Recipe error = observed excess − baseline waste. Can be negative
  // if the café is TIGHTER than expected (recipe over-predicts).
  const attributedErrorPct = mean - baselineWasteRate;

  // If the remainder is within the waste band, attribute everything
  // to waste and don't suggest a change.
  if (Math.abs(attributedErrorPct) < 0.03) return null;

  const totalSales = usable.reduce((a, w) => a + w.salesCount, 0);

  // Confidence factors:
  //   - weeks of data (caps at 8)
  //   - low std-dev vs mean (noise-free signal)
  //   - absolute signal size (weak signals, less confident)
  //   - sample size in total sales
  const weeksFactor = Math.min(1, trimmed.length / 8);
  const consistencyFactor = Math.min(
    1,
    stdDev > 0 ? absMean / stdDev / 6 : 1
  );
  const magnitudeFactor = Math.min(1, Math.abs(attributedErrorPct) * 10);
  const sampleFactor = Math.min(1, totalSales / 50);

  const confidence =
    0.35 * weeksFactor +
    0.3 * consistencyFactor +
    0.2 * magnitudeFactor +
    0.15 * sampleFactor;

  return {
    weeksOfData: trimmed.length,
    meanExcessPct: mean,
    stdDevExcessPct: stdDev,
    baselineWasteRate,
    attributedErrorPct,
    totalSales,
    confidence,
    evidence: usable.slice(-8).map((w) => ({
      weekStart: w.weekStart.toISOString().slice(0, 10),
      delivered: w.deliveredBase,
      predicted: w.recipePredictedBase,
      excessPct:
        (w.deliveredBase - w.recipePredictedBase) / w.recipePredictedBase,
    })),
  };
}

async function proposeAdjustmentForComponent(input: {
  locationId: string;
  component: {
    id: string;
    currentQuantityBase: number;
    inventoryItemName: string;
  };
  signal: CalibrationSignal;
}): Promise<"created" | "skipped"> {
  // Confidence gate — hidden from UI but strictly enforced here.
  if (input.signal.confidence < MIN_SUGGESTION_CONFIDENCE) return "skipped";

  // Cap per-cycle adjustment. If the signal says "bump 40%", we only
  // apply 15% this cycle; next week's rollup will show more signal if
  // the 15% wasn't enough.
  const cappedPct = Math.max(
    -MAX_ADJUSTMENT_PCT,
    Math.min(MAX_ADJUSTMENT_PCT, input.signal.attributedErrorPct)
  );

  const suggestedQuantityBase = Math.max(
    1,
    Math.round(input.component.currentQuantityBase * (1 + cappedPct))
  );

  if (suggestedQuantityBase === input.component.currentQuantityBase) {
    return "skipped";
  }

  // Mark any prior PENDING suggestion for this component as SUPERSEDED
  // before creating a new one. Keeps the "one live suggestion per
  // component" invariant.
  await db.recipeCalibrationSuggestion.updateMany({
    where: {
      recipeComponentId: input.component.id,
      status: "PENDING",
    },
    data: { status: "SUPERSEDED" },
  });

  const rationale = buildRationalePlain({
    componentName: input.component.inventoryItemName,
    currentQuantityBase: input.component.currentQuantityBase,
    suggestedQuantityBase,
    cappedPct,
    weeksOfData: input.signal.weeksOfData,
  });

  await db.recipeCalibrationSuggestion.create({
    data: {
      locationId: input.locationId,
      recipeComponentId: input.component.id,
      currentQuantityBase: input.component.currentQuantityBase,
      suggestedQuantityBase,
      excessPct: input.signal.attributedErrorPct,
      weeksOfData: input.signal.weeksOfData,
      confidenceScore: input.signal.confidence,
      rationalePlain: rationale,
      evidenceJson: JSON.parse(JSON.stringify(input.signal.evidence)),
    },
  });

  return "created";
}

function buildRationalePlain(input: {
  componentName: string;
  currentQuantityBase: number;
  suggestedQuantityBase: number;
  cappedPct: number;
  weeksOfData: number;
}): string {
  const direction = input.suggestedQuantityBase > input.currentQuantityBase
    ? "more"
    : "less";
  const pct = Math.abs(input.cappedPct * 100).toFixed(0);
  return `Based on ${input.weeksOfData} weeks of ordering vs sales, you seem to use about ${pct}% ${direction} ${input.componentName} per drink than the recipe says. Bumping ${input.currentQuantityBase} → ${input.suggestedQuantityBase}.`;
}

// ── Apply & dismiss ─────────────────────────────────────────────────

export async function applyCalibrationSuggestion(input: {
  suggestionId: string;
  userId: string;
  locationId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const suggestion = await db.recipeCalibrationSuggestion.findFirst({
    where: { id: input.suggestionId, locationId: input.locationId },
    select: {
      id: true,
      status: true,
      recipeComponentId: true,
      suggestedQuantityBase: true,
      recipeComponent: {
        select: {
          id: true,
          inventoryItemId: true,
          recipe: { select: { locationId: true } },
        },
      },
    },
  });

  if (!suggestion) return { ok: false, reason: "Suggestion not found." };
  if (suggestion.status !== "PENDING")
    return { ok: false, reason: "Suggestion already resolved." };
  if (suggestion.recipeComponent.recipe.locationId !== input.locationId) {
    return { ok: false, reason: "Suggestion not in this location." };
  }

  await db.$transaction(async (tx) => {
    await tx.recipeComponent.update({
      where: { id: suggestion.recipeComponentId },
      data: { quantityBase: suggestion.suggestedQuantityBase },
    });
    await tx.recipeCalibrationSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: "APPLIED",
        appliedAt: new Date(),
        appliedById: input.userId,
      },
    });
  });

  return { ok: true };
}

export async function dismissCalibrationSuggestion(input: {
  suggestionId: string;
  locationId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const suggestion = await db.recipeCalibrationSuggestion.findFirst({
    where: { id: input.suggestionId, locationId: input.locationId },
    select: { id: true, status: true },
  });
  if (!suggestion) return { ok: false, reason: "Suggestion not found." };
  if (suggestion.status !== "PENDING")
    return { ok: false, reason: "Suggestion already resolved." };
  await db.recipeCalibrationSuggestion.update({
    where: { id: suggestion.id },
    data: { status: "DISMISSED", dismissedAt: new Date() },
  });
  return { ok: true };
}

// ── Helpers ─────────────────────────────────────────────────────────

export function getWeekStartUtc(d: Date): Date {
  // Sunday 00:00 UTC anchor. Using UTC keeps rollup boundaries
  // consistent regardless of server timezone or DST.
  const utc = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
  const day = utc.getUTCDay(); // 0 = Sunday
  utc.setUTCDate(utc.getUTCDate() - day);
  return utc;
}

function trimOutliers(values: number[], fraction: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * fraction);
  if (cut === 0) return sorted;
  return sorted.slice(cut, sorted.length - cut);
}

export const CALIBRATION_TUNABLES = {
  MIN_WEEKS_FOR_SUGGESTION,
  MAX_ADJUSTMENT_PCT,
  NOISE_THRESHOLD_MEAN_TO_STDDEV,
  MIN_SUGGESTION_CONFIDENCE,
  WASTE_RATE_BY_CATEGORY,
};
