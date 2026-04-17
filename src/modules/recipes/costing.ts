/**
 * Per-menu-item cost-of-goods-sold (COGS) calculator.
 *
 * Walks a recipe's components → joins each inventory item to its
 * most recent supplier cost → sums into a per-serving cents total.
 * This is the rollup that turns raw ingredient invoices into "a
 * vanilla latte costs you $0.64 to make, you sell it for $5.50,
 * margin is 88%." Without this, the rest of the pricing stack
 * (margin alerts, price-spike detection, menu-engineering reports)
 * has no foundation.
 *
 * Design choices:
 *   - Pure function given the resolved data shape (one Prisma query
 *     fans out, costing runs in-memory). Tests can feed synthetic
 *     inputs; no DB mocking needed.
 *   - Every component's contribution is reported separately so the
 *     UI can show a breakdown ("milk: $0.24, espresso: $0.18, oat-
 *     milk modifier: +$0.32 if selected"). A missing unit cost on
 *     one component doesn't zero the whole recipe — it flags that
 *     component and adds a warning.
 *   - Optional / modifier components are EXCLUDED from the default
 *     COGS (they only apply when the modifier is chosen), but we
 *     surface them on the breakdown so the user can see the "if a
 *     customer picks oat milk" delta.
 *   - Confidence = fraction of required components that had a
 *     clean cost lookup. UI shows this as "data confidence: 85%
 *     (3 of 4 ingredients priced)".
 */

import type { MeasurementUnit, RecipeComponentType } from "@/lib/prisma";

export type CostingComponent = {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  /** Amount used per serving in the item's base unit (g / ml / count). */
  quantityBase: number;
  /** Base units per purchase pack (e.g. 4000 for a 4L milk case where base = ml). */
  packSizeBase: number;
  /** Most recent cost paid for one purchase pack, in cents. Null = no data. */
  lastUnitCostCents: number | null;
  componentType: RecipeComponentType;
  displayUnit: MeasurementUnit;
  optional: boolean;
  modifierKey: string | null;
  conditionServiceMode: string | null;
};

export type ComponentCost = {
  componentId: string;
  inventoryItemId: string;
  inventoryItemName: string;
  quantityBase: number;
  componentType: RecipeComponentType;
  optional: boolean;
  modifierKey: string | null;
  /** Cost contribution in cents. Null if the component has no cost data. */
  costCents: number | null;
  warning: string | null;
};

export type CostingResult = {
  /** Sum of REQUIRED-component costs that had data. Excludes optional / modifier components. */
  cogsCents: number;
  /** 0..1 — fraction of required components whose cost was resolved. */
  confidence: number;
  /** All components, including optional / modifier ones, for the detail view. */
  breakdown: ComponentCost[];
  /** Top-level flags for the UI: "N ingredients missing cost data", etc. */
  warnings: string[];
};

/**
 * Cost a single component's contribution in cents. Returns null if
 * the ingredient has no cost data OR the packSize is unusable.
 */
export function costOneComponent(c: CostingComponent): number | null {
  if (c.lastUnitCostCents == null || c.lastUnitCostCents <= 0) return null;
  if (c.packSizeBase == null || c.packSizeBase <= 0) return null;
  if (c.quantityBase <= 0) return 0;
  // cents per serving = (qty used / qty per pack) * cost per pack
  const cents = (c.quantityBase / c.packSizeBase) * c.lastUnitCostCents;
  // Round to the nearest 0.01¢ (i.e. nearest int cent × 100) so the
  // UI reads as stable dollars. We don't round each component to
  // whole cents — that'd round-trip into summation error for
  // recipes with many tiny-ingredient lines (think spices).
  return Math.round(cents * 100) / 100;
}

/**
 * Main entry. Given the resolved list of components for a variant,
 * return a COGS result usable by the UI.
 */
export function calculateRecipeCogs(components: CostingComponent[]): CostingResult {
  const breakdown: ComponentCost[] = [];
  const requiredIncluded: ComponentCost[] = [];
  let missingCount = 0;

  for (const c of components) {
    const costCents = costOneComponent(c);
    let warning: string | null = null;
    if (costCents === null) {
      if (c.lastUnitCostCents == null) {
        warning = "No recent purchase cost on file for this ingredient.";
      } else if (c.packSizeBase <= 0) {
        warning = "Pack size on the inventory item is zero / invalid.";
      } else {
        warning = "Couldn't cost this component.";
      }
    }
    const row: ComponentCost = {
      componentId: c.id,
      inventoryItemId: c.inventoryItemId,
      inventoryItemName: c.inventoryItemName,
      quantityBase: c.quantityBase,
      componentType: c.componentType,
      optional: c.optional,
      modifierKey: c.modifierKey,
      costCents,
      warning,
    };
    breakdown.push(row);
    // Default-included ingredients are the ones we sum for the base
    // COGS. Modifier-only / optional components show up on the
    // breakdown but not the rollup — they're "if the customer
    // chooses oat milk, add $0.32".
    const isDefault = !c.optional && c.modifierKey === null;
    if (isDefault) {
      requiredIncluded.push(row);
      if (costCents === null) missingCount += 1;
    }
  }

  // Whole-cent rollup — summing the 0.01¢-rounded parts, then
  // rounding to the cent at the end. Avoids cumulative drift on
  // recipes with a dozen small ingredients.
  const totalSubcents = requiredIncluded.reduce(
    (acc, r) => acc + (r.costCents ?? 0) * 100,
    0
  );
  const cogsCents = Math.round(totalSubcents / 100);

  const confidence =
    requiredIncluded.length === 0
      ? 0
      : (requiredIncluded.length - missingCount) / requiredIncluded.length;

  const warnings: string[] = [];
  if (requiredIncluded.length === 0) {
    warnings.push("This recipe has no required components — COGS is zero until ingredients are added.");
  }
  if (missingCount > 0) {
    warnings.push(
      `${missingCount} of ${requiredIncluded.length} required ingredient${
        requiredIncluded.length === 1 ? "" : "s"
      } missing recent cost data — receive an invoice or update the supplier price.`
    );
  }

  return { cogsCents, confidence, breakdown, warnings };
}

// ── Margin math ─────────────────────────────────────────────────────

export type MarginSeverity = "healthy" | "watch" | "review" | "unpriced";

/**
 * Industry norms for café / small-restaurant margins:
 *   ≥ 70% margin = healthy (green)
 *   60..70%      = watch (amber)
 *   < 60%        = review (red) — either price-raise or ingredient swap
 *   no price     = unpriced — POS has no price tagged for this variant
 *
 * These thresholds are tunable per business once we have data.
 */
export function classifyMargin({
  cogsCents,
  sellPriceCents,
}: {
  cogsCents: number;
  sellPriceCents: number | null;
}): {
  marginCents: number | null;
  marginPct: number | null;
  severity: MarginSeverity;
} {
  if (sellPriceCents == null || sellPriceCents <= 0) {
    return { marginCents: null, marginPct: null, severity: "unpriced" };
  }
  const marginCents = sellPriceCents - cogsCents;
  const marginPct = marginCents / sellPriceCents;
  let severity: MarginSeverity = "healthy";
  if (marginPct < 0.6) severity = "review";
  else if (marginPct < 0.7) severity = "watch";
  return { marginCents, marginPct, severity };
}
