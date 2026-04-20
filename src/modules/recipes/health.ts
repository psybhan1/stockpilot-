/**
 * Recipe health signals — the first-iteration sell-through calibration
 * surface for /dashboard.
 *
 * Philosophy:
 *   True recipe calibration (compare recipe-predicted depletion to
 *   physical inventory counts) requires a mature count cadence we
 *   don't have yet for most users. This module instead surfaces the
 *   signals that TELL the user WHERE to look:
 *     - Which recipes are doing the most volume?
 *     - Which are low-confidence and high-volume (biggest payoff to
 *       review)?
 *     - Which haven't been touched in 30+ days despite active sales?
 *
 * Each row links to the recipe's mapping draft page where the user
 * can re-run the AI draft + chat edit against the latest inventory
 * catalog. That's the calibration loop for now; when count data
 * becomes reliable, this module grows a real variance comparator.
 */

import { db } from "@/lib/db";

export type RecipeHealthRow = {
  recipeId: string;
  variantName: string;
  menuItemName: string;
  mappingId: string | null;
  // Volume signals from the last 14 days.
  salesCount: number;
  revenueCents: number;
  // Recipe meta.
  confidenceScore: number;
  componentsCount: number;
  approvedAt: Date | null;
  daysSinceApproved: number | null;
  // Derived flag: high-volume + low-confidence + stale.
  needsReview: boolean;
  reviewReason: string | null;
};

export type CalibrationSuggestionRow = {
  id: string;
  rationalePlain: string;
  currentQuantityBase: number;
  suggestedQuantityBase: number;
  inventoryItemName: string;
  recipeName: string;
  displayUnit: string;
};

export type RecipeHealthSummary = {
  rows: RecipeHealthRow[];
  totalRecipes: number;
  needsReviewCount: number;
  windowDays: number;
  calibrationSuggestions: CalibrationSuggestionRow[];
};

export async function getRecipeHealth(
  locationId: string,
  options: { windowDays?: number } = {}
): Promise<RecipeHealthSummary> {
  const windowDays = options.windowDays ?? 14;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const recipes = await db.recipe.findMany({
    where: {
      locationId,
      status: "APPROVED",
    },
    select: {
      id: true,
      confidenceScore: true,
      approvedAt: true,
      _count: { select: { components: true } },
      menuItemVariant: {
        select: {
          id: true,
          name: true,
          menuItem: { select: { name: true } },
          mappings: {
            select: { id: true, recipeId: true },
            take: 1,
          },
        },
      },
    },
  });

  if (recipes.length === 0) {
    return {
      rows: [],
      totalRecipes: 0,
      needsReviewCount: 0,
      windowDays,
      calibrationSuggestions: [],
    };
  }

  // One batch query: POS sale lines for the location in the window,
  // grouped by menuItemVariantId (either direct via PosSaleLine or
  // via the posVariation.mappings chain).
  const lines = await db.posSaleLine.findMany({
    where: {
      saleEvent: {
        locationId,
        occurredAt: { gte: since },
      },
    },
    select: {
      quantity: true,
      unitPriceCents: true,
      menuItemVariantId: true,
      posVariation: {
        select: { mappings: { select: { menuItemVariantId: true }, take: 1 } },
      },
    },
  });

  const salesByVariant = new Map<string, { count: number; revenue: number }>();
  for (const line of lines) {
    const variantId =
      line.menuItemVariantId ??
      line.posVariation?.mappings[0]?.menuItemVariantId ??
      null;
    if (!variantId) continue;
    const existing = salesByVariant.get(variantId) ?? { count: 0, revenue: 0 };
    existing.count += line.quantity;
    existing.revenue += (line.unitPriceCents ?? 0) * line.quantity;
    salesByVariant.set(variantId, existing);
  }

  const now = Date.now();
  const rows: RecipeHealthRow[] = recipes.map((r) => {
    const sales = salesByVariant.get(r.menuItemVariant.id) ?? {
      count: 0,
      revenue: 0,
    };
    const daysSinceApproved = r.approvedAt
      ? Math.floor((now - r.approvedAt.getTime()) / (24 * 60 * 60 * 1000))
      : null;

    // Review-worthy when: ≥10 sales AND (confidence < 0.7 OR approval >30d old).
    let needsReview = false;
    let reviewReason: string | null = null;
    if (sales.count >= 10) {
      if (r.confidenceScore < 0.7) {
        needsReview = true;
        reviewReason = `${Math.round(r.confidenceScore * 100)}% confidence on a recipe that's done ${sales.count} sales`;
      } else if (daysSinceApproved !== null && daysSinceApproved > 30) {
        needsReview = true;
        reviewReason = `Approved ${daysSinceApproved} days ago, ${sales.count} sales since — worth a fresh look`;
      }
    }

    return {
      recipeId: r.id,
      variantName: r.menuItemVariant.name,
      menuItemName: r.menuItemVariant.menuItem.name,
      mappingId: r.menuItemVariant.mappings[0]?.id ?? null,
      salesCount: sales.count,
      revenueCents: sales.revenue,
      confidenceScore: r.confidenceScore,
      componentsCount: r._count.components,
      approvedAt: r.approvedAt,
      daysSinceApproved,
      needsReview,
      reviewReason,
    };
  });

  // Sort: needsReview first (biggest payoff), then by sales desc.
  rows.sort((a, b) => {
    if (a.needsReview !== b.needsReview) return a.needsReview ? -1 : 1;
    return b.salesCount - a.salesCount;
  });

  // Pull PENDING calibration suggestions for this location. Already
  // gated by confidence threshold at creation time, so everything
  // here is safe to surface.
  const suggestions = await db.recipeCalibrationSuggestion.findMany({
    where: { locationId, status: "PENDING" },
    select: {
      id: true,
      rationalePlain: true,
      currentQuantityBase: true,
      suggestedQuantityBase: true,
      recipeComponent: {
        select: {
          displayUnit: true,
          inventoryItem: { select: { name: true } },
          recipe: {
            select: {
              menuItemVariant: {
                select: { name: true, menuItem: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const calibrationSuggestions: CalibrationSuggestionRow[] = suggestions.map(
    (s) => {
      const variant = s.recipeComponent.recipe.menuItemVariant;
      const recipeName =
        variant.menuItem.name === variant.name
          ? variant.name
          : `${variant.menuItem.name} · ${variant.name}`;
      return {
        id: s.id,
        rationalePlain: s.rationalePlain,
        currentQuantityBase: s.currentQuantityBase,
        suggestedQuantityBase: s.suggestedQuantityBase,
        inventoryItemName: s.recipeComponent.inventoryItem.name,
        recipeName,
        displayUnit: String(s.recipeComponent.displayUnit),
      };
    }
  );

  return {
    rows,
    totalRecipes: rows.length,
    needsReviewCount: rows.filter((r) => r.needsReview).length,
    windowDays,
    calibrationSuggestions,
  };
}
