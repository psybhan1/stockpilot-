import test from "node:test";
import assert from "node:assert/strict";

import {
  decideAutoApprove,
  formatMoneyCents,
  type AutoApproveDecisionInput,
} from "./auto-approve-decision";

// Minimal "happy path" input — every branch gate is satisfied so
// specific tests below can mutate exactly one field and verify the
// gate triggers.
function happy(): AutoApproveDecisionInput {
  return {
    poStatus: "AWAITING_APPROVAL",
    supplier: {
      orderingMode: "EMAIL",
      email: "rep@sysco.example",
    },
    location: { autoApproveEmailUnderCents: 20000 }, // $200 cap
    lines: [
      { quantityOrdered: 2, latestCostCents: 1500 }, // 2 × $15 = $30
      { quantityOrdered: 1, latestCostCents: 4200 }, // 1 × $42 = $42
    ],
  };
}

// ─── status gate ─────────────────────────────────────────────────────

test("auto-approves AWAITING_APPROVAL PO under cap", () => {
  const result = decideAutoApprove(happy());
  assert.equal(result.autoApprove, true);
  if (!result.autoApprove) throw new Error("unreachable");
  assert.equal(result.totalCents, 7200);
  assert.equal(result.thresholdCents, 20000);
});

test("auto-approves DRAFT status too", () => {
  const result = decideAutoApprove({ ...happy(), poStatus: "DRAFT" });
  assert.equal(result.autoApprove, true);
});

test("refuses already-APPROVED PO", () => {
  const result = decideAutoApprove({ ...happy(), poStatus: "APPROVED" });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /PO is approved/);
});

test("refuses SENT PO (already dispatched)", () => {
  const result = decideAutoApprove({ ...happy(), poStatus: "SENT" });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /PO is sent/);
});

test("refuses CANCELLED PO", () => {
  const result = decideAutoApprove({ ...happy(), poStatus: "CANCELLED" });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /cancelled/);
});

test("refuses DELIVERED PO", () => {
  const result = decideAutoApprove({ ...happy(), poStatus: "DELIVERED" });
  assert.equal(result.autoApprove, false);
});

test("refuses FAILED PO (don't auto-retry without human)", () => {
  const result = decideAutoApprove({ ...happy(), poStatus: "FAILED" });
  assert.equal(result.autoApprove, false);
});

test("refuses ACKNOWLEDGED PO", () => {
  const result = decideAutoApprove({ ...happy(), poStatus: "ACKNOWLEDGED" });
  assert.equal(result.autoApprove, false);
});

// ─── supplier ordering-mode gate ─────────────────────────────────────

test("refuses WEBSITE suppliers (need browser+cookies)", () => {
  const result = decideAutoApprove({
    ...happy(),
    supplier: { orderingMode: "WEBSITE", email: "ok@x.example" },
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /supplier is website, not email/);
});

test("refuses MANUAL suppliers (need human)", () => {
  const result = decideAutoApprove({
    ...happy(),
    supplier: { orderingMode: "MANUAL", email: "ok@x.example" },
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /not email/);
});

// ─── supplier email gate ─────────────────────────────────────────────

test("refuses EMAIL supplier with null email", () => {
  const result = decideAutoApprove({
    ...happy(),
    supplier: { orderingMode: "EMAIL", email: null },
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /no email on file/);
});

test("refuses EMAIL supplier with empty string email", () => {
  const result = decideAutoApprove({
    ...happy(),
    supplier: { orderingMode: "EMAIL", email: "" },
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /no email on file/);
});

test("refuses EMAIL supplier with whitespace-only email", () => {
  const result = decideAutoApprove({
    ...happy(),
    supplier: { orderingMode: "EMAIL", email: "   " },
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /no email/);
});

// ─── threshold gate ──────────────────────────────────────────────────

test("refuses when threshold is null (unconfigured)", () => {
  const result = decideAutoApprove({
    ...happy(),
    location: { autoApproveEmailUnderCents: null },
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /threshold not set/);
});

test("refuses when threshold is zero", () => {
  const result = decideAutoApprove({
    ...happy(),
    location: { autoApproveEmailUnderCents: 0 },
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /threshold not set/);
});

test("refuses when threshold is negative (malformed input)", () => {
  const result = decideAutoApprove({
    ...happy(),
    location: { autoApproveEmailUnderCents: -100 },
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /threshold not set/);
});

// ─── lines / price guard ─────────────────────────────────────────────

test("refuses empty PO (no lines to dispatch)", () => {
  const result = decideAutoApprove({ ...happy(), lines: [] });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /no lines/);
});

test("refuses PO with a line missing latestCostCents", () => {
  const result = decideAutoApprove({
    ...happy(),
    lines: [
      { quantityOrdered: 1, latestCostCents: 1000 },
      { quantityOrdered: 2, latestCostCents: null },
    ],
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /no price/);
});

test("refuses PO with a single null-priced line", () => {
  const result = decideAutoApprove({
    ...happy(),
    lines: [{ quantityOrdered: 1, latestCostCents: null }],
  });
  assert.equal(result.autoApprove, false);
});

test("refuses PO with a negative latestCostCents (malformed)", () => {
  const result = decideAutoApprove({
    ...happy(),
    lines: [{ quantityOrdered: 1, latestCostCents: -500 }],
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /no price/);
});

test("refuses PO with a negative quantityOrdered (malformed)", () => {
  const result = decideAutoApprove({
    ...happy(),
    lines: [{ quantityOrdered: -3, latestCostCents: 100 }],
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /invalid quantity/);
});

test("refuses PO with NaN quantityOrdered", () => {
  const result = decideAutoApprove({
    ...happy(),
    lines: [{ quantityOrdered: Number.NaN, latestCostCents: 100 }],
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /invalid quantity/);
});

test("refuses PO with Infinity quantityOrdered", () => {
  const result = decideAutoApprove({
    ...happy(),
    lines: [{ quantityOrdered: Number.POSITIVE_INFINITY, latestCostCents: 1 }],
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /invalid quantity/);
});

test("accepts zero quantityOrdered on a single line (pure-function invariant)", () => {
  // quantity=0 contributes 0 to total → well below any positive cap.
  // In practice upstream should prevent this, but the decision
  // function itself must not blow up on legal numeric inputs.
  const result = decideAutoApprove({
    ...happy(),
    lines: [{ quantityOrdered: 0, latestCostCents: 9999 }],
  });
  assert.equal(result.autoApprove, true);
});

test("accepts zero latestCostCents (free sample) as long as total ≤ cap", () => {
  const result = decideAutoApprove({
    ...happy(),
    lines: [{ quantityOrdered: 5, latestCostCents: 0 }],
  });
  assert.equal(result.autoApprove, true);
  if (!result.autoApprove) throw new Error("unreachable");
  assert.equal(result.totalCents, 0);
});

// ─── cap arithmetic ──────────────────────────────────────────────────

test("auto-approves exactly at the cap ($200.00 == $200 cap)", () => {
  const result = decideAutoApprove({
    ...happy(),
    location: { autoApproveEmailUnderCents: 20000 },
    lines: [{ quantityOrdered: 1, latestCostCents: 20000 }],
  });
  assert.equal(result.autoApprove, true);
  if (!result.autoApprove) throw new Error("unreachable");
  assert.equal(result.totalCents, 20000);
});

test("refuses one cent over the cap ($200.01 vs $200 cap)", () => {
  const result = decideAutoApprove({
    ...happy(),
    location: { autoApproveEmailUnderCents: 20000 },
    lines: [{ quantityOrdered: 1, latestCostCents: 20001 }],
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /\$200\.01.*>.*\$200\.00/);
});

test("sums multiple lines correctly", () => {
  const result = decideAutoApprove({
    ...happy(),
    location: { autoApproveEmailUnderCents: 10000 },
    lines: [
      { quantityOrdered: 3, latestCostCents: 1000 }, // $30
      { quantityOrdered: 7, latestCostCents: 1000 }, // $70
    ],
  });
  assert.equal(result.autoApprove, true);
  if (!result.autoApprove) throw new Error("unreachable");
  assert.equal(result.totalCents, 10000); // exactly at cap
});

test("reports total vs cap in refusal reason", () => {
  const result = decideAutoApprove({
    ...happy(),
    location: { autoApproveEmailUnderCents: 5000 }, // $50 cap
    lines: [{ quantityOrdered: 2, latestCostCents: 4000 }], // $80 total
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /\$80\.00/);
  assert.match(result.reason, /\$50\.00/);
});

test("scales correctly with large quantities (case pack of 48)", () => {
  const result = decideAutoApprove({
    ...happy(),
    location: { autoApproveEmailUnderCents: 500000 }, // $5,000 cap
    lines: [{ quantityOrdered: 48, latestCostCents: 1000 }], // 48 × $10 = $480
  });
  assert.equal(result.autoApprove, true);
  if (!result.autoApprove) throw new Error("unreachable");
  assert.equal(result.totalCents, 48000);
});

// ─── gate ordering ───────────────────────────────────────────────────
// The gate ordering matters because the reason message is what the
// operator sees in the audit log / Telegram reply. If two gates would
// both fail, we want the most-actionable reason first.

test("status gate runs before supplier-mode gate", () => {
  const result = decideAutoApprove({
    ...happy(),
    poStatus: "CANCELLED",
    supplier: { orderingMode: "WEBSITE", email: "x@x.example" },
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /cancelled/);
  assert.doesNotMatch(result.reason, /website/);
});

test("supplier-mode gate runs before supplier-email gate", () => {
  const result = decideAutoApprove({
    ...happy(),
    supplier: { orderingMode: "WEBSITE", email: null },
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /website/);
  assert.doesNotMatch(result.reason, /no email/);
});

test("supplier-email gate runs before threshold gate", () => {
  const result = decideAutoApprove({
    ...happy(),
    supplier: { orderingMode: "EMAIL", email: null },
    location: { autoApproveEmailUnderCents: null },
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /no email/);
  assert.doesNotMatch(result.reason, /threshold/);
});

test("threshold gate runs before lines-empty gate", () => {
  const result = decideAutoApprove({
    ...happy(),
    location: { autoApproveEmailUnderCents: null },
    lines: [],
  });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /threshold/);
  assert.doesNotMatch(result.reason, /no lines/);
});

test("lines-empty gate runs before per-line price gate", () => {
  const result = decideAutoApprove({ ...happy(), lines: [] });
  assert.equal(result.autoApprove, false);
  if (result.autoApprove) throw new Error("unreachable");
  assert.match(result.reason, /no lines/);
  assert.doesNotMatch(result.reason, /no price/);
});

// ─── formatMoneyCents ────────────────────────────────────────────────

test("formatMoneyCents renders whole dollars with .00", () => {
  assert.equal(formatMoneyCents(0), "$0.00");
  assert.equal(formatMoneyCents(100), "$1.00");
  assert.equal(formatMoneyCents(20000), "$200.00");
});

test("formatMoneyCents renders fractional cents rounded to 2dp", () => {
  assert.equal(formatMoneyCents(199), "$1.99");
  assert.equal(formatMoneyCents(12345), "$123.45");
  assert.equal(formatMoneyCents(1), "$0.01");
});

test("formatMoneyCents handles large amounts", () => {
  assert.equal(formatMoneyCents(1_000_000), "$10000.00");
  assert.equal(formatMoneyCents(99_999_99), "$99999.99");
});

test("formatMoneyCents handles negative cents (refund display)", () => {
  // Keeping behavior consistent with the pre-extraction formatMoney —
  // the function never guards the sign, and callers sometimes pass
  // variances that can be negative.
  assert.equal(formatMoneyCents(-500), "$-5.00");
});
