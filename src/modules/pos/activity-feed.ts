/**
 * Unified POS activity feed for the dashboard.
 *
 * Pulls recent PosSaleEvents + their lines across ALL providers
 * (Square/Clover/Shopify native OAuth, plus Zapier-bridge webhook),
 * and joins each line to the ACTUAL depletion outcome (via
 * StockMovement.sourceId → pos_sale_line.id) so the UI can show
 * "3× Latte → depleted 240ml milk, 4× 16oz cup" rather than just
 * "3× Latte flowed in". That second phrasing is what makes the
 * integration feel inert — merchants see sales arriving but have
 * no idea the app is actually doing something.
 *
 * Also surfaces:
 *   - Unmapped lines (no recipe / no PosSimpleMapping) so the
 *     owner can one-click fix the gap.
 *   - Reorder recommendations triggered by this sale (when the
 *     depletion pushed an ingredient under threshold), so the
 *     user can draft the PO from the same card.
 *
 * Design note: the OLD getRecentPosSales() filtered out SQUARE
 * explicitly because it only understood the webhook path. Square
 * users then saw an empty feed despite their integration working
 * perfectly — the classic "I connected it and nothing happens"
 * experience. This function replaces it end-to-end.
 */

import { db } from "@/lib/db";
import { MovementType } from "@/lib/prisma";

export type PosActivityDepletion = {
  inventoryItemName: string;
  deltaBase: number; // negative (it's a depletion)
  displayUnit: string;
};

export type PosActivityTriggeredReorder = {
  recommendationId: string;
  inventoryItemName: string;
  supplierName: string | null;
  recommendedQuantityBase: number;
  supplierItemUnit: string;
};

export type PosActivityRow = {
  id: string; // sale line id
  saleEventId: string;
  provider: string;
  occurredAt: Date;
  productName: string; // best-effort product name
  quantity: number;
  // When depletions[] is non-empty, the sale correctly drove inventory
  // decrements. When empty + status is "unmapped", the app saw the
  // sale but couldn't do anything with it — the actionable gap.
  depletions: PosActivityDepletion[];
  status: "depleted" | "unmapped" | "pending" | "gap";
  // If this sale's depletion pushed an ingredient below its reorder
  // threshold, the resulting ReorderRecommendation shows up here so
  // the dashboard can render a one-click "Draft PO" button inline.
  triggeredReorders: PosActivityTriggeredReorder[];
  // For unmapped lines, the externalProductId so the owner can jump
  // to the quick-map UI with context.
  unmappedExternalProductId: string | null;
  integrationId: string | null;
};

/**
 * Get up to `limit` recent POS sale lines across ALL providers, each
 * enriched with its actual depletion effect and any reorder
 * recommendations it triggered.
 */
export async function getPosActivityFeed(
  locationId: string,
  limit = 10
): Promise<PosActivityRow[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const lines = await db.posSaleLine.findMany({
    where: {
      saleEvent: {
        locationId,
        occurredAt: { gte: sevenDaysAgo },
      },
    },
    select: {
      id: true,
      quantity: true,
      rawData: true,
      posVariationId: true,
      saleEvent: {
        select: {
          id: true,
          occurredAt: true,
          integrationId: true,
          processingStatus: true,
          integration: { select: { provider: true } },
        },
      },
      posVariation: {
        select: {
          id: true,
          name: true,
          externalId: true,
          catalogItem: { select: { name: true } },
          mappings: {
            select: {
              mappingStatus: true,
              recipe: { select: { id: true, status: true } },
            },
            take: 1,
          },
        },
      },
    },
    orderBy: { saleEvent: { occurredAt: "desc" } },
    take: limit,
  });

  if (lines.length === 0) return [];

  const lineIds = lines.map((l) => l.id);

  // Batch the depletion + recommendation lookups so we don't N+1.
  const [movements, simpleMappings, recommendations] = await Promise.all([
    db.stockMovement.findMany({
      where: {
        movementType: MovementType.POS_DEPLETION,
        sourceType: "pos_sale_line",
        sourceId: { in: lineIds },
      },
      select: {
        sourceId: true,
        quantityDeltaBase: true,
        inventoryItem: {
          select: { id: true, name: true, displayUnit: true },
        },
      },
    }),
    db.posSimpleMapping.findMany({
      where: { locationId },
      select: {
        integrationId: true,
        externalProductId: true,
        quantityPerSaleBase: true,
        inventoryItem: { select: { id: true, name: true, displayUnit: true } },
      },
    }),
    // Find reorder recommendations created since the earliest sale
    // in our feed. We match them to sale lines by touched-item —
    // the sale depleted item X, a recommendation exists for item X,
    // and the recommendation is newer than the sale → likely caused.
    // It's a heuristic, not a foreign key, but it's good enough for
    // "draft a PO" prompts.
    db.reorderRecommendation.findMany({
      where: {
        locationId,
        status: "PENDING_APPROVAL",
        createdAt: { gte: sevenDaysAgo },
      },
      select: {
        id: true,
        inventoryItemId: true,
        recommendedOrderQuantityBase: true,
        recommendedPurchaseUnit: true,
        createdAt: true,
        inventoryItem: { select: { name: true } },
        supplier: { select: { name: true } },
      },
    }),
  ]);

  const movementsByLine = new Map<string, PosActivityDepletion[]>();
  for (const m of movements) {
    const arr = movementsByLine.get(m.sourceId) ?? [];
    arr.push({
      inventoryItemName: m.inventoryItem.name,
      deltaBase: m.quantityDeltaBase,
      displayUnit: m.inventoryItem.displayUnit,
    });
    movementsByLine.set(m.sourceId, arr);
  }

  const simpleByKey = new Map<
    string,
    { inventoryItemId: string; itemName: string; unit: string; qtyPerSale: number }
  >();
  for (const sm of simpleMappings) {
    simpleByKey.set(`${sm.integrationId}:${sm.externalProductId}`, {
      inventoryItemId: sm.inventoryItem.id,
      itemName: sm.inventoryItem.name,
      unit: sm.inventoryItem.displayUnit,
      qtyPerSale: sm.quantityPerSaleBase,
    });
  }

  const recommendationsByItem = new Map<
    string,
    (typeof recommendations)[number][]
  >();
  for (const r of recommendations) {
    const arr = recommendationsByItem.get(r.inventoryItemId) ?? [];
    arr.push(r);
    recommendationsByItem.set(r.inventoryItemId, arr);
  }

  return lines.map((line): PosActivityRow => {
    const rawObj = isRawObject(line.rawData) ? line.rawData : null;
    const externalProductId =
      (rawObj && typeof rawObj.externalProductId === "string"
        ? rawObj.externalProductId.trim()
        : null) ||
      line.posVariation?.externalId ||
      null;
    const externalProductName =
      (rawObj && typeof rawObj.externalProductName === "string"
        ? rawObj.externalProductName.trim()
        : null) ||
      line.posVariation?.name ||
      line.posVariation?.catalogItem?.name ||
      "Unknown product";

    const depletions = movementsByLine.get(line.id) ?? [];

    // Webhook-path fallback: rawData + PosSimpleMapping can resolve
    // what the SALE WAS supposed to deplete even if the ledger
    // transaction hasn't posted yet (race: feed renders before the
    // SYNC_SALES job finished).
    if (depletions.length === 0 && externalProductId && line.saleEvent.integrationId) {
      const simple = simpleByKey.get(
        `${line.saleEvent.integrationId}:${externalProductId}`
      );
      if (simple) {
        depletions.push({
          inventoryItemName: simple.itemName,
          deltaBase: -simple.qtyPerSale * line.quantity,
          displayUnit: simple.unit,
        });
      }
    }

    // Determine status:
    //  - depleted: at least one stock movement posted
    //  - pending: sale event still PENDING (processor hasn't run)
    //  - unmapped: webhook-path with no PosSimpleMapping
    //  - gap: Square/OAuth path with no mapping/recipe (we know the
    //         catalog variation but nobody's wired it to a recipe)
    let status: PosActivityRow["status"];
    if (depletions.length > 0) {
      status = "depleted";
    } else if (line.saleEvent.processingStatus === "PENDING") {
      status = "pending";
    } else if (line.posVariation && (line.posVariation.mappings.length === 0 || !line.posVariation.mappings[0].recipe)) {
      status = "gap";
    } else {
      status = "unmapped";
    }

    // Triggered reorders: look up recommendations for the items this
    // line depleted, where the recommendation was created AFTER the
    // sale (so we're not attributing a stale recommendation to a
    // fresh sale).
    const triggeredReorders: PosActivityTriggeredReorder[] = [];
    for (const d of depletions) {
      const itemRecs = [...recommendationsByItem.entries()]
        .filter(([, recs]) =>
          recs.some((r) => r.inventoryItem.name === d.inventoryItemName)
        )
        .flatMap(([, recs]) => recs);
      for (const r of itemRecs) {
        if (r.createdAt < line.saleEvent.occurredAt) continue;
        if (triggeredReorders.some((x) => x.recommendationId === r.id)) continue;
        triggeredReorders.push({
          recommendationId: r.id,
          inventoryItemName: r.inventoryItem.name,
          supplierName: r.supplier?.name ?? null,
          recommendedQuantityBase: r.recommendedOrderQuantityBase,
          supplierItemUnit: r.recommendedPurchaseUnit ?? "unit",
        });
      }
    }

    return {
      id: line.id,
      saleEventId: line.saleEvent.id,
      provider: line.saleEvent.integration?.provider ?? "UNKNOWN",
      occurredAt: line.saleEvent.occurredAt,
      productName: externalProductName,
      quantity: line.quantity,
      depletions,
      status,
      triggeredReorders,
      unmappedExternalProductId: status === "unmapped" || status === "gap" ? externalProductId : null,
      integrationId: line.saleEvent.integrationId,
    };
  });
}

function isRawObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}
