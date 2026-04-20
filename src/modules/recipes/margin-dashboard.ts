/**
 * Builds the margin dashboard data in one query.
 *
 * Shape returned per-variant is flat so the UI is a plain sortable
 * table. Detail views fetch the full breakdown separately.
 *
 * Required data joins (all in a single Prisma call):
 *   MenuItem → MenuItemVariant → PosVariationMapping → PosCatalogVariation.priceCents   (for sell price)
 *                              → Recipe → RecipeComponent → InventoryItem → SupplierItem.lastUnitCostCents  (for cost)
 *
 * We pick the LATEST approved recipe per variant. If none is
 * approved we fall back to the most-recent draft, since "draft-
 * only" variants still need a margin estimate. The UI flags these
 * as "based on draft recipe".
 *
 * For cost lookup we pick the cheapest non-null lastUnitCostCents
 * across the item's SupplierItems (most restaurants buy the same
 * SKU from multiple suppliers and the agent uses the cheapest).
 * This matches how reorder recommendations work today — consistent
 * across the app.
 */
import { db } from "@/lib/db";
import type { RecipeStatus, MeasurementUnit, RecipeComponentType } from "@/lib/prisma";

import {
  calculateRecipeCogs,
  classifyMargin,
  type CostingComponent,
  type MarginSeverity,
} from "@/modules/recipes/costing";

export type MarginRow = {
  variantId: string;
  menuItemId: string;
  menuItemName: string;
  variantName: string | null;
  category: string | null;
  sellPriceCents: number | null;
  cogsCents: number;
  marginCents: number | null;
  marginPct: number | null;
  severity: MarginSeverity;
  confidence: number;
  recipeStatus: RecipeStatus | "NO_RECIPE";
  warnings: string[];
  /** ingredient count that drove the COGS number (excluding optional/modifier) */
  componentsCosted: number;
  componentsMissing: number;
};

export type MarginBreakdownComponent = {
  componentId: string;
  inventoryItemId: string;
  inventoryItemName: string;
  quantityBase: number;
  displayUnit: MeasurementUnit;
  componentType: RecipeComponentType;
  optional: boolean;
  modifierKey: string | null;
  costCents: number | null;
  warning: string | null;
};

export type MarginBreakdown = MarginRow & {
  components: MarginBreakdownComponent[];
};

export async function getMarginDashboard(locationId: string): Promise<MarginRow[]> {
  // One query pulls everything we need — avoids N+1. We sort the
  // recipes by version DESC in the include so recipes[0] is always
  // the most recent one per variant.
  const variants = await db.menuItemVariant.findMany({
    where: {
      menuItem: { locationId },
      active: true,
    },
    include: {
      menuItem: { select: { id: true, name: true, category: true } },
      recipeVersions: {
        orderBy: { version: "desc" },
        include: {
          components: {
            include: {
              inventoryItem: {
                select: {
                  id: true,
                  name: true,
                  packSizeBase: true,
                  supplierItems: {
                    where: { lastUnitCostCents: { not: null } },
                    select: { lastUnitCostCents: true },
                    orderBy: { lastUnitCostCents: "asc" },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      },
      mappings: {
        select: {
          posVariation: {
            select: { priceCents: true },
          },
        },
        take: 1,
      },
    },
    orderBy: [{ menuItem: { name: "asc" } }, { sortOrder: "asc" }],
  });

  return variants.map((v) => {
    // Prefer approved recipes; fall back to most recent draft.
    const approved = v.recipeVersions.find((r) => r.status === "APPROVED");
    const recipe = approved ?? v.recipeVersions[0] ?? null;
    const sellPriceCents = v.mappings[0]?.posVariation.priceCents ?? null;
    const recipeStatus: MarginRow["recipeStatus"] = recipe ? recipe.status : "NO_RECIPE";

    const components: CostingComponent[] = recipe
      ? recipe.components.map((c) => ({
          id: c.id,
          inventoryItemId: c.inventoryItemId,
          inventoryItemName: c.inventoryItem.name,
          quantityBase: c.quantityBase,
          packSizeBase: c.inventoryItem.packSizeBase,
          lastUnitCostCents:
            c.inventoryItem.supplierItems[0]?.lastUnitCostCents ?? null,
          componentType: c.componentType,
          displayUnit: c.displayUnit,
          optional: c.optional,
          modifierKey: c.modifierKey,
          conditionServiceMode: c.conditionServiceMode,
        }))
      : [];

    const costing = calculateRecipeCogs(components);
    const margin = classifyMargin({
      cogsCents: costing.cogsCents,
      sellPriceCents,
    });

    const componentsCosted = costing.breakdown.filter(
      (b) => !b.optional && !b.modifierKey && b.costCents !== null
    ).length;
    const componentsMissing = costing.breakdown.filter(
      (b) => !b.optional && !b.modifierKey && b.costCents === null
    ).length;

    const warnings = [...costing.warnings];
    if (!recipe) {
      warnings.push(
        "No recipe on file — link this variant to a recipe under Menu → " +
          v.menuItem.name
      );
    } else if (recipe.status !== "APPROVED") {
      warnings.push(
        `COGS based on a ${recipe.status.toLowerCase()} recipe — numbers will change once approved.`
      );
    }

    return {
      variantId: v.id,
      menuItemId: v.menuItem.id,
      menuItemName: v.menuItem.name,
      variantName: v.name,
      category: v.menuItem.category,
      sellPriceCents,
      cogsCents: costing.cogsCents,
      marginCents: margin.marginCents,
      marginPct: margin.marginPct,
      severity: margin.severity,
      confidence: costing.confidence,
      recipeStatus,
      warnings,
      componentsCosted,
      componentsMissing,
    };
  });
}

/**
 * Detail query for a single variant — re-runs the same join but
 * also surfaces each component's optional/modifier state so the UI
 * can render the breakdown table.
 */
export async function getVariantMarginBreakdown(
  locationId: string,
  variantId: string
): Promise<MarginBreakdown | null> {
  const v = await db.menuItemVariant.findFirst({
    where: { id: variantId, menuItem: { locationId } },
    include: {
      menuItem: { select: { id: true, name: true, category: true } },
      recipeVersions: {
        orderBy: { version: "desc" },
        include: {
          components: {
            include: {
              inventoryItem: {
                select: {
                  id: true,
                  name: true,
                  packSizeBase: true,
                  supplierItems: {
                    where: { lastUnitCostCents: { not: null } },
                    select: { lastUnitCostCents: true },
                    orderBy: { lastUnitCostCents: "asc" },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      },
      mappings: {
        select: { posVariation: { select: { priceCents: true } } },
        take: 1,
      },
    },
  });
  if (!v) return null;

  const approved = v.recipeVersions.find((r) => r.status === "APPROVED");
  const recipe = approved ?? v.recipeVersions[0] ?? null;
  const sellPriceCents = v.mappings[0]?.posVariation.priceCents ?? null;
  const recipeStatus: MarginRow["recipeStatus"] = recipe ? recipe.status : "NO_RECIPE";

  const components: CostingComponent[] = recipe
    ? recipe.components.map((c) => ({
        id: c.id,
        inventoryItemId: c.inventoryItemId,
        inventoryItemName: c.inventoryItem.name,
        quantityBase: c.quantityBase,
        packSizeBase: c.inventoryItem.packSizeBase,
        lastUnitCostCents:
          c.inventoryItem.supplierItems[0]?.lastUnitCostCents ?? null,
        componentType: c.componentType,
        displayUnit: c.displayUnit,
        optional: c.optional,
        modifierKey: c.modifierKey,
        conditionServiceMode: c.conditionServiceMode,
      }))
    : [];

  const costing = calculateRecipeCogs(components);
  const margin = classifyMargin({
    cogsCents: costing.cogsCents,
    sellPriceCents,
  });

  // Map back to include displayUnit (not on CostingComponent).
  const displayUnitById = new Map(
    (recipe?.components ?? []).map((c) => [c.id, c.displayUnit])
  );

  const breakdown: MarginBreakdownComponent[] = costing.breakdown.map((b) => ({
    componentId: b.componentId,
    inventoryItemId: b.inventoryItemId,
    inventoryItemName: b.inventoryItemName,
    quantityBase: b.quantityBase,
    displayUnit:
      displayUnitById.get(b.componentId) ?? ("COUNT" as MeasurementUnit),
    componentType: b.componentType,
    optional: b.optional,
    modifierKey: b.modifierKey,
    costCents: b.costCents,
    warning: b.warning,
  }));

  const componentsCosted = costing.breakdown.filter(
    (b) => !b.optional && !b.modifierKey && b.costCents !== null
  ).length;
  const componentsMissing = costing.breakdown.filter(
    (b) => !b.optional && !b.modifierKey && b.costCents === null
  ).length;

  const warnings = [...costing.warnings];
  if (!recipe) warnings.push("No recipe on file.");
  else if (recipe.status !== "APPROVED")
    warnings.push(`Recipe is a ${recipe.status.toLowerCase()}.`);

  return {
    variantId: v.id,
    menuItemId: v.menuItem.id,
    menuItemName: v.menuItem.name,
    variantName: v.name,
    category: v.menuItem.category,
    sellPriceCents,
    cogsCents: costing.cogsCents,
    marginCents: margin.marginCents,
    marginPct: margin.marginPct,
    severity: margin.severity,
    confidence: costing.confidence,
    recipeStatus,
    warnings,
    componentsCosted,
    componentsMissing,
    components: breakdown,
  };
}
