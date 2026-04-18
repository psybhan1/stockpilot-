import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateRecipeCogs,
  classifyMargin,
  costOneComponent,
  type CostingComponent,
} from "./costing";

function component(overrides: Partial<CostingComponent> = {}): CostingComponent {
  return {
    id: "c-1",
    inventoryItemId: "item-1",
    inventoryItemName: "Milk",
    quantityBase: 100,
    packSizeBase: 1000,
    lastUnitCostCents: 200,
    componentType: "INGREDIENT" as CostingComponent["componentType"],
    displayUnit: "LITER" as CostingComponent["displayUnit"],
    optional: false,
    modifierKey: null,
    conditionServiceMode: null,
    ...overrides,
  };
}

// ── costOneComponent ────────────────────────────────────────────────

test("costOneComponent: computes pro-rata cost from qty × cost/pack", () => {
  // 100ml of 1000ml pack that cost 200¢ = 20¢
  assert.equal(costOneComponent(component()), 20);
});

test("costOneComponent: preserves sub-cent precision (×100 / round / ÷100)", () => {
  // 1g of a 1000g pack that cost 100¢ = 0.1¢, stored as 0.1
  assert.equal(costOneComponent(component({ quantityBase: 1, packSizeBase: 1000, lastUnitCostCents: 100 })), 0.1);
});

test("costOneComponent: null cost → null", () => {
  assert.equal(costOneComponent(component({ lastUnitCostCents: null })), null);
});

test("costOneComponent: zero/negative cost → null (bad data)", () => {
  assert.equal(costOneComponent(component({ lastUnitCostCents: 0 })), null);
  assert.equal(costOneComponent(component({ lastUnitCostCents: -10 })), null);
});

test("costOneComponent: zero pack size → null (guard div-by-zero)", () => {
  assert.equal(costOneComponent(component({ packSizeBase: 0 })), null);
  assert.equal(costOneComponent(component({ packSizeBase: -5 })), null);
});

test("costOneComponent: zero qty returns 0 (valid — not-a-missing-cost)", () => {
  // Garnish-style components that are "in the recipe but zero measured"
  // shouldn't look like missing data.
  assert.equal(costOneComponent(component({ quantityBase: 0 })), 0);
});

// ── calculateRecipeCogs ─────────────────────────────────────────────

test("calculateRecipeCogs: sums required ingredients, excludes optional/modifier", () => {
  const result = calculateRecipeCogs([
    component({ id: "a", quantityBase: 100, packSizeBase: 1000, lastUnitCostCents: 200 }), // 20¢
    component({ id: "b", quantityBase: 50, packSizeBase: 1000, lastUnitCostCents: 500 }), // 25¢
    // optional modifier — excluded from default COGS
    component({ id: "c", quantityBase: 100, packSizeBase: 1000, lastUnitCostCents: 400, optional: true, modifierKey: "OAT_MILK" }),
  ]);
  assert.equal(result.cogsCents, 45);
  assert.equal(result.confidence, 1); // 2/2 priced
  assert.equal(result.breakdown.length, 3);
  assert.equal(result.breakdown[2].costCents, 40); // modifier still shown on breakdown
  assert.equal(result.warnings.length, 0);
});

test("calculateRecipeCogs: modifier-only component (optional=false but modifierKey set) is still excluded", () => {
  const result = calculateRecipeCogs([
    component({ id: "a", quantityBase: 100, packSizeBase: 1000, lastUnitCostCents: 200 }), // 20¢ required
    component({ id: "b", quantityBase: 100, packSizeBase: 1000, lastUnitCostCents: 400, optional: false, modifierKey: "UPSIZE" }),
  ]);
  assert.equal(result.cogsCents, 20); // modifier excluded
});

test("calculateRecipeCogs: confidence degrades when a required ingredient lacks cost data", () => {
  const result = calculateRecipeCogs([
    component({ id: "a", lastUnitCostCents: 200 }),
    component({ id: "b", lastUnitCostCents: null }),
    component({ id: "c", lastUnitCostCents: 500 }),
  ]);
  assert.equal(result.confidence, 2 / 3);
  assert.ok(result.warnings.some((w) => w.includes("1 of 3")));
  assert.equal(result.breakdown.find((x) => x.componentId === "b")?.warning, "No recent purchase cost on file for this ingredient.");
});

test("calculateRecipeCogs: zero-component recipe yields zero COGS + warning", () => {
  const result = calculateRecipeCogs([]);
  assert.equal(result.cogsCents, 0);
  assert.equal(result.confidence, 0);
  assert.ok(result.warnings.some((w) => w.toLowerCase().includes("no required")));
});

test("calculateRecipeCogs: avoids cumulative rounding drift with many tiny ingredients", () => {
  // 10 ingredients each 0.6¢ should sum to 6¢ — not 10 or 0 from per-step
  // whole-cent rounding.
  const comps = Array.from({ length: 10 }, (_, i) =>
    component({
      id: `tiny-${i}`,
      quantityBase: 3,
      packSizeBase: 1000,
      lastUnitCostCents: 200, // per unit: 3/1000 × 200 = 0.6¢
    })
  );
  const result = calculateRecipeCogs(comps);
  assert.equal(result.cogsCents, 6); // 10 × 0.6 = 6.0 → rounds to 6
});

test("calculateRecipeCogs: bad pack size gives a specific warning", () => {
  const result = calculateRecipeCogs([
    component({ id: "a", packSizeBase: 0, lastUnitCostCents: 100 }),
  ]);
  assert.equal(result.breakdown[0].warning, "Pack size on the inventory item is zero / invalid.");
  assert.equal(result.confidence, 0);
});

// ── classifyMargin ──────────────────────────────────────────────────

test("classifyMargin: healthy ≥70% margin", () => {
  const m = classifyMargin({ cogsCents: 100, sellPriceCents: 500 }); // 80%
  assert.equal(m.severity, "healthy");
  assert.equal(m.marginCents, 400);
  assert.equal(m.marginPct, 0.8);
});

test("classifyMargin: watch at 65%", () => {
  const m = classifyMargin({ cogsCents: 175, sellPriceCents: 500 }); // 65%
  assert.equal(m.severity, "watch");
});

test("classifyMargin: review below 60%", () => {
  const m = classifyMargin({ cogsCents: 250, sellPriceCents: 500 }); // 50%
  assert.equal(m.severity, "review");
});

test("classifyMargin: unpriced when no sell price", () => {
  const m = classifyMargin({ cogsCents: 100, sellPriceCents: null });
  assert.equal(m.severity, "unpriced");
  assert.equal(m.marginCents, null);
  assert.equal(m.marginPct, null);
});

test("classifyMargin: unpriced when sell price is zero/negative", () => {
  assert.equal(classifyMargin({ cogsCents: 100, sellPriceCents: 0 }).severity, "unpriced");
  assert.equal(classifyMargin({ cogsCents: 100, sellPriceCents: -100 }).severity, "unpriced");
});

test("classifyMargin: upside-down recipe (COGS > sell) is review, negative margin", () => {
  const m = classifyMargin({ cogsCents: 600, sellPriceCents: 500 });
  assert.equal(m.severity, "review");
  assert.equal(m.marginCents, -100);
  assert.equal(m.marginPct, -0.2);
});

test("classifyMargin: exactly 70% is healthy (inclusive of threshold)", () => {
  const m = classifyMargin({ cogsCents: 150, sellPriceCents: 500 }); // 70%
  assert.equal(m.severity, "healthy");
});

test("classifyMargin: exactly 60% is watch (watch band is [60%, 70%))", () => {
  const m = classifyMargin({ cogsCents: 200, sellPriceCents: 500 }); // 60%
  assert.equal(m.severity, "watch");
});
