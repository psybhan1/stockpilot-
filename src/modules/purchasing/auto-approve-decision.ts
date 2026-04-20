/**
 * Pure decision logic for the "while you sleep" auto-approve rule in
 * `./auto-approve`. The orchestration there fetches PO + supplier +
 * location + line data from Postgres and hands the snapshot to
 * `decideAutoApprove` — which answers a yes/no with a human-readable
 * reason, no DB or clock dependency.
 *
 * Pulling this apart lets us cover every branch — thresholds,
 * orderingMode gates, line-price guards, empty-line guards — without
 * spinning up Prisma.
 */

import type {
  PurchaseOrderStatus,
  SupplierOrderingMode,
} from "@/lib/domain-enums";

export type AutoApproveDecisionInput = {
  poStatus: PurchaseOrderStatus;
  supplier: {
    orderingMode: SupplierOrderingMode;
    email: string | null;
  };
  location: {
    autoApproveEmailUnderCents: number | null;
  };
  lines: Array<{
    quantityOrdered: number;
    latestCostCents: number | null;
  }>;
};

export type AutoApproveDecision =
  | { autoApprove: false; reason: string }
  | { autoApprove: true; totalCents: number; thresholdCents: number };

/**
 * Decide whether a freshly-drafted PO qualifies for auto-approval.
 *
 * Must-pass gates (in order):
 *  1. PO status is DRAFT or AWAITING_APPROVAL (skip anything already
 *     moved forward).
 *  2. Supplier ordering mode is EMAIL — WEBSITE needs the browser,
 *     MANUAL needs a human.
 *  3. Supplier has an email on file (otherwise there's nowhere to
 *     send the order).
 *  4. Location has a positive `autoApproveEmailUnderCents` threshold.
 *  5. PO has at least one line — empty orders would dispatch an
 *     empty email.
 *  6. Every line has a non-negative `latestCostCents` and
 *     non-negative `quantityOrdered` — otherwise we can't prove the
 *     total stays under the cap.
 *  7. Total (sum of latestCostCents × quantityOrdered) is ≤ threshold.
 */
export function decideAutoApprove(
  input: AutoApproveDecisionInput
): AutoApproveDecision {
  if (input.poStatus !== "AWAITING_APPROVAL" && input.poStatus !== "DRAFT") {
    return {
      autoApprove: false,
      reason: `PO is ${input.poStatus.toLowerCase()}`,
    };
  }

  if (input.supplier.orderingMode !== "EMAIL") {
    return {
      autoApprove: false,
      reason: `supplier is ${input.supplier.orderingMode.toLowerCase()}, not email`,
    };
  }

  if (!input.supplier.email || input.supplier.email.trim() === "") {
    return { autoApprove: false, reason: "supplier has no email on file" };
  }

  const threshold = input.location.autoApproveEmailUnderCents;
  if (threshold == null || threshold <= 0) {
    return { autoApprove: false, reason: "auto-approve threshold not set" };
  }

  if (input.lines.length === 0) {
    return {
      autoApprove: false,
      reason: "PO has no lines — refusing to dispatch an empty order",
    };
  }

  let totalCents = 0;
  for (const line of input.lines) {
    if (line.latestCostCents == null || line.latestCostCents < 0) {
      return {
        autoApprove: false,
        reason: "one or more lines have no price — can't safely auto-approve",
      };
    }
    if (!Number.isFinite(line.quantityOrdered) || line.quantityOrdered < 0) {
      return {
        autoApprove: false,
        reason: "one or more lines have invalid quantity",
      };
    }
    totalCents += line.latestCostCents * line.quantityOrdered;
  }

  if (totalCents > threshold) {
    return {
      autoApprove: false,
      reason: `total ${formatMoneyCents(totalCents)} > cap ${formatMoneyCents(threshold)}`,
    };
  }

  return { autoApprove: true, totalCents, thresholdCents: threshold };
}

export function formatMoneyCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
