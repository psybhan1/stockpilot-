/**
 * Inventory-item duplicate detection + merge.
 *
 * Bulk-ingest flows (Amazon order parsing, invoice OCR, seed data)
 * historically created a fresh InventoryItem row per order line
 * instead of reusing an existing same-named item. Result: 15 copies
 * of "Espresso Machine Cleaner" all at 0 stock. This module finds
 * name-duplicates and merges them surgically — re-pointing every FK,
 * then deleting the orphans.
 *
 * Canonical selection:
 *   - Most stockOnHandBase wins (real stock trumps empty rows)
 *   - Tiebreaker: oldest createdAt (most-referenced historically)
 */

import { db } from "@/lib/db";

export type InventoryDuplicateGroup = {
  canonicalName: string;
  items: Array<{
    id: string;
    sku: string;
    stockOnHandBase: number;
    primarySupplierName: string | null;
    createdAt: Date;
    hasImage: boolean;
  }>;
};

export async function findInventoryDuplicates(
  locationId: string
): Promise<InventoryDuplicateGroup[]> {
  const groups = await db.inventoryItem.groupBy({
    by: ["name"],
    where: { locationId },
    _count: true,
    having: { name: { _count: { gt: 1 } } },
    orderBy: { _count: { name: "desc" } },
  });

  if (groups.length === 0) return [];

  const allItems = await db.inventoryItem.findMany({
    where: {
      locationId,
      name: { in: groups.map((g) => g.name) },
    },
    select: {
      id: true,
      name: true,
      sku: true,
      stockOnHandBase: true,
      createdAt: true,
      imageBytes: true,
      primarySupplier: { select: { name: true } },
    },
  });

  const byName = new Map<string, typeof allItems>();
  for (const item of allItems) {
    const arr = byName.get(item.name) ?? [];
    arr.push(item);
    byName.set(item.name, arr);
  }

  return groups.map((g) => ({
    canonicalName: g.name,
    items: (byName.get(g.name) ?? [])
      .sort(
        (a, b) =>
          b.stockOnHandBase - a.stockOnHandBase ||
          a.createdAt.getTime() - b.createdAt.getTime()
      )
      .map((i) => ({
        id: i.id,
        sku: i.sku,
        stockOnHandBase: i.stockOnHandBase,
        primarySupplierName: i.primarySupplier?.name ?? null,
        createdAt: i.createdAt,
        hasImage: Boolean(i.imageBytes && i.imageBytes.length > 0),
      })),
  }));
}

/**
 * Merge a group of duplicate inventory items into one canonical row.
 * Re-points every FK on 11 child tables, drops unique-constraint-
 * conflicting rows (snapshot, supplierItem with same supplierId),
 * and hard-deletes the duplicates.
 *
 * All done in a single transaction so a partial failure doesn't
 * orphan FKs.
 */
export async function mergeInventoryDuplicates(input: {
  locationId: string;
  canonicalId: string;
  duplicateIds: string[];
}): Promise<{ ok: true; mergedCount: number } | { ok: false; reason: string }> {
  if (input.duplicateIds.length === 0) {
    return { ok: false, reason: "No duplicates specified." };
  }
  if (input.duplicateIds.includes(input.canonicalId)) {
    return {
      ok: false,
      reason: "Canonical id cannot be in duplicates list.",
    };
  }

  // Validate all belong to the location.
  const count = await db.inventoryItem.count({
    where: {
      id: { in: [input.canonicalId, ...input.duplicateIds] },
      locationId: input.locationId,
    },
  });
  if (count !== 1 + input.duplicateIds.length) {
    return {
      ok: false,
      reason: "One or more items not found in this location.",
    };
  }

  await db.$transaction(async (tx) => {
    const dupIds = input.duplicateIds;
    const canonical = input.canonicalId;

    // Simple FK re-pointing (many-to-one, no unique constraints to worry about).
    await tx.stockMovement.updateMany({
      where: { inventoryItemId: { in: dupIds } },
      data: { inventoryItemId: canonical },
    });
    await tx.stockCountEntry.updateMany({
      where: { inventoryItemId: { in: dupIds } },
      data: { inventoryItemId: canonical },
    });
    await tx.recipeComponent.updateMany({
      where: { inventoryItemId: { in: dupIds } },
      data: { inventoryItemId: canonical },
    });
    await tx.recipeChoiceOption.updateMany({
      where: { inventoryItemId: { in: dupIds } },
      data: { inventoryItemId: canonical },
    });
    await tx.reorderRecommendation.updateMany({
      where: { inventoryItemId: { in: dupIds } },
      data: { inventoryItemId: canonical },
    });
    await tx.purchaseOrderLine.updateMany({
      where: { inventoryItemId: { in: dupIds } },
      data: { inventoryItemId: canonical },
    });
    await tx.posSimpleMapping.updateMany({
      where: { inventoryItemId: { in: dupIds } },
      data: { inventoryItemId: canonical },
    });
    await tx.inventoryCalibrationWeek.updateMany({
      where: { inventoryItemId: { in: dupIds } },
      data: { inventoryItemId: canonical },
    });
    await tx.inventoryUnitConversion.updateMany({
      where: { inventoryItemId: { in: dupIds } },
      data: { inventoryItemId: canonical },
    });
    // Alerts: inventoryItemId is nullable — just re-point non-null ones.
    await tx.alert.updateMany({
      where: { inventoryItemId: { in: dupIds } },
      data: { inventoryItemId: canonical },
    });

    // SupplierItem has @@unique([supplierId, inventoryItemId]) — if a
    // duplicate had a SupplierItem for the same supplierId as canonical,
    // simply re-pointing would collide. For each colliding row, delete
    // the duplicate's SupplierItem (canonical's wins, it's probably the
    // authoritative price row anyway).
    const canonicalSuppliers = await tx.supplierItem.findMany({
      where: { inventoryItemId: canonical },
      select: { supplierId: true },
    });
    const existingSupplierIds = new Set(
      canonicalSuppliers.map((s) => s.supplierId)
    );
    if (existingSupplierIds.size > 0) {
      await tx.supplierItem.deleteMany({
        where: {
          inventoryItemId: { in: dupIds },
          supplierId: { in: [...existingSupplierIds] },
        },
      });
    }
    await tx.supplierItem.updateMany({
      where: { inventoryItemId: { in: dupIds } },
      data: { inventoryItemId: canonical },
    });

    // InventorySnapshot has inventoryItemId @unique — canonical
    // keeps its own, duplicates' snapshots are dropped.
    await tx.inventorySnapshot.deleteMany({
      where: { inventoryItemId: { in: dupIds } },
    });

    // Finally: sum the stock + delete the duplicate rows.
    const dupStock = await tx.inventoryItem.findMany({
      where: { id: { in: dupIds } },
      select: { stockOnHandBase: true },
    });
    const addedStock = dupStock.reduce((a, d) => a + d.stockOnHandBase, 0);
    if (addedStock > 0) {
      await tx.inventoryItem.update({
        where: { id: canonical },
        data: { stockOnHandBase: { increment: addedStock } },
      });
    }
    await tx.inventoryItem.deleteMany({
      where: { id: { in: dupIds } },
    });
  });

  return { ok: true, mergedCount: input.duplicateIds.length };
}
