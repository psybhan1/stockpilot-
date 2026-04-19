import test from "node:test";
import assert from "node:assert/strict";

import {
  BaseUnit,
  InventoryCategory,
  MeasurementUnit,
  SupplierOrderingMode,
} from "../../../lib/domain-enums";

import {
  baseUnitLabel,
  categoryLabel,
  fuzzyMatchSupplier,
  generateSku,
  isSkip,
  matchIngredientsToInventory,
  measurementUnitFromBaseUnit,
  parseBaseUnit,
  parseCategory,
  parseNumber,
  parseOrderingMode,
  parsePackSize,
} from "./parse-helpers";

// ── parseCategory ────────────────────────────────────────────────────────────

test("parseCategory: coffee beans → COFFEE", () => {
  assert.equal(parseCategory("coffee beans"), InventoryCategory.COFFEE);
  assert.equal(parseCategory("espresso blend"), InventoryCategory.COFFEE);
  assert.equal(parseCategory("Ethiopian beans"), InventoryCategory.COFFEE);
});

test("parseCategory: vanilla syrup → SYRUP (not DAIRY)", () => {
  assert.equal(parseCategory("vanilla syrup"), InventoryCategory.SYRUP);
  assert.equal(parseCategory("caramel sauce"), InventoryCategory.SYRUP);
  assert.equal(parseCategory("pumpkin spice"), InventoryCategory.SYRUP);
});

test("parseCategory: coconut syrup stays SYRUP, not ALT_DAIRY", () => {
  // Regression: 'coconut' alone could hit ALT_DAIRY via substring, but
  // 'coconut syrup' should match SYRUP first because SYRUP is ordered first.
  assert.equal(parseCategory("coconut syrup"), InventoryCategory.SYRUP);
  assert.equal(parseCategory("hazelnut sauce"), InventoryCategory.SYRUP);
});

test("parseCategory: whole milk → DAIRY", () => {
  assert.equal(parseCategory("whole milk"), InventoryCategory.DAIRY);
  assert.equal(parseCategory("heavy cream"), InventoryCategory.DAIRY);
  assert.equal(parseCategory("butter"), InventoryCategory.DAIRY);
  assert.equal(parseCategory("cheese"), InventoryCategory.DAIRY);
  assert.equal(parseCategory("greek yogurt"), InventoryCategory.DAIRY);
});

test("parseCategory: oat milk → ALT_DAIRY (regression: was wrongly DAIRY)", () => {
  // BUG FIX: DAIRY's `milk|cream` used to match 'oat milk' before ALT_DAIRY
  // got a look in. Re-ordered so ALT_DAIRY is checked first.
  assert.equal(parseCategory("oat milk"), InventoryCategory.ALT_DAIRY);
  assert.equal(parseCategory("almond milk"), InventoryCategory.ALT_DAIRY);
  assert.equal(parseCategory("soy milk"), InventoryCategory.ALT_DAIRY);
  assert.equal(parseCategory("coconut milk"), InventoryCategory.ALT_DAIRY);
  assert.equal(parseCategory("cashew milk"), InventoryCategory.ALT_DAIRY);
});

test("parseCategory: soy cream / oat yoghurt → ALT_DAIRY", () => {
  // British spelling "yoghurt" supported.
  assert.equal(parseCategory("soy cream"), InventoryCategory.ALT_DAIRY);
  assert.equal(parseCategory("oat yoghurt"), InventoryCategory.ALT_DAIRY);
  assert.equal(parseCategory("oat yogurt"), InventoryCategory.ALT_DAIRY);
});

test("parseCategory: plant-based / non-dairy / alt-dairy descriptors → ALT_DAIRY", () => {
  assert.equal(parseCategory("plant-based milk"), InventoryCategory.ALT_DAIRY);
  assert.equal(parseCategory("plant based creamer"), InventoryCategory.ALT_DAIRY);
  assert.equal(parseCategory("non-dairy milk"), InventoryCategory.ALT_DAIRY);
  assert.equal(parseCategory("alt-dairy"), InventoryCategory.ALT_DAIRY);
});

test("parseCategory: bakery ingredients", () => {
  assert.equal(parseCategory("all-purpose flour"), InventoryCategory.BAKERY_INGREDIENT);
  assert.equal(parseCategory("white sugar"), InventoryCategory.BAKERY_INGREDIENT);
  assert.equal(parseCategory("eggs"), InventoryCategory.BAKERY_INGREDIENT);
  assert.equal(parseCategory("pecans"), InventoryCategory.BAKERY_INGREDIENT);
});

test("parseCategory: packaging", () => {
  assert.equal(parseCategory("paper cups"), InventoryCategory.PACKAGING);
  assert.equal(parseCategory("straws"), InventoryCategory.PACKAGING);
  assert.equal(parseCategory("takeaway bags"), InventoryCategory.PACKAGING);
  assert.equal(parseCategory("lids"), InventoryCategory.PACKAGING);
});

test("parseCategory: cleaning supplies", () => {
  assert.equal(parseCategory("dish soap"), InventoryCategory.CLEANING);
  assert.equal(parseCategory("sanitizer"), InventoryCategory.CLEANING);
  assert.equal(parseCategory("cleaning spray"), InventoryCategory.CLEANING);
  assert.equal(parseCategory("wipes"), InventoryCategory.CLEANING);
});

test("parseCategory: produce / fresh", () => {
  assert.equal(parseCategory("bananas"), InventoryCategory.SUPPLY);
  assert.equal(parseCategory("fresh blueberries"), InventoryCategory.SUPPLY);
  assert.equal(parseCategory("lemons"), InventoryCategory.SUPPLY);
  assert.equal(parseCategory("spinach"), InventoryCategory.SUPPLY);
});

test("parseCategory: case-insensitive + whitespace tolerant", () => {
  assert.equal(parseCategory("   Whole Milk  "), InventoryCategory.DAIRY);
  assert.equal(parseCategory("OAT MILK"), InventoryCategory.ALT_DAIRY);
  assert.equal(parseCategory("CoFFee BeAnS"), InventoryCategory.COFFEE);
});

test("parseCategory: unrecognized text → null", () => {
  assert.equal(parseCategory("xyzzy"), null);
  assert.equal(parseCategory(""), null);
  assert.equal(parseCategory("    "), null);
});

// ── categoryLabel ────────────────────────────────────────────────────────────

test("categoryLabel: each enum maps to a human label", () => {
  for (const cat of Object.values(InventoryCategory)) {
    const label = categoryLabel(cat as InventoryCategory);
    assert.equal(typeof label, "string");
    assert.ok(label.length > 0, `label for ${cat} is empty`);
  }
});

test("categoryLabel: key examples", () => {
  assert.equal(categoryLabel(InventoryCategory.ALT_DAIRY), "Alt dairy / plant-based milk");
  assert.equal(categoryLabel(InventoryCategory.SYRUP), "Syrup / sauce");
  assert.equal(categoryLabel(InventoryCategory.PAPER_GOODS), "Paper goods");
});

// ── parseBaseUnit ────────────────────────────────────────────────────────────

test("parseBaseUnit: weight keywords → GRAM", () => {
  assert.equal(parseBaseUnit("grams"), BaseUnit.GRAM);
  assert.equal(parseBaseUnit("kilograms"), BaseUnit.GRAM);
  assert.equal(parseBaseUnit("kg"), BaseUnit.GRAM);
  assert.equal(parseBaseUnit("weight"), BaseUnit.GRAM);
  assert.equal(parseBaseUnit("g"), BaseUnit.GRAM);
});

test("parseBaseUnit: volume keywords → MILLILITER", () => {
  assert.equal(parseBaseUnit("ml"), BaseUnit.MILLILITER);
  assert.equal(parseBaseUnit("milliliter"), BaseUnit.MILLILITER);
  assert.equal(parseBaseUnit("liter"), BaseUnit.MILLILITER);
  assert.equal(parseBaseUnit("litre"), BaseUnit.MILLILITER);
  assert.equal(parseBaseUnit("fluid"), BaseUnit.MILLILITER);
  assert.equal(parseBaseUnit("liquid"), BaseUnit.MILLILITER);
});

test("parseBaseUnit: count keywords → COUNT", () => {
  assert.equal(parseBaseUnit("count"), BaseUnit.COUNT);
  assert.equal(parseBaseUnit("units"), BaseUnit.COUNT);
  assert.equal(parseBaseUnit("pieces"), BaseUnit.COUNT);
  assert.equal(parseBaseUnit("each"), BaseUnit.COUNT);
  assert.equal(parseBaseUnit("ct"), BaseUnit.COUNT);
  assert.equal(parseBaseUnit("pc"), BaseUnit.COUNT);
});

test("parseBaseUnit: unknown → null", () => {
  assert.equal(parseBaseUnit("foobar"), null);
  assert.equal(parseBaseUnit(""), null);
});

// ── baseUnitLabel ────────────────────────────────────────────────────────────

test("baseUnitLabel: GRAM → grams, MILLILITER → ml, COUNT → units", () => {
  assert.equal(baseUnitLabel(BaseUnit.GRAM), "grams");
  assert.equal(baseUnitLabel(BaseUnit.MILLILITER), "ml");
  assert.equal(baseUnitLabel(BaseUnit.COUNT), "units");
});

// ── parseNumber ──────────────────────────────────────────────────────────────

test("parseNumber: plain integer", () => {
  assert.equal(parseNumber("5"), 5);
  assert.equal(parseNumber("  42  "), 42);
  assert.equal(parseNumber("0"), 0);
});

test("parseNumber: decimals rounded", () => {
  assert.equal(parseNumber("2.4"), 2);
  assert.equal(parseNumber("2.5"), 3);
  assert.equal(parseNumber("2.6"), 3);
});

test("parseNumber: strips thousands comma", () => {
  assert.equal(parseNumber("5,000"), 5000);
  assert.equal(parseNumber("1,234,567"), 1234567);
});

test("parseNumber: approx markers (~ ≈) accepted", () => {
  assert.equal(parseNumber("~10"), 10);
  assert.equal(parseNumber("≈5"), 5);
  assert.equal(parseNumber("~ 15"), 15);
});

test("parseNumber: leading number followed by unit", () => {
  // grabs the leading number, ignores trailing text
  assert.equal(parseNumber("5 kg"), 5);
  assert.equal(parseNumber("200ml bottle"), 200);
});

test("parseNumber: negatives rejected", () => {
  assert.equal(parseNumber("-5"), null);
  assert.equal(parseNumber("-1.5"), null);
});

test("parseNumber: non-numeric returns null", () => {
  assert.equal(parseNumber("abc"), null);
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber(".5"), null); // requires digit before decimal
});

// ── parsePackSize ────────────────────────────────────────────────────────────

test("parsePackSize: individual / each / single → COUNT, 1", () => {
  assert.deepEqual(parsePackSize("individual units", BaseUnit.COUNT), {
    packSizeBase: 1,
    purchaseUnit: MeasurementUnit.COUNT,
  });
  assert.deepEqual(parsePackSize("each", BaseUnit.COUNT), {
    packSizeBase: 1,
    purchaseUnit: MeasurementUnit.COUNT,
  });
  assert.deepEqual(parsePackSize("single", BaseUnit.COUNT), {
    packSizeBase: 1,
    purchaseUnit: MeasurementUnit.COUNT,
  });
});

test("parsePackSize: case of N → CASE, N", () => {
  assert.deepEqual(parsePackSize("case of 12", BaseUnit.COUNT), {
    packSizeBase: 12,
    purchaseUnit: MeasurementUnit.CASE,
  });
  assert.deepEqual(parsePackSize("cases of 24", BaseUnit.COUNT), {
    packSizeBase: 24,
    purchaseUnit: MeasurementUnit.CASE,
  });
});

test("parsePackSize: 1L bottles → 1000ml, BOTTLE", () => {
  assert.deepEqual(parsePackSize("1L bottles", BaseUnit.MILLILITER), {
    packSizeBase: 1000,
    purchaseUnit: MeasurementUnit.BOTTLE,
  });
});

test("parsePackSize: 2 liters → 2000ml, BOTTLE", () => {
  assert.deepEqual(parsePackSize("2 liters", BaseUnit.MILLILITER), {
    packSizeBase: 2000,
    purchaseUnit: MeasurementUnit.BOTTLE,
  });
});

test("parsePackSize: 2 litres (British) → 2000ml, BOTTLE (regression)", () => {
  // BUG FIX: the old regex `l(?:ite?r?)?` accepted "liter/liters" but NOT
  // "litre/litres". British users got the "plain number" fallback — 2 BOX
  // instead of 2000ml. Regex now accepts both spellings.
  assert.deepEqual(parsePackSize("2 litres", BaseUnit.MILLILITER), {
    packSizeBase: 2000,
    purchaseUnit: MeasurementUnit.BOTTLE,
  });
  assert.deepEqual(parsePackSize("1 litre", BaseUnit.MILLILITER), {
    packSizeBase: 1000,
    purchaseUnit: MeasurementUnit.BOTTLE,
  });
});

test("parsePackSize: fractional litres", () => {
  assert.deepEqual(parsePackSize("2.5L", BaseUnit.MILLILITER), {
    packSizeBase: 2500,
    purchaseUnit: MeasurementUnit.BOTTLE,
  });
});

test("parsePackSize: 500ml cans → 500ml, BOTTLE", () => {
  assert.deepEqual(parsePackSize("500ml cans", BaseUnit.MILLILITER), {
    packSizeBase: 500,
    purchaseUnit: MeasurementUnit.BOTTLE,
  });
});

test("parsePackSize: 1kg bags → 1000g, BAG", () => {
  assert.deepEqual(parsePackSize("1kg bags", BaseUnit.GRAM), {
    packSizeBase: 1000,
    purchaseUnit: MeasurementUnit.BAG,
  });
});

test("parsePackSize: 100g sachets → 100g, BAG", () => {
  assert.deepEqual(parsePackSize("100g sachets", BaseUnit.GRAM), {
    packSizeBase: 100,
    purchaseUnit: MeasurementUnit.BAG,
  });
  assert.deepEqual(parsePackSize("250 grams", BaseUnit.GRAM), {
    packSizeBase: 250,
    purchaseUnit: MeasurementUnit.BAG,
  });
});

test("parsePackSize: N bottles / cans / jars → BOTTLE, N", () => {
  assert.deepEqual(parsePackSize("12 bottles", BaseUnit.COUNT), {
    packSizeBase: 12,
    purchaseUnit: MeasurementUnit.BOTTLE,
  });
  assert.deepEqual(parsePackSize("6 cans", BaseUnit.COUNT), {
    packSizeBase: 6,
    purchaseUnit: MeasurementUnit.BOTTLE,
  });
});

test("parsePackSize: N boxes → BOX, N", () => {
  assert.deepEqual(parsePackSize("10 boxes", BaseUnit.COUNT), {
    packSizeBase: 10,
    purchaseUnit: MeasurementUnit.BOX,
  });
});

test("parsePackSize: N cases / crates / trays → CASE, N (regression)", () => {
  // BUG FIX: the count-with-container regex only listed pack|box|bag|bottle|
  // can|jar|sachet, so "12 cases", "5 crates", "3 trays" fell through to the
  // plain-number branch and came back as COUNT — even though bare "case" /
  // "crate" / "tray" already mapped to CASE. Now case/crate/tray are in the
  // container list and map to CASE with the quantity the user typed.
  assert.deepEqual(parsePackSize("12 cases", BaseUnit.COUNT), {
    packSizeBase: 12,
    purchaseUnit: MeasurementUnit.CASE,
  });
  assert.deepEqual(parsePackSize("5 crates", BaseUnit.COUNT), {
    packSizeBase: 5,
    purchaseUnit: MeasurementUnit.CASE,
  });
  assert.deepEqual(parsePackSize("3 trays", BaseUnit.COUNT), {
    packSizeBase: 3,
    purchaseUnit: MeasurementUnit.CASE,
  });
  // singular container word also works with quantity
  assert.deepEqual(parsePackSize("1 case", BaseUnit.COUNT), {
    packSizeBase: 1,
    purchaseUnit: MeasurementUnit.CASE,
  });
});

test("parsePackSize: N cartons → BOX, N (regression)", () => {
  // BUG FIX: "carton" wasn't in the count-with-container regex, so
  // "6 cartons" came back as { 6, COUNT } even though bare "carton"
  // already mapped to BOX. Now cartons map to BOX with the quantity.
  assert.deepEqual(parsePackSize("6 cartons", BaseUnit.COUNT), {
    packSizeBase: 6,
    purchaseUnit: MeasurementUnit.BOX,
  });
  assert.deepEqual(parsePackSize("2 carton", BaseUnit.COUNT), {
    packSizeBase: 2,
    purchaseUnit: MeasurementUnit.BOX,
  });
});

test("parsePackSize: 'case of N' still wins over 'N case' when both patterns present", () => {
  // Regression: caseMatch (/case[s]?\s+of\s+(\d+)/) must fire before the
  // enriched countMatch, so "case of 12" and "cases of 24" still return
  // the N items per case the user described, not 1 case of the trailing
  // digits.
  assert.deepEqual(parsePackSize("case of 12", BaseUnit.COUNT), {
    packSizeBase: 12,
    purchaseUnit: MeasurementUnit.CASE,
  });
  assert.deepEqual(parsePackSize("cases of 24", BaseUnit.COUNT), {
    packSizeBase: 24,
    purchaseUnit: MeasurementUnit.CASE,
  });
});

test("parsePackSize: bare container words (no quantity) → 1 of that unit", () => {
  assert.deepEqual(parsePackSize("bottle", BaseUnit.MILLILITER), {
    packSizeBase: 1,
    purchaseUnit: MeasurementUnit.BOTTLE,
  });
  assert.deepEqual(parsePackSize("bag", BaseUnit.GRAM), {
    packSizeBase: 1,
    purchaseUnit: MeasurementUnit.BAG,
  });
  assert.deepEqual(parsePackSize("carton", BaseUnit.COUNT), {
    packSizeBase: 1,
    purchaseUnit: MeasurementUnit.BOX,
  });
  assert.deepEqual(parsePackSize("crate", BaseUnit.COUNT), {
    packSizeBase: 1,
    purchaseUnit: MeasurementUnit.CASE,
  });
});

test("parsePackSize: plain number falls back to BOX / COUNT by baseUnit", () => {
  assert.deepEqual(parsePackSize("12", BaseUnit.COUNT), {
    packSizeBase: 12,
    purchaseUnit: MeasurementUnit.COUNT,
  });
  assert.deepEqual(parsePackSize("12", BaseUnit.GRAM), {
    packSizeBase: 12,
    purchaseUnit: MeasurementUnit.BOX,
  });
});

test("parsePackSize: completely unparseable → 1 COUNT fallback", () => {
  assert.deepEqual(parsePackSize("qqqq", BaseUnit.COUNT), {
    packSizeBase: 1,
    purchaseUnit: MeasurementUnit.COUNT,
  });
});

// ── parseOrderingMode ────────────────────────────────────────────────────────

test("parseOrderingMode: email keywords → EMAIL", () => {
  assert.equal(parseOrderingMode("email"), SupplierOrderingMode.EMAIL);
  assert.equal(parseOrderingMode("send email"), SupplierOrderingMode.EMAIL);
  assert.equal(parseOrderingMode("by mail"), SupplierOrderingMode.EMAIL);
});

test("parseOrderingMode: website keywords → WEBSITE", () => {
  assert.equal(parseOrderingMode("website"), SupplierOrderingMode.WEBSITE);
  assert.equal(parseOrderingMode("online"), SupplierOrderingMode.WEBSITE);
  assert.equal(parseOrderingMode("portal"), SupplierOrderingMode.WEBSITE);
  assert.equal(parseOrderingMode("supplier url"), SupplierOrderingMode.WEBSITE);
});

test("parseOrderingMode: manual / phone / whatsapp → MANUAL", () => {
  assert.equal(parseOrderingMode("manual"), SupplierOrderingMode.MANUAL);
  assert.equal(parseOrderingMode("phone"), SupplierOrderingMode.MANUAL);
  assert.equal(parseOrderingMode("whatsapp"), SupplierOrderingMode.MANUAL);
  assert.equal(parseOrderingMode("I'll handle it myself"), SupplierOrderingMode.MANUAL);
});

test("parseOrderingMode: unknown → null", () => {
  assert.equal(parseOrderingMode("maybe fax"), null);
  assert.equal(parseOrderingMode(""), null);
});

// ── fuzzyMatchSupplier ───────────────────────────────────────────────────────

const SUPPLIERS = [
  { id: "s1", name: "Acme Coffee Co." },
  { id: "s2", name: "Dairy Direct" },
  { id: "s3", name: "Fresh Produce Ltd" },
];

test("fuzzyMatchSupplier: exact match (case-insensitive)", () => {
  const match = fuzzyMatchSupplier("acme coffee co.", SUPPLIERS);
  assert.equal(match?.id, "s1");
});

test("fuzzyMatchSupplier: substring match on supplier", () => {
  const match = fuzzyMatchSupplier("Dairy Direct of Nowhere", SUPPLIERS);
  assert.equal(match?.id, "s2");
});

test("fuzzyMatchSupplier: substring match on input", () => {
  const match = fuzzyMatchSupplier("acme", SUPPLIERS);
  assert.equal(match?.id, "s1");
});

test("fuzzyMatchSupplier: empty / skip / none / no → null", () => {
  assert.equal(fuzzyMatchSupplier("", SUPPLIERS), null);
  assert.equal(fuzzyMatchSupplier("   ", SUPPLIERS), null);
  assert.equal(fuzzyMatchSupplier("none", SUPPLIERS), null);
  assert.equal(fuzzyMatchSupplier("Skip", SUPPLIERS), null);
  assert.equal(fuzzyMatchSupplier("no", SUPPLIERS), null);
});

test("fuzzyMatchSupplier: no match → null (not crash)", () => {
  assert.equal(fuzzyMatchSupplier("Unknown Supplier", SUPPLIERS), null);
});

test("fuzzyMatchSupplier: empty supplier list", () => {
  assert.equal(fuzzyMatchSupplier("Acme", []), null);
});

// ── matchIngredientsToInventory ──────────────────────────────────────────────

const INVENTORY = [
  { id: "i1", name: "Whole Milk", sku: "WM-01" },
  { id: "i2", name: "Oat Milk", sku: "OM-01" },
  { id: "i3", name: "Banana", sku: "BN-01" },
];

test("matchIngredientsToInventory: matches exact rawName", () => {
  const { matched, unmatched } = matchIngredientsToInventory(
    [{ rawName: "banana", quantity: 2, unit: MeasurementUnit.COUNT }],
    INVENTORY
  );
  assert.equal(matched.length, 1);
  assert.equal(matched[0].inventoryItemId, "i3");
  assert.equal(matched[0].quantityBase, 2);
  assert.deepEqual(unmatched, []);
});

test("matchIngredientsToInventory: matches substring (user text contains inventory name)", () => {
  const { matched } = matchIngredientsToInventory(
    [{ rawName: "organic oat milk", quantity: 250, unit: MeasurementUnit.MILLILITER }],
    INVENTORY
  );
  assert.equal(matched[0]?.inventoryItemId, "i2");
});

test("matchIngredientsToInventory: matches substring (inventory name contains user text)", () => {
  const { matched } = matchIngredientsToInventory(
    [{ rawName: "milk", quantity: 200, unit: MeasurementUnit.MILLILITER }],
    INVENTORY
  );
  // first inventory item whose name contains "milk" wins — "Whole Milk"
  assert.equal(matched[0]?.inventoryItemId, "i1");
});

test("matchIngredientsToInventory: unknown ingredient → unmatched", () => {
  const { matched, unmatched } = matchIngredientsToInventory(
    [{ rawName: "dragonfruit", quantity: 1, unit: MeasurementUnit.COUNT }],
    INVENTORY
  );
  assert.equal(matched.length, 0);
  assert.deepEqual(unmatched, ["dragonfruit"]);
});

test("matchIngredientsToInventory: mixed matched + unmatched", () => {
  const { matched, unmatched } = matchIngredientsToInventory(
    [
      { rawName: "banana", quantity: 3, unit: MeasurementUnit.COUNT },
      { rawName: "unicorn horn", quantity: 1, unit: MeasurementUnit.GRAM },
    ],
    INVENTORY
  );
  assert.equal(matched.length, 1);
  assert.equal(matched[0].inventoryItemId, "i3");
  assert.deepEqual(unmatched, ["unicorn horn"]);
});

// ── generateSku ──────────────────────────────────────────────────────────────

test("generateSku: slugifies name + adds random suffix", () => {
  const sku = generateSku("Whole Milk");
  assert.match(sku, /^whole-milk-[A-Z0-9]{4}$/);
});

test("generateSku: collapses punctuation / non-alnum runs", () => {
  const sku = generateSku("Café au Lait!");
  // "cafe" not guaranteed — accents pass through [^a-z0-9]+ so "caf-au-lait"
  assert.match(sku, /^caf-au-lait-[A-Z0-9]{4}$/);
});

test("generateSku: long names truncated to 20 chars before suffix", () => {
  const sku = generateSku("An extremely long product name that keeps going");
  const parts = sku.split("-");
  const suffix = parts.pop()!;
  const slug = parts.join("-");
  assert.ok(slug.length <= 20, `slug ${slug} longer than 20`);
  assert.match(suffix, /^[A-Z0-9]{4}$/);
});

test("generateSku: suffix is 4 uppercase alphanumerics and is not deterministic", () => {
  const a = generateSku("Test Item");
  const b = generateSku("Test Item");
  // suffix should differ (modulo astronomical collision chance)
  assert.notEqual(a, b);
});

// ── isSkip ───────────────────────────────────────────────────────────────────

test("isSkip: recognized skip tokens", () => {
  for (const v of ["skip", "Skip", "SKIP", "none", "no", "n/a", "N/A", "-"]) {
    assert.equal(isSkip(v), true, `"${v}" should be skip`);
  }
  assert.equal(isSkip("   skip   "), true);
});

test("isSkip: other text → false", () => {
  for (const v of ["nope", "nothing", "skipper", "none of them", ""]) {
    assert.equal(isSkip(v), false, `"${v}" should NOT be skip`);
  }
});

// ── measurementUnitFromBaseUnit ──────────────────────────────────────────────

test("measurementUnitFromBaseUnit: matches enum value", () => {
  assert.equal(measurementUnitFromBaseUnit(BaseUnit.GRAM), MeasurementUnit.GRAM);
  assert.equal(
    measurementUnitFromBaseUnit(BaseUnit.MILLILITER),
    MeasurementUnit.MILLILITER
  );
  assert.equal(measurementUnitFromBaseUnit(BaseUnit.COUNT), MeasurementUnit.COUNT);
});
