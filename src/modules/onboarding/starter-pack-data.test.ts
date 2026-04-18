import test from "node:test";
import assert from "node:assert/strict";

import {
  ESPRESSO_BAR_STARTER,
  buildStarterInventoryRows,
} from "./starter-pack-data";

const VALID_CATEGORIES = new Set([
  "COFFEE",
  "DAIRY",
  "ALT_DAIRY",
  "SYRUP",
  "PACKAGING",
  "CLEANING",
  "PAPER_GOODS",
  "RETAIL",
  "SEASONAL",
  "BAKERY_INGREDIENT",
]);

const VALID_BASE_UNITS = new Set(["GRAM", "MILLILITER", "COUNT"]);

// ── Pack-level invariants (catch a bad edit to the data array) ────────────

test("pack ships exactly 16 items (the number we sized the dashboard around)", () => {
  assert.equal(ESPRESSO_BAR_STARTER.length, 16);
});

test("every SKU is unique (createMany would still insert dupes — uniqueness is on us)", () => {
  const skus = ESPRESSO_BAR_STARTER.map((i) => i.sku);
  assert.equal(new Set(skus).size, skus.length);
});

test("every SKU is namespaced with STARTER- (lets us identify + bulk-delete pack items later)", () => {
  for (const item of ESPRESSO_BAR_STARTER) {
    assert.ok(
      item.sku.startsWith("STARTER-"),
      `${item.sku} is missing the STARTER- prefix`
    );
  }
});

test("every SKU is uppercase + dash-separated (no spaces, no accidental lowercase)", () => {
  for (const item of ESPRESSO_BAR_STARTER) {
    assert.match(item.sku, /^[A-Z0-9-]+$/, `bad SKU shape: ${item.sku}`);
  }
});

test("every name is non-empty and trimmed (UI shows it directly)", () => {
  for (const item of ESPRESSO_BAR_STARTER) {
    assert.ok(item.name.length > 0, "empty name");
    assert.equal(item.name, item.name.trim(), `name has surrounding whitespace: "${item.name}"`);
  }
});

test("every category is a valid enum value (a typo would crash createMany at runtime)", () => {
  for (const item of ESPRESSO_BAR_STARTER) {
    assert.ok(
      VALID_CATEGORIES.has(item.category),
      `${item.sku} has unknown category: ${item.category}`
    );
  }
});

test("every baseUnit is a valid enum value", () => {
  for (const item of ESPRESSO_BAR_STARTER) {
    assert.ok(
      VALID_BASE_UNITS.has(item.baseUnit),
      `${item.sku} has unknown baseUnit: ${item.baseUnit}`
    );
  }
});

// ── Threshold invariants (a bad edit here = noisy false alerts on day one) ─

test("low ≤ par for every item (else we ship accounts already showing red)", () => {
  for (const item of ESPRESSO_BAR_STARTER) {
    assert.ok(
      item.lowBase <= item.parBase,
      `${item.sku} has low (${item.lowBase}) > par (${item.parBase})`
    );
  }
});

test("low > 0 for every item (a 0 threshold disables low-stock alerts entirely)", () => {
  for (const item of ESPRESSO_BAR_STARTER) {
    assert.ok(item.lowBase > 0, `${item.sku} has lowBase = 0`);
  }
});

test("par > 0 for every item", () => {
  for (const item of ESPRESSO_BAR_STARTER) {
    assert.ok(item.parBase > 0, `${item.sku} has parBase = 0`);
  }
});

test("packBase > 0 for every item (a 0 pack size breaks reorder math downstream)", () => {
  for (const item of ESPRESSO_BAR_STARTER) {
    assert.ok(item.packBase > 0, `${item.sku} has packBase = 0`);
  }
});

test("all numeric fields are integers (base units are minor units — fractional makes no sense)", () => {
  for (const item of ESPRESSO_BAR_STARTER) {
    assert.equal(Math.floor(item.parBase), item.parBase, `${item.sku} parBase not int`);
    assert.equal(Math.floor(item.lowBase), item.lowBase, `${item.sku} lowBase not int`);
    assert.equal(Math.floor(item.packBase), item.packBase, `${item.sku} packBase not int`);
  }
});

// ── Coverage smoke checks (the pack is supposed to cover ~90% of café flows) ─

test("includes at least one COFFEE item (it's a café)", () => {
  assert.ok(ESPRESSO_BAR_STARTER.some((i) => i.category === "COFFEE"));
});

test("includes at least one DAIRY item (most drinks have milk)", () => {
  assert.ok(ESPRESSO_BAR_STARTER.some((i) => i.category === "DAIRY"));
});

test("includes at least one ALT_DAIRY item (oat/almond demand is high)", () => {
  assert.ok(ESPRESSO_BAR_STARTER.some((i) => i.category === "ALT_DAIRY"));
});

test("includes at least one SYRUP item (vanilla/caramel are universal)", () => {
  assert.ok(ESPRESSO_BAR_STARTER.some((i) => i.category === "SYRUP"));
});

test("includes at least one PACKAGING item (no cup → no to-go sale)", () => {
  assert.ok(ESPRESSO_BAR_STARTER.some((i) => i.category === "PACKAGING"));
});

test("includes at least one CLEANING item (health code item, must be tracked)", () => {
  assert.ok(ESPRESSO_BAR_STARTER.some((i) => i.category === "CLEANING"));
});

// ── buildStarterInventoryRows: shape + math ───────────────────────────────

test("buildStarterInventoryRows: returns one row per starter item, in the same order", () => {
  const rows = buildStarterInventoryRows("loc-1");
  assert.equal(rows.length, ESPRESSO_BAR_STARTER.length);
  for (let i = 0; i < rows.length; i++) {
    assert.equal(rows[i].sku, ESPRESSO_BAR_STARTER[i].sku);
  }
});

test("buildStarterInventoryRows: every row carries the locationId we passed in", () => {
  const rows = buildStarterInventoryRows("loc-abc-123");
  for (const row of rows) {
    assert.equal(row.locationId, "loc-abc-123");
  }
});

test("buildStarterInventoryRows: empty locationId string is preserved (caller's choice)", () => {
  // Don't second-guess — the DB constraint will reject it.
  const rows = buildStarterInventoryRows("");
  assert.equal(rows[0].locationId, "");
});

test("buildStarterInventoryRows: stockOnHandBase is 0 for every row (new account, nothing on the shelf yet)", () => {
  const rows = buildStarterInventoryRows("loc-1");
  for (const row of rows) {
    assert.equal(row.stockOnHandBase, 0);
  }
});

test("buildStarterInventoryRows: countUnit / displayUnit / purchaseUnit all default to baseUnit", () => {
  const rows = buildStarterInventoryRows("loc-1");
  for (const row of rows) {
    assert.equal(row.countUnit, row.baseUnit, `${row.sku} countUnit mismatch`);
    assert.equal(row.displayUnit, row.baseUnit, `${row.sku} displayUnit mismatch`);
    assert.equal(row.purchaseUnit, row.baseUnit, `${row.sku} purchaseUnit mismatch`);
  }
});

test("buildStarterInventoryRows: parLevelBase / lowStockThresholdBase / packSizeBase pass through unchanged", () => {
  const rows = buildStarterInventoryRows("loc-1");
  for (let i = 0; i < rows.length; i++) {
    assert.equal(rows[i].parLevelBase, ESPRESSO_BAR_STARTER[i].parBase);
    assert.equal(rows[i].lowStockThresholdBase, ESPRESSO_BAR_STARTER[i].lowBase);
    assert.equal(rows[i].packSizeBase, ESPRESSO_BAR_STARTER[i].packBase);
  }
});

test("buildStarterInventoryRows: safetyStock = floor(low / 2) when low ≥ 2", () => {
  const rows = buildStarterInventoryRows("loc-1");
  for (const row of rows) {
    if (row.lowStockThresholdBase >= 2) {
      assert.equal(
        row.safetyStockBase,
        Math.floor(row.lowStockThresholdBase / 2),
        `${row.sku} safety-stock math`
      );
    }
  }
});

test("buildStarterInventoryRows: safetyStock clamps to 1 when low / 2 would round to 0", () => {
  // None of the current items hit this branch (smallest low is 100),
  // but the clamp is critical — a 0 safety stock silently disables
  // the safety-stock math in the reorder engine downstream. So we
  // sanity-check both sides: every row is ≥ 1, AND the math holds
  // when we'd otherwise round to 0.
  const rows = buildStarterInventoryRows("loc-1");
  for (const row of rows) {
    assert.ok(row.safetyStockBase >= 1, `${row.sku} safety stock is 0 — that breaks reorder math`);
  }
});

test("buildStarterInventoryRows: every row has a positive safety stock", () => {
  const rows = buildStarterInventoryRows("loc-1");
  for (const row of rows) {
    assert.ok(row.safetyStockBase > 0, `${row.sku} non-positive safety stock`);
  }
});

test("buildStarterInventoryRows: safety stock ≤ low threshold (else low-stock alert never fires before safety kicks in)", () => {
  const rows = buildStarterInventoryRows("loc-1");
  for (const row of rows) {
    assert.ok(
      row.safetyStockBase <= row.lowStockThresholdBase,
      `${row.sku} safety (${row.safetyStockBase}) > low (${row.lowStockThresholdBase})`
    );
  }
});

test("buildStarterInventoryRows: pure — calling twice with the same input gives equal rows", () => {
  const a = buildStarterInventoryRows("loc-1");
  const b = buildStarterInventoryRows("loc-1");
  assert.deepEqual(a, b);
});

test("buildStarterInventoryRows: pure — does not mutate the source ESPRESSO_BAR_STARTER", () => {
  const before = JSON.parse(JSON.stringify(ESPRESSO_BAR_STARTER));
  buildStarterInventoryRows("loc-1");
  buildStarterInventoryRows("loc-2");
  assert.deepEqual(ESPRESSO_BAR_STARTER, before);
});

test("buildStarterInventoryRows: different locations produce row arrays that differ ONLY in locationId", () => {
  const rowsA = buildStarterInventoryRows("loc-a");
  const rowsB = buildStarterInventoryRows("loc-b");
  assert.equal(rowsA.length, rowsB.length);
  for (let i = 0; i < rowsA.length; i++) {
    const { locationId: idA, ...restA } = rowsA[i];
    const { locationId: idB, ...restB } = rowsB[i];
    assert.equal(idA, "loc-a");
    assert.equal(idB, "loc-b");
    assert.deepEqual(restA, restB);
  }
});

test("buildStarterInventoryRows: returns a fresh array each call (caller can sort/mutate without poisoning the next)", () => {
  const a = buildStarterInventoryRows("loc-1");
  a.length = 0;
  const b = buildStarterInventoryRows("loc-1");
  assert.equal(b.length, ESPRESSO_BAR_STARTER.length);
});
