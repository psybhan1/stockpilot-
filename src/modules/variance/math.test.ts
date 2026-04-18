import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateVarianceRow,
  classifyVarianceSeverity,
  emptyBuckets,
  type MovementBreakdown,
} from "./math";

function buckets(overrides: Partial<MovementBreakdown> = {}): MovementBreakdown {
  return { ...emptyBuckets(), ...overrides };
}

// ── classifyVarianceSeverity ────────────────────────────────────────

test("variance severity: clean when under all thresholds", () => {
  assert.equal(
    classifyVarianceSeverity({ shrinkageCents: 500, shrinkagePct: 0.01 }),
    "clean"
  );
});

test("variance severity: watch when 2%+ pct even at low dollar", () => {
  assert.equal(
    classifyVarianceSeverity({ shrinkageCents: 50, shrinkagePct: 0.02 }),
    "watch"
  );
});

test("variance severity: watch when $15+ even at low pct", () => {
  assert.equal(
    classifyVarianceSeverity({ shrinkageCents: 1500, shrinkagePct: 0.001 }),
    "watch"
  );
});

test("variance severity: review when 5%+ pct", () => {
  assert.equal(
    classifyVarianceSeverity({ shrinkageCents: 10, shrinkagePct: 0.05 }),
    "review"
  );
});

test("variance severity: review when $50+", () => {
  assert.equal(
    classifyVarianceSeverity({ shrinkageCents: 5000, shrinkagePct: 0 }),
    "review"
  );
});

test("variance severity: treats null inputs as zero (no false flags)", () => {
  assert.equal(
    classifyVarianceSeverity({ shrinkageCents: null, shrinkagePct: null }),
    "clean"
  );
});

// ── calculateVarianceRow ────────────────────────────────────────────

test("variance row: clean item with zero loss", () => {
  const row = calculateVarianceRow({
    inventoryItemId: "item-1",
    itemName: "Whole Milk",
    category: "DAIRY",
    displayUnit: "LITER",
    packSizeBase: 4000, // 4L pack, base=ml
    unitCostCents: 800, // $8.00 per 4L pack → $0.002/ml
    buckets: buckets({ pos_depletion: -2000 }), // used 2L (stored as negative delta)
  });
  assert.equal(row.theoreticalUsageBase, 2000);
  assert.equal(row.theoreticalUsageCents, 400); // 2000ml × $0.002 = $4.00
  assert.equal(row.shrinkageBase, 0);
  assert.equal(row.shrinkageCents, 0);
  assert.equal(row.shrinkagePct, 0); // division: 0/2000
  assert.equal(row.severity, "clean");
});

test("variance row: shrinkage from a negative CORRECTION (books say more than shelf)", () => {
  // POS used 2000ml; physical count found 200ml missing beyond that
  // → a CORRECTION of -200 is written to reconcile.
  const row = calculateVarianceRow({
    inventoryItemId: "item-1",
    itemName: "Whole Milk",
    category: null,
    displayUnit: "LITER",
    packSizeBase: 4000,
    unitCostCents: 800, // $0.002/ml
    buckets: buckets({ pos_depletion: -2000, correction: -200 }),
  });
  assert.equal(row.shrinkageBase, 200); // -(-200) = +200 loss
  assert.equal(row.shrinkageCents, 40); // 200 × 0.2¢ = 40¢
  assert.equal(row.shrinkagePct, 0.1); // 200/2000 = 10%
  assert.equal(row.severity, "review"); // 10% > 5% threshold
});

test("variance row: positive CORRECTION shows as negative shrinkage (found more than books knew)", () => {
  const row = calculateVarianceRow({
    inventoryItemId: "item-1",
    itemName: "Coffee Beans",
    category: null,
    displayUnit: "KILOGRAM",
    packSizeBase: 1000, // 1kg pack
    unitCostCents: 2000,
    buckets: buckets({ pos_depletion: -500, correction: 50 }),
  });
  assert.equal(row.shrinkageBase, -50); // preserved sign — pessimistic books
  assert.equal(row.shrinkageCents, 100); // |−50| × 2¢ = 100¢ (still flagged as a data issue)
  assert.equal(row.shrinkagePct, -0.1); // -50/500 signed
  // severity uses abs of pct; 10% pessimism still review
  assert.equal(row.severity, "review");
});

test("variance row: tracked waste + breakage + transfer all roll into tracked bucket", () => {
  const row = calculateVarianceRow({
    inventoryItemId: "item-1",
    itemName: "Tomatoes",
    category: null,
    displayUnit: "KILOGRAM",
    packSizeBase: 1000,
    unitCostCents: 500,
    buckets: buckets({
      pos_depletion: -2000,
      waste: -100, // 100g spoilage
      breakage: -50, // 50g dropped
      transfer: -150, // 150g sent to sister location
    }),
  });
  assert.equal(row.trackedWasteBase, 300);
  assert.equal(row.trackedWasteCents, 150); // 300g × 0.5¢/g
  assert.equal(row.shrinkageBase, 0); // nothing in correction/count_adjustment
  assert.equal(row.severity, "clean"); // tracked waste alone doesn't flag
});

test("variance row: count_adjustment combines with correction for shrinkage", () => {
  const row = calculateVarianceRow({
    inventoryItemId: "item-1",
    itemName: "Whiskey",
    category: "ALCOHOL",
    displayUnit: "BOTTLE",
    packSizeBase: 750, // 750ml bottle
    unitCostCents: 3000,
    buckets: buckets({
      pos_depletion: -7500, // 10 bottles' worth sold
      correction: -150,
      count_adjustment: -100,
    }),
  });
  assert.equal(row.shrinkageBase, 250); // -(-150 + -100)
  // 7500ml usage: 250/7500 ≈ 3.33%
  assert.ok(row.shrinkagePct !== null && Math.abs(row.shrinkagePct - 0.0333) < 0.001);
  assert.equal(row.severity, "watch"); // >2% but <5% AND dollar value
});

test("variance row: null unitCostCents yields null dollar fields but still computes base qty", () => {
  const row = calculateVarianceRow({
    inventoryItemId: "item-1",
    itemName: "Obscure Garnish",
    category: null,
    displayUnit: "COUNT",
    packSizeBase: 1,
    unitCostCents: null,
    buckets: buckets({ pos_depletion: -10, correction: -2 }),
  });
  assert.equal(row.theoreticalUsageCents, null);
  assert.equal(row.shrinkageCents, null);
  assert.equal(row.trackedWasteCents, null);
  assert.equal(row.shrinkageBase, 2);
  // severity classified on pct only when cents are null
  // 2/10 = 20% — review
  assert.equal(row.severity, "review");
});

test("variance row: zero packSize disables dollar math (guards against div-by-zero)", () => {
  const row = calculateVarianceRow({
    inventoryItemId: "item-1",
    itemName: "Misconfigured Item",
    category: null,
    displayUnit: "COUNT",
    packSizeBase: 0,
    unitCostCents: 500,
    buckets: buckets({ pos_depletion: -5, correction: -1 }),
  });
  assert.equal(row.theoreticalUsageCents, null);
  assert.equal(row.shrinkageCents, null);
});

test("variance row: theoretical usage is absolute (POS_DEPLETION stored as negative delta)", () => {
  const row = calculateVarianceRow({
    inventoryItemId: "item-1",
    itemName: "Milk",
    category: null,
    displayUnit: "LITER",
    packSizeBase: 1000,
    unitCostCents: 200,
    buckets: buckets({ pos_depletion: -500 }),
  });
  assert.equal(row.theoreticalUsageBase, 500);
});

test("variance row: zero theoretical usage returns null pct (avoid div-by-zero noise)", () => {
  const row = calculateVarianceRow({
    inventoryItemId: "item-1",
    itemName: "Seasonal Item",
    category: null,
    displayUnit: "COUNT",
    packSizeBase: 1,
    unitCostCents: 100,
    buckets: buckets({ correction: -5 }), // no pos_depletion
  });
  assert.equal(row.theoreticalUsageBase, 0);
  assert.equal(row.shrinkagePct, null);
  // still flagged on dollar axis if loss is material
  assert.equal(row.shrinkageBase, 5);
  assert.equal(row.shrinkageCents, 500); // $5 — hits $15 watch? no, under.
  assert.equal(row.severity, "clean");
});

test("variance row: received is always positive regardless of delta sign", () => {
  const row = calculateVarianceRow({
    inventoryItemId: "item-1",
    itemName: "Milk",
    category: null,
    displayUnit: "LITER",
    packSizeBase: 1000,
    unitCostCents: 200,
    buckets: buckets({ received: 4000 }),
  });
  assert.equal(row.receivedBase, 4000);
});

test("variance row: preserves movementBreakdown unchanged for UI detail view", () => {
  const b = buckets({ pos_depletion: -100, waste: -10, correction: -5 });
  const row = calculateVarianceRow({
    inventoryItemId: "item-1",
    itemName: "X",
    category: null,
    displayUnit: "COUNT",
    packSizeBase: 1,
    unitCostCents: 100,
    buckets: b,
  });
  assert.deepEqual(row.movementBreakdown, b);
});
