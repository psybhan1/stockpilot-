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

import { PurchaseOrderStatus } from "@/lib/prisma";
import { db } from "@/lib/db";
import { decideAutoApprove, formatMoney } from "./auto-approve-policy";

export { formatMoney };
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

  const decision = decideAutoApprove({
    status: po.status,
    orderingMode: po.supplier.orderingMode,
    supplierEmail: po.supplier.email,
    thresholdCents: po.location.autoApproveEmailUnderCents,
    lines: po.lines,
  });

  if (!decision.approve) {
    return { autoApproved: false, reason: decision.reason };
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
    totalCents: decision.totalCents,
    thresholdCents: decision.thresholdCents,
    orderNumber: dispatch.orderNumber || po.orderNumber,
    supplierName: dispatch.supplierName || po.supplier.name,
    status: dispatch.status,
  };
}
