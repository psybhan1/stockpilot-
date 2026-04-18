import {
  PurchaseOrderStatus,
  SupplierOrderingMode,
} from "../../lib/domain-enums";

/**
 * Pure decision core for the "auto-approve under $N" rule.
 *
 * Lives separate from auto-approve.ts so tests can exercise every
 * branch without loading Prisma or the dispatch path. auto-approve.ts
 * fetches the PO + location + supplier and feeds the result here; the
 * answer drives whether the PO is dispatched automatically.
 *
 * Threshold is inclusive: a PO whose total exactly matches the cap
 * auto-approves. A missing / zero / negative threshold disables the
 * rule. Every line must have a non-null, non-negative cost AND a
 * positive quantity — otherwise the total isn't trustworthy and we
 * fall back to manager review.
 */

export type AutoApproveInput = {
  status: PurchaseOrderStatus;
  orderingMode: SupplierOrderingMode;
  supplierEmail: string | null;
  thresholdCents: number | null;
  lines: ReadonlyArray<{
    quantityOrdered: number;
    latestCostCents: number | null;
  }>;
};

export type AutoApproveDecision =
  | { approve: false; reason: string }
  | { approve: true; totalCents: number; thresholdCents: number };

export function decideAutoApprove(input: AutoApproveInput): AutoApproveDecision {
  if (
    input.status !== PurchaseOrderStatus.AWAITING_APPROVAL &&
    input.status !== PurchaseOrderStatus.DRAFT
  ) {
    return { approve: false, reason: `PO is ${input.status.toLowerCase()}` };
  }

  if (input.orderingMode !== SupplierOrderingMode.EMAIL) {
    return {
      approve: false,
      reason: `supplier is ${input.orderingMode.toLowerCase()}, not email`,
    };
  }

  if (!input.supplierEmail || !input.supplierEmail.trim()) {
    return { approve: false, reason: "supplier has no email on file" };
  }

  if (
    input.thresholdCents == null ||
    !Number.isFinite(input.thresholdCents) ||
    input.thresholdCents <= 0
  ) {
    return { approve: false, reason: "auto-approve threshold not set" };
  }

  if (input.lines.length === 0) {
    return { approve: false, reason: "order has no lines" };
  }

  let totalCents = 0;
  for (const line of input.lines) {
    if (
      line.latestCostCents == null ||
      !Number.isFinite(line.latestCostCents) ||
      line.latestCostCents < 0
    ) {
      return {
        approve: false,
        reason: "one or more lines have no price — can't safely auto-approve",
      };
    }
    if (!Number.isFinite(line.quantityOrdered) || line.quantityOrdered <= 0) {
      return {
        approve: false,
        reason: "one or more lines have a non-positive quantity",
      };
    }
    totalCents += line.latestCostCents * line.quantityOrdered;
  }

  if (totalCents > input.thresholdCents) {
    return {
      approve: false,
      reason: `total ${formatMoney(totalCents)} > cap ${formatMoney(input.thresholdCents)}`,
    };
  }

  return {
    approve: true,
    totalCents,
    thresholdCents: input.thresholdCents,
  };
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
