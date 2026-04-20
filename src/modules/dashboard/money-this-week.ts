/**
 * Money this week — the single honest P&L card for /dashboard.
 *
 * Replaces the old MoneyPulseCard (which only tracked PO spend, so
 * showed $0 when no PO was sent this week — looked broken) and the
 * ShrinkageCard (which divided-by-near-zero when POS sales were
 * sparse, producing nonsense like "99900% shrinkage on Oat Milk").
 *
 * The question this card answers, per the café owner's ask:
 *   - How much did I sell this week?      (revenue, via POS)
 *   - What did those sales cost me?       (COGS, via recipes)
 *   - What's my gross profit?             (revenue − COGS)
 *   - How much did I spend on inventory?  (PO spend)
 *
 * Fallback semantics:
 *   - Lines with no recipe / unknown cost contribute revenue but NOT
 *     COGS, so the food-cost % is honest ("X% of revenue is costed").
 *     costCoverageSalesPct tells the UI when to show a warning.
 */

import { db } from "@/lib/db";
import {
  calculateRecipeCogs,
  type CostingComponent,
} from "@/modules/recipes/costing";

export type MoneyThisWeek = {
  windowStart: Date;
  windowEnd: Date;

  // Revenue + sales — from POS sale lines over the last 7 days.
  revenueCents: number;
  salesCount: number; // count of PosSaleEvent rows
  lineCount: number; // count of PosSaleLine rows (more granular)

  // COGS — from recipes, only for sale lines we could cost.
  cogsCents: number;
  costedLineCount: number; // how many of lineCount lines we had full cost for

  // Derived P&L.
  grossProfitCents: number; // revenue − COGS
  grossMarginPct: number | null; // GP / revenue (null if revenue 0)
  foodCostPct: number | null; // COGS / revenue (null if revenue 0)
  costCoverageSalesPct: number; // costedLineCount / lineCount × 100

  // Inventory spend via POs sent this week.
  inventorySpendCents: number;
  inventorySpendOrderCount: number;

  // Highlights — the "who did the work" line.
  topSeller:
    | {
        name: string;
        revenueCents: number;
        salesCount: number;
      }
    | null;

  // Trend vs last week (the week BEFORE windowStart).
  prevRevenueCents: number;
  revenueDeltaPct: number | null;
  prevGrossProfitCents: number;
  grossProfitDeltaCents: number;

  // Empty-state signal — nothing has happened yet, so the UI can
  // render a "waiting for first sale" tombstone instead of a zero row.
  isEmpty: boolean;
};

export async function getMoneyThisWeek(locationId: string): Promise<MoneyThisWeek> {
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const windowStart = new Date(now - SEVEN_DAYS);
  const windowEnd = new Date(now);
  const prevStart = new Date(now - 2 * SEVEN_DAYS);
  const prevEnd = windowStart;

  const [lines, prevLines, polines, variants] = await Promise.all([
    // Current week's POS sale lines.
    db.posSaleLine.findMany({
      where: {
        saleEvent: {
          locationId,
          occurredAt: { gte: windowStart, lte: windowEnd },
        },
      },
      select: {
        quantity: true,
        unitPriceCents: true,
        menuItemVariantId: true,
        posVariationId: true,
        saleEventId: true,
      },
    }),

    // Previous week — just sum revenue + COGS for trend arrows.
    db.posSaleLine.findMany({
      where: {
        saleEvent: {
          locationId,
          occurredAt: { gte: prevStart, lt: prevEnd },
        },
      },
      select: {
        quantity: true,
        unitPriceCents: true,
        menuItemVariantId: true,
        posVariationId: true,
      },
    }),

    // PO spend this week — sent OR approved OR received all count as
    // "money committed" from the owner's POV. We estimate using
    // latestCostCents on each line, not actualUnitCostCents, because
    // most POs are still in-flight when the week rolls up.
    db.purchaseOrder.findMany({
      where: {
        locationId,
        sentAt: { gte: windowStart, lte: windowEnd },
      },
      select: {
        id: true,
        lines: {
          select: {
            latestCostCents: true,
            quantityOrdered: true,
          },
        },
      },
    }),

    // Pull every active variant WITH recipe + cost components. One
    // query, so we compute CogsCents per-variant locally after the
    // round-trip rather than joining lines→variants→recipe at SQL.
    db.menuItemVariant.findMany({
      where: { menuItem: { locationId }, active: true },
      select: {
        id: true,
        menuItem: { select: { name: true } },
        mappings: {
          select: { posVariationId: true },
        },
        recipeVersions: {
          orderBy: { version: "desc" },
          select: {
            status: true,
            components: {
              select: {
                id: true,
                inventoryItemId: true,
                quantityBase: true,
                componentType: true,
                optional: true,
                modifierKey: true,
                conditionServiceMode: true,
                displayUnit: true,
                inventoryItem: {
                  select: {
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
      },
    }),
  ]);

  // Build per-variant cost + a posVariationId → variantId index so we
  // can resolve Square lines (which arrive with posVariationId but
  // no menuItemVariantId) back to a variant.
  const variantCost = new Map<
    string,
    { cogsCents: number | null; name: string }
  >();
  const posVariationToVariant = new Map<string, string>();

  for (const v of variants) {
    for (const m of v.mappings) {
      posVariationToVariant.set(m.posVariationId, v.id);
    }

    // Prefer approved recipes; fall back to newest draft if no approved
    // exists so we show *something* rather than nothing.
    const approved = v.recipeVersions.find((r) => r.status === "APPROVED");
    const recipe = approved ?? v.recipeVersions[0] ?? null;

    if (!recipe) {
      variantCost.set(v.id, { cogsCents: null, name: v.menuItem.name });
      continue;
    }

    const components: CostingComponent[] = recipe.components.map((c) => ({
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
    }));

    const cost = calculateRecipeCogs(components);
    const hasMissingNonOptional = cost.breakdown.some(
      (b) => !b.optional && !b.modifierKey && b.costCents === null
    );
    // If ANY required component is missing cost, we don't have a
    // trustworthy COGS for this variant — treat it as uncosted.
    variantCost.set(v.id, {
      cogsCents: hasMissingNonOptional ? null : cost.cogsCents,
      name: v.menuItem.name,
    });
  }

  // Now walk the sale lines.
  let revenueCents = 0;
  let cogsCents = 0;
  let costedLineCount = 0;
  const saleEventIds = new Set<string>();
  const revenueByVariant = new Map<string, { name: string; rev: number; qty: number }>();

  for (const line of lines) {
    saleEventIds.add(line.saleEventId);
    const lineRevenue = (line.unitPriceCents ?? 0) * line.quantity;
    revenueCents += lineRevenue;

    const variantId =
      line.menuItemVariantId ??
      (line.posVariationId
        ? posVariationToVariant.get(line.posVariationId) ?? null
        : null);

    if (variantId) {
      const vc = variantCost.get(variantId);
      if (vc) {
        const existing = revenueByVariant.get(variantId) ?? {
          name: vc.name,
          rev: 0,
          qty: 0,
        };
        existing.rev += lineRevenue;
        existing.qty += line.quantity;
        revenueByVariant.set(variantId, existing);

        if (vc.cogsCents !== null) {
          cogsCents += vc.cogsCents * line.quantity;
          costedLineCount += 1;
        }
      }
    }
  }

  // Previous-week revenue + COGS (same math, slimmer).
  let prevRevenueCents = 0;
  let prevCogsCents = 0;
  for (const line of prevLines) {
    prevRevenueCents += (line.unitPriceCents ?? 0) * line.quantity;
    const variantId =
      line.menuItemVariantId ??
      (line.posVariationId
        ? posVariationToVariant.get(line.posVariationId) ?? null
        : null);
    if (variantId) {
      const vc = variantCost.get(variantId);
      if (vc?.cogsCents != null) {
        prevCogsCents += vc.cogsCents * line.quantity;
      }
    }
  }

  // PO spend.
  let inventorySpendCents = 0;
  for (const po of polines) {
    for (const poline of po.lines) {
      inventorySpendCents +=
        (poline.latestCostCents ?? 0) * (poline.quantityOrdered ?? 0);
    }
  }
  const inventorySpendOrderCount = polines.length;

  // Highlights: top seller by revenue.
  let topSeller: MoneyThisWeek["topSeller"] = null;
  for (const [, v] of revenueByVariant) {
    if (!topSeller || v.rev > topSeller.revenueCents) {
      topSeller = {
        name: v.name,
        revenueCents: v.rev,
        salesCount: v.qty,
      };
    }
  }

  const grossProfitCents = revenueCents - cogsCents;
  const grossMarginPct =
    revenueCents > 0 ? (grossProfitCents / revenueCents) * 100 : null;
  const foodCostPct =
    revenueCents > 0 ? (cogsCents / revenueCents) * 100 : null;
  const costCoverageSalesPct =
    lines.length > 0 ? (costedLineCount / lines.length) * 100 : 0;

  const prevGrossProfitCents = prevRevenueCents - prevCogsCents;
  const revenueDeltaPct =
    prevRevenueCents > 0
      ? ((revenueCents - prevRevenueCents) / prevRevenueCents) * 100
      : null;
  const grossProfitDeltaCents = grossProfitCents - prevGrossProfitCents;

  return {
    windowStart,
    windowEnd,
    revenueCents,
    salesCount: saleEventIds.size,
    lineCount: lines.length,
    cogsCents,
    costedLineCount,
    grossProfitCents,
    grossMarginPct,
    foodCostPct,
    costCoverageSalesPct,
    inventorySpendCents,
    inventorySpendOrderCount,
    topSeller,
    prevRevenueCents,
    revenueDeltaPct,
    prevGrossProfitCents,
    grossProfitDeltaCents,
    isEmpty:
      revenueCents === 0 && inventorySpendCents === 0 && lines.length === 0,
  };
}
