/**
 * Rescue orders — when a supplier comes back with OUT_OF_STOCK, we
 * try to auto-fulfil the same order from an alternate supplier that
 * also carries the item. Exposes two helpers:
 *
 *   findAlternateSupplierForOrder(poId)
 *     Returns the best alternate supplier for every line on a PO.
 *     "Best" = preferred=true first, then any supplierItem that
 *     carries the inventoryItem, excluding the original supplier.
 *     Returns null if no alternate exists for any line.
 *
 *   createRescuePurchaseOrder(failedPoId, userId)
 *     Copies every line from the failed PO onto a brand-new PO
 *     against the alternate supplier, auto-approves it, and
 *     dispatches it through the same path a bot-approved order uses.
 *     Returns the new PO + supplier name so the caller can render a
 *     Telegram reply.
 */

import {
  PurchaseOrderStatus,
  SupplierOrderingMode,
  type Prisma,
} from "@/lib/prisma";
import { db } from "@/lib/db";
import { createAuditLogTx } from "@/lib/audit";
import { approveAndDispatchPurchaseOrder } from "@/modules/operator-bot/service";
import { nextOrderNumber } from "@/modules/purchasing/service";
import {
  pickAlternateSupplier,
  type RescueLineInput,
} from "./rescue-picker";

export type AlternateMatch = {
  supplier: {
    id: string;
    name: string;
    email: string | null;
    orderingMode: SupplierOrderingMode;
  };
  /** Each line with the supplier-specific pack size to use on the rescue PO. */
  lines: Array<{
    inventoryItemId: string;
    description: string;
    quantityOrdered: number;
    expectedQuantityBase: number;
    purchaseUnit: Prisma.PurchaseOrderLineUncheckedCreateInput["purchaseUnit"];
    packSizeBase: number;
  }>;
};

export async function findAlternateSupplierForOrder(
  poId: string
): Promise<AlternateMatch | null> {
  const po = await db.purchaseOrder.findUnique({
    where: { id: poId },
    select: { id: true, supplierId: true },
  });
  if (!po) return null;

  const lines = await db.purchaseOrderLine.findMany({
    where: { purchaseOrderId: po.id },
    select: {
      id: true,
      inventoryItemId: true,
      description: true,
      quantityOrdered: true,
      expectedQuantityBase: true,
      purchaseUnit: true,
      packSizeBase: true,
      inventoryItem: {
        select: {
          supplierItems: {
            select: {
              supplierId: true,
              packSizeBase: true,
              preferred: true,
              supplier: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  orderingMode: true,
                },
              },
            },
            orderBy: [{ preferred: "desc" }],
          },
        },
      },
    },
  });
  if (lines.length === 0) return null;

  type CandidateSupplier = AlternateMatch["supplier"];

  // Build per-line candidate sets (preferred-first) with the original
  // supplier removed, then hand them to the pure picker.
  const pickerInput: Array<RescueLineInput<CandidateSupplier>> = lines.map(
    (line) => ({
      lineId: line.id,
      candidates: line.inventoryItem.supplierItems
        .filter((si) => si.supplierId !== po.supplierId)
        .map((si) => ({
          supplierId: si.supplierId,
          supplier: si.supplier,
          packSizeBase: si.packSizeBase,
        })),
    })
  );

  const picked = pickAlternateSupplier(pickerInput);
  if (!picked) return null;

  return {
    supplier: picked.supplier,
    lines: lines.map((line) => ({
      inventoryItemId: line.inventoryItemId,
      description: line.description,
      quantityOrdered: line.quantityOrdered,
      expectedQuantityBase: line.expectedQuantityBase,
      purchaseUnit: line.purchaseUnit,
      packSizeBase: picked.packSizeByLine.get(line.id) ?? line.packSizeBase,
    })),
  };
}

export type RescueResult =
  | {
      ok: true;
      newPurchaseOrderId: string;
      newOrderNumber: string;
      alternateSupplierName: string;
      dispatchStatus: PurchaseOrderStatus;
      dispatchReason?: string;
    }
  | { ok: false; reason: string };

export async function createRescuePurchaseOrder(
  failedPoId: string,
  userId: string | null
): Promise<RescueResult> {
  const alt = await findAlternateSupplierForOrder(failedPoId);
  if (!alt) {
    return {
      ok: false,
      reason:
        "No alternate supplier carries every line on this order. Add a supplier for the item in Settings → Suppliers first.",
    };
  }
  const original = await db.purchaseOrder.findUnique({
    where: { id: failedPoId },
    select: { locationId: true, orderNumber: true, notes: true },
  });
  if (!original) return { ok: false, reason: "Original order not found" };

  const newOrderNumber = nextOrderNumber();
  const newPo = await db.$transaction(async (tx) => {
    const created = await tx.purchaseOrder.create({
      data: {
        locationId: original.locationId,
        supplierId: alt.supplier.id,
        orderNumber: newOrderNumber,
        status: PurchaseOrderStatus.AWAITING_APPROVAL,
        totalLines: alt.lines.length,
        placedById: userId,
        notes: `Rescue order — replaces ${original.orderNumber} after the original supplier reported OUT_OF_STOCK.`,
        metadata: {
          source: "rescue",
          rescuedFrom: failedPoId,
          rescuedFromOrderNumber: original.orderNumber,
        } satisfies Prisma.InputJsonValue,
      },
    });
    for (const line of alt.lines) {
      // Snapshot the alternate supplier's last-paid price so the
      // delivery-time variance audit has a baseline to diff against.
      // Same policy as approveRecommendation / the operator-bot PO
      // path — otherwise a supplier-swap (rescue) would land in the
      // books without any price-creep signal.
      const alternateSi = await tx.supplierItem.findFirst({
        where: {
          supplierId: alt.supplier.id,
          inventoryItemId: line.inventoryItemId,
        },
        select: { lastUnitCostCents: true },
      });
      await tx.purchaseOrderLine.create({
        data: {
          purchaseOrderId: created.id,
          inventoryItemId: line.inventoryItemId,
          description: line.description,
          quantityOrdered: line.quantityOrdered,
          expectedQuantityBase: line.expectedQuantityBase,
          purchaseUnit: line.purchaseUnit,
          packSizeBase: line.packSizeBase,
          latestCostCents: alternateSi?.lastUnitCostCents ?? null,
        },
      });
    }
    await createAuditLogTx(tx, {
      locationId: original.locationId,
      userId,
      action: "bot.rescue_order_created",
      entityType: "purchaseOrder",
      entityId: created.id,
      details: {
        rescuedFromOrderNumber: original.orderNumber,
        alternateSupplierName: alt.supplier.name,
      },
    });
    return created;
  });

  // Auto-approve + dispatch via the same path a bot-approved order uses.
  const dispatch = await approveAndDispatchPurchaseOrder({
    purchaseOrderId: newPo.id,
    userId,
  });

  return {
    ok: true,
    newPurchaseOrderId: newPo.id,
    newOrderNumber,
    alternateSupplierName: alt.supplier.name,
    dispatchStatus: dispatch.status,
    dispatchReason: dispatch.reason,
  };
}
