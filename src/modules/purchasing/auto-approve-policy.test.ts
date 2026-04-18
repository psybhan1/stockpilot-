import test from "node:test";
import assert from "node:assert/strict";

import {
  PurchaseOrderStatus,
  SupplierOrderingMode,
} from "../../lib/domain-enums";
import {
  type AutoApproveInput,
  decideAutoApprove,
  formatMoney,
} from "./auto-approve-policy";

function approveInput(overrides: Partial<AutoApproveInput> = {}): AutoApproveInput {
  return {
    status: PurchaseOrderStatus.AWAITING_APPROVAL,
    orderingMode: SupplierOrderingMode.EMAIL,
    supplierEmail: "rep@supplier.test",
    thresholdCents: 20_000,
    lines: [{ quantityOrdered: 2, latestCostCents: 1_500 }],
    ...overrides,
  };
}

// ─── happy paths ────────────────────────────────────────────────────────────

test("decideAutoApprove: approves EMAIL PO under cap", () => {
  const decision = decideAutoApprove(approveInput());

  assert.deepEqual(decision, {
    approve: true,
    totalCents: 3_000,
    thresholdCents: 20_000,
  });
});

test("decideAutoApprove: approves DRAFT status (not just AWAITING_APPROVAL)", () => {
  const decision = decideAutoApprove(
    approveInput({ status: PurchaseOrderStatus.DRAFT })
  );

  assert.equal(decision.approve, true);
});

test("decideAutoApprove: approves when total equals threshold exactly", () => {
  const decision = decideAutoApprove(
    approveInput({
      thresholdCents: 3_000,
      lines: [{ quantityOrdered: 2, latestCostCents: 1_500 }],
    })
  );

  assert.equal(decision.approve, true);
  if (decision.approve) {
    assert.equal(decision.totalCents, 3_000);
  }
});

test("decideAutoApprove: sums multiple lines correctly", () => {
  const decision = decideAutoApprove(
    approveInput({
      thresholdCents: 100_000,
      lines: [
        { quantityOrdered: 3, latestCostCents: 1_000 },
        { quantityOrdered: 5, latestCostCents: 200 },
        { quantityOrdered: 1, latestCostCents: 7_500 },
      ],
    })
  );

  assert.equal(decision.approve, true);
  if (decision.approve) {
    assert.equal(decision.totalCents, 3_000 + 1_000 + 7_500);
  }
});

test("decideAutoApprove: line with latestCostCents === 0 is allowed (free samples)", () => {
  const decision = decideAutoApprove(
    approveInput({
      lines: [
        { quantityOrdered: 2, latestCostCents: 1_000 },
        { quantityOrdered: 1, latestCostCents: 0 },
      ],
    })
  );

  assert.equal(decision.approve, true);
  if (decision.approve) {
    assert.equal(decision.totalCents, 2_000);
  }
});

// ─── status guard ───────────────────────────────────────────────────────────

for (const blocked of [
  PurchaseOrderStatus.APPROVED,
  PurchaseOrderStatus.SENT,
  PurchaseOrderStatus.ACKNOWLEDGED,
  PurchaseOrderStatus.DELIVERED,
  PurchaseOrderStatus.CANCELLED,
  PurchaseOrderStatus.FAILED,
]) {
  test(`decideAutoApprove: refuses ${blocked} status`, () => {
    const decision = decideAutoApprove(approveInput({ status: blocked }));

    assert.equal(decision.approve, false);
    if (!decision.approve) {
      assert.match(decision.reason, new RegExp(blocked.toLowerCase()));
    }
  });
}

// ─── ordering mode guard ────────────────────────────────────────────────────

for (const mode of [SupplierOrderingMode.WEBSITE, SupplierOrderingMode.MANUAL]) {
  test(`decideAutoApprove: refuses ${mode} orderingMode`, () => {
    const decision = decideAutoApprove(approveInput({ orderingMode: mode }));

    assert.equal(decision.approve, false);
    if (!decision.approve) {
      assert.match(decision.reason, /not email/);
    }
  });
}

// ─── supplier email guard ───────────────────────────────────────────────────

test("decideAutoApprove: refuses when supplier email is null", () => {
  const decision = decideAutoApprove(approveInput({ supplierEmail: null }));

  assert.equal(decision.approve, false);
  if (!decision.approve) {
    assert.match(decision.reason, /no email/);
  }
});

test("decideAutoApprove: refuses when supplier email is empty string", () => {
  const decision = decideAutoApprove(approveInput({ supplierEmail: "" }));

  assert.equal(decision.approve, false);
});

test("decideAutoApprove: refuses when supplier email is whitespace only", () => {
  const decision = decideAutoApprove(approveInput({ supplierEmail: "   " }));

  assert.equal(decision.approve, false);
  if (!decision.approve) {
    assert.match(decision.reason, /no email/);
  }
});

// ─── threshold guard ────────────────────────────────────────────────────────

test("decideAutoApprove: refuses when threshold is null", () => {
  const decision = decideAutoApprove(approveInput({ thresholdCents: null }));

  assert.equal(decision.approve, false);
  if (!decision.approve) {
    assert.match(decision.reason, /threshold not set/);
  }
});

test("decideAutoApprove: refuses when threshold is zero", () => {
  const decision = decideAutoApprove(approveInput({ thresholdCents: 0 }));

  assert.equal(decision.approve, false);
  if (!decision.approve) {
    assert.match(decision.reason, /threshold not set/);
  }
});

test("decideAutoApprove: refuses when threshold is negative", () => {
  const decision = decideAutoApprove(approveInput({ thresholdCents: -100 }));

  assert.equal(decision.approve, false);
});

test("decideAutoApprove: refuses when threshold is Infinity", () => {
  const decision = decideAutoApprove(
    approveInput({ thresholdCents: Number.POSITIVE_INFINITY })
  );

  assert.equal(decision.approve, false);
});

test("decideAutoApprove: refuses when threshold is NaN", () => {
  const decision = decideAutoApprove(approveInput({ thresholdCents: Number.NaN }));

  assert.equal(decision.approve, false);
});

test("decideAutoApprove: refuses when total exceeds threshold", () => {
  const decision = decideAutoApprove(
    approveInput({
      thresholdCents: 1_000,
      lines: [{ quantityOrdered: 2, latestCostCents: 1_500 }],
    })
  );

  assert.equal(decision.approve, false);
  if (!decision.approve) {
    assert.match(decision.reason, /\$30\.00 > cap \$10\.00/);
  }
});

// ─── line guards ────────────────────────────────────────────────────────────

test("decideAutoApprove: refuses empty lines array (regression: never silently approve $0 PO)", () => {
  const decision = decideAutoApprove(approveInput({ lines: [] }));

  assert.equal(decision.approve, false);
  if (!decision.approve) {
    assert.match(decision.reason, /no lines/);
  }
});

test("decideAutoApprove: refuses line with null latestCostCents", () => {
  const decision = decideAutoApprove(
    approveInput({
      lines: [
        { quantityOrdered: 2, latestCostCents: 1_500 },
        { quantityOrdered: 1, latestCostCents: null },
      ],
    })
  );

  assert.equal(decision.approve, false);
  if (!decision.approve) {
    assert.match(decision.reason, /no price/);
  }
});

test("decideAutoApprove: refuses line with negative latestCostCents", () => {
  const decision = decideAutoApprove(
    approveInput({
      lines: [{ quantityOrdered: 1, latestCostCents: -100 }],
    })
  );

  assert.equal(decision.approve, false);
});

test("decideAutoApprove: refuses line with non-finite latestCostCents", () => {
  const decision = decideAutoApprove(
    approveInput({
      lines: [{ quantityOrdered: 1, latestCostCents: Number.NaN }],
    })
  );

  assert.equal(decision.approve, false);
});

test("decideAutoApprove: refuses line with zero quantityOrdered (regression: no free rides)", () => {
  const decision = decideAutoApprove(
    approveInput({
      lines: [{ quantityOrdered: 0, latestCostCents: 1_500 }],
    })
  );

  assert.equal(decision.approve, false);
  if (!decision.approve) {
    assert.match(decision.reason, /non-positive quantity/);
  }
});

test("decideAutoApprove: refuses line with negative quantityOrdered (regression: can't trick total below cap)", () => {
  const decision = decideAutoApprove(
    approveInput({
      thresholdCents: 1_000,
      lines: [
        { quantityOrdered: 10, latestCostCents: 1_000 }, // 10,000
        { quantityOrdered: -20, latestCostCents: 500 }, // -10,000
      ],
    })
  );

  assert.equal(decision.approve, false);
  if (!decision.approve) {
    assert.match(decision.reason, /non-positive quantity/);
  }
});

test("decideAutoApprove: refuses line with non-finite quantityOrdered", () => {
  const decision = decideAutoApprove(
    approveInput({
      lines: [{ quantityOrdered: Number.POSITIVE_INFINITY, latestCostCents: 100 }],
    })
  );

  assert.equal(decision.approve, false);
});

// ─── evaluation order (early-exit semantics) ────────────────────────────────

test("decideAutoApprove: status is checked before ordering mode", () => {
  const decision = decideAutoApprove(
    approveInput({
      status: PurchaseOrderStatus.SENT,
      orderingMode: SupplierOrderingMode.MANUAL,
    })
  );

  assert.equal(decision.approve, false);
  if (!decision.approve) {
    assert.match(decision.reason, /sent/);
  }
});

test("decideAutoApprove: ordering mode is checked before email presence", () => {
  const decision = decideAutoApprove(
    approveInput({
      orderingMode: SupplierOrderingMode.WEBSITE,
      supplierEmail: null,
    })
  );

  assert.equal(decision.approve, false);
  if (!decision.approve) {
    assert.match(decision.reason, /website/);
  }
});

test("decideAutoApprove: email presence is checked before threshold", () => {
  const decision = decideAutoApprove(
    approveInput({ supplierEmail: null, thresholdCents: null })
  );

  assert.equal(decision.approve, false);
  if (!decision.approve) {
    assert.match(decision.reason, /no email/);
  }
});

test("decideAutoApprove: threshold is checked before line-level guards", () => {
  const decision = decideAutoApprove(
    approveInput({ thresholdCents: 0, lines: [] })
  );

  assert.equal(decision.approve, false);
  if (!decision.approve) {
    assert.match(decision.reason, /threshold not set/);
  }
});

// ─── formatMoney ────────────────────────────────────────────────────────────

test("formatMoney: formats whole dollars", () => {
  assert.equal(formatMoney(100), "$1.00");
  assert.equal(formatMoney(20_000), "$200.00");
});

test("formatMoney: formats fractional cents", () => {
  assert.equal(formatMoney(4_299), "$42.99");
  assert.equal(formatMoney(1), "$0.01");
});

test("formatMoney: handles zero", () => {
  assert.equal(formatMoney(0), "$0.00");
});
