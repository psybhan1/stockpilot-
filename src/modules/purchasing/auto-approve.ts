/**
 * Auto-approve rule: for EMAIL-mode suppliers, if the PO total is at
 * or under the location's `autoApproveEmailUnderCents` threshold,
 * approve + dispatch the order automatically (no manager tap
 * required).
 *
 * This is the "while you sleep" path. At 2am the bot drafts a
 * restock PO for oat milk from Sysco ($42) — if the threshold is
 * $200, the email goes out immediately and the manager wakes up to
 * a confirmation. Only kicks in for EMAIL orderingMode because:
 *   - WEBSITE needs the user's browser (cookies, CAPTCHA)
 *   - PHONE / MANUAL need a human
 *   - EMAIL is "fire a message to a real rep" — safe to automate
 *
 * Budget guard: we sum `line.latestCostCents * quantityOrdered` and
 * bail if any line is missing a cost — can't safely auto-approve
 * without knowing the dollar amount.
 */

import { PurchaseOrderStatus, SupplierOrderingMode } from "@/lib/prisma";
import { db } from "@/lib/db";
// service.ts imports auto-approve dynamically; we dynamically import
// back to break the cycle cleanly (static import would see a partial
// module at load time).

export type AutoApproveResult =
  | { autoApproved: false; reason: string }
  | {
      autoApproved: true;
      totalCents: number;
      thresholdCents: number;
      orderNumber: string;
      supplierName: string;
      /** null if dispatch failed, status of the PO after dispatch. */
      status: PurchaseOrderStatus;
    };

export async function maybeAutoApprovePurchaseOrder(input: {
  purchaseOrderId: string;
  userId: string | null;
}): Promise<AutoApproveResult> {
  const po = await db.purchaseOrder.findUnique({
    where: { id: input.purchaseOrderId },
    select: {
      id: true,
      orderNumber: true,
      locationId: true,
      status: true,
      supplier: {
        select: { name: true, orderingMode: true, email: true },
      },
      lines: {
        select: {
          quantityOrdered: true,
          latestCostCents: true,
        },
      },
      location: {
        select: { autoApproveEmailUnderCents: true },
      },
    },
  });

  if (!po) {
    return { autoApproved: false, reason: "PO not found" };
  }

  // Only auto-approve freshly-drafted orders. If the PO already
  // moved past AWAITING_APPROVAL (approved manually, cancelled, etc.)
  // don't touch it.
  if (
    po.status !== PurchaseOrderStatus.AWAITING_APPROVAL &&
    po.status !== PurchaseOrderStatus.DRAFT
  ) {
    return { autoApproved: false, reason: `PO is ${po.status.toLowerCase()}` };
  }

  if (po.supplier.orderingMode !== SupplierOrderingMode.EMAIL) {
    return {
      autoApproved: false,
      reason: `supplier is ${po.supplier.orderingMode.toLowerCase()}, not email`,
    };
  }

  if (!po.supplier.email) {
    return { autoApproved: false, reason: "supplier has no email on file" };
  }

  const threshold = po.location.autoApproveEmailUnderCents;
  if (threshold == null || threshold <= 0) {
    return { autoApproved: false, reason: "auto-approve threshold not set" };
  }

  // Price guard: every line must have a known cost — otherwise we
  // can't verify the total is actually under the cap.
  let totalCents = 0;
  for (const line of po.lines) {
    if (line.latestCostCents == null || line.latestCostCents < 0) {
      return {
        autoApproved: false,
        reason: "one or more lines have no price — can't safely auto-approve",
      };
    }
    totalCents += line.latestCostCents * line.quantityOrdered;
  }

  if (totalCents > threshold) {
    return {
      autoApproved: false,
      reason: `total $${(totalCents / 100).toFixed(2)} > cap $${(threshold / 100).toFixed(2)}`,
    };
  }

  const { approveAndDispatchPurchaseOrder } = await import(
    "@/modules/operator-bot/service"
  );
  const dispatch = await approveAndDispatchPurchaseOrder({
    purchaseOrderId: po.id,
    userId: input.userId,
  });

  return {
    autoApproved: true,
    totalCents,
    thresholdCents: threshold,
    orderNumber: dispatch.orderNumber || po.orderNumber,
    supplierName: dispatch.supplierName || po.supplier.name,
    status: dispatch.status,
  };
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
