import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyPriceVariance,
  classifyQuantityShortfall,
  coerceParsedResponse,
  sanityCheckParse,
  type InvoiceParseResult,
  type InvoicePoLineContext,
} from "./parse";

function poLine(overrides: Partial<InvoicePoLineContext> = {}): InvoicePoLineContext {
  return {
    lineId: "line-1",
    description: "Tomato 6x4L case",
    inventoryItemName: "Tomato",
    quantityOrdered: 3,
    purchaseUnit: "CASE",
    packSizeBase: 24000,
    expectedUnitCostCents: 4500,
    ...overrides,
  };
}

// ── coerceParsedResponse ──────────────────────────────────────────────

test("coerceParsedResponse: parses a well-formed model response", () => {
  const raw = JSON.stringify({
    supplierName: "Sysco Toronto",
    invoiceNumber: "INV-42",
    lines: [
      {
        lineId: "line-1",
        rawDescription: "TOMATO 6X4L",
        quantityPacks: 3,
        unitCostCents: 4500,
        extPriceCents: 13500,
        confidence: "high",
        note: "",
      },
    ],
    totals: { subtotalCents: 13500, taxCents: 1755, totalCents: 15255 },
    summary: "Full delivery",
  });

  const out = coerceParsedResponse(raw, [poLine()]);

  assert.equal(out.ok, true);
  assert.equal(out.supplierName, "Sysco Toronto");
  assert.equal(out.invoiceNumber, "INV-42");
  assert.equal(out.lines.length, 1);
  assert.equal(out.lines[0].lineId, "line-1");
  assert.equal(out.lines[0].quantityPacks, 3);
  assert.equal(out.lines[0].unitCostCents, 4500);
  assert.equal(out.lines[0].extPriceCents, 13500);
  assert.equal(out.lines[0].confidence, "high");
  assert.equal(out.totals?.subtotalCents, 13500);
  assert.equal(out.totals?.taxCents, 1755);
  assert.equal(out.totals?.totalCents, 15255);
});

test("coerceParsedResponse: returns ok:false on JSON parse failure", () => {
  const out = coerceParsedResponse("not-json {{{", [poLine()]);
  assert.equal(out.ok, false);
  assert.match(out.reason ?? "", /JSON parse/i);
  assert.deepEqual(out.lines, []);
});

test("coerceParsedResponse: empty object returns ok:true with no lines", () => {
  const out = coerceParsedResponse("{}", [poLine()]);
  assert.equal(out.ok, true);
  assert.deepEqual(out.lines, []);
  assert.equal(out.supplierName, null);
  assert.equal(out.invoiceNumber, null);
});

test("coerceParsedResponse: drops invented lineIds (not in PO)", () => {
  const raw = JSON.stringify({
    lines: [
      {
        lineId: "hallucinated-999",
        rawDescription: "Phantom item",
        quantityPacks: 1,
        unitCostCents: 100,
        confidence: "low",
      },
    ],
  });
  const out = coerceParsedResponse(raw, [poLine()]);
  assert.equal(out.ok, true);
  assert.equal(out.lines.length, 1);
  // Invented id is normalized to null (rendered as "new item" in UI)
  assert.equal(out.lines[0].lineId, null);
});

test("coerceParsedResponse: preserves null lineId for bonus/unreadable rows", () => {
  const raw = JSON.stringify({
    lines: [
      {
        lineId: null,
        rawDescription: "FREE SAMPLE",
        quantityPacks: 1,
        unitCostCents: 0,
        confidence: "high",
      },
    ],
  });
  const out = coerceParsedResponse(raw, [poLine()]);
  assert.equal(out.lines.length, 1);
  assert.equal(out.lines[0].lineId, null);
});

test("coerceParsedResponse: skips rows with empty or non-string description", () => {
  const raw = JSON.stringify({
    lines: [
      { lineId: "line-1", rawDescription: "", quantityPacks: 1 },
      { lineId: "line-1", rawDescription: 42, quantityPacks: 1 },
      { lineId: "line-1", rawDescription: "Good row", quantityPacks: 1 },
    ],
  });
  const out = coerceParsedResponse(raw, [poLine()]);
  assert.equal(out.lines.length, 1);
  assert.equal(out.lines[0].rawDescription, "Good row");
});

test("coerceParsedResponse: clamps negative numbers to null", () => {
  const raw = JSON.stringify({
    lines: [
      {
        lineId: "line-1",
        rawDescription: "Weird row",
        quantityPacks: -3,
        unitCostCents: -100,
        extPriceCents: -500,
        confidence: "medium",
      },
    ],
  });
  const out = coerceParsedResponse(raw, [poLine()]);
  assert.equal(out.lines[0].quantityPacks, null);
  assert.equal(out.lines[0].unitCostCents, null);
  assert.equal(out.lines[0].extPriceCents, null);
});

test("coerceParsedResponse: rejects NaN and Infinity", () => {
  // Raw NaN/Infinity aren't valid JSON — but string "NaN"/"Infinity" might slip through.
  const raw = JSON.stringify({
    lines: [
      {
        lineId: "line-1",
        rawDescription: "Bad numbers",
        quantityPacks: "NaN",
        unitCostCents: "Infinity",
        extPriceCents: "-Infinity",
        confidence: "low",
      },
    ],
  });
  const out = coerceParsedResponse(raw, [poLine()]);
  assert.equal(out.lines[0].quantityPacks, null);
  assert.equal(out.lines[0].unitCostCents, null);
  assert.equal(out.lines[0].extPriceCents, null);
});

test("coerceParsedResponse: rounds fractional cents to integers", () => {
  const raw = JSON.stringify({
    lines: [
      {
        lineId: "line-1",
        rawDescription: "Rounding",
        quantityPacks: 2.5,
        unitCostCents: 499.6,
        extPriceCents: 1249.0,
        confidence: "high",
      },
    ],
  });
  const out = coerceParsedResponse(raw, [poLine()]);
  assert.equal(out.lines[0].quantityPacks, 2.5); // fractional qty allowed
  assert.equal(out.lines[0].unitCostCents, 500); // rounded
  assert.equal(out.lines[0].extPriceCents, 1249);
});

test("coerceParsedResponse: accepts numeric strings from lax model output", () => {
  // `response_format: json_object` still lets models emit quoted numbers.
  // Before the fix these became null and we silently dropped real data.
  const raw = JSON.stringify({
    lines: [
      {
        lineId: "line-1",
        rawDescription: "Stringy numbers",
        quantityPacks: "3",
        unitCostCents: "1245",
        extPriceCents: "3735",
        confidence: "high",
      },
    ],
    totals: { subtotalCents: "3735", taxCents: "0", totalCents: "3735" },
  });
  const out = coerceParsedResponse(raw, [poLine()]);
  assert.equal(out.lines[0].quantityPacks, 3);
  assert.equal(out.lines[0].unitCostCents, 1245);
  assert.equal(out.lines[0].extPriceCents, 3735);
  assert.equal(out.totals?.subtotalCents, 3735);
});

test("coerceParsedResponse: invalid confidence defaults to low", () => {
  const raw = JSON.stringify({
    lines: [
      {
        lineId: "line-1",
        rawDescription: "Bad conf",
        confidence: "super-sure",
      },
    ],
  });
  const out = coerceParsedResponse(raw, [poLine()]);
  assert.equal(out.lines[0].confidence, "low");
});

test("coerceParsedResponse: truncates over-long text fields", () => {
  const long = "x".repeat(500);
  const raw = JSON.stringify({
    supplierName: long,
    invoiceNumber: long,
    summary: long,
    lines: [
      { lineId: "line-1", rawDescription: long, note: long, confidence: "high" },
    ],
  });
  const out = coerceParsedResponse(raw, [poLine()]);
  assert.equal(out.supplierName?.length, 120);
  assert.equal(out.invoiceNumber?.length, 64);
  assert.equal(out.summary?.length, 400);
  assert.equal(out.lines[0].rawDescription.length, 200);
  assert.equal(out.lines[0].note.length, 200);
});

test("coerceParsedResponse: blank supplierName is normalized to null", () => {
  // Before the fix: "   " was truthy → sanityCheckParse flagged a
  // spurious supplier mismatch.
  const raw = JSON.stringify({
    supplierName: "   ",
    invoiceNumber: "\t",
    lines: [],
  });
  const out = coerceParsedResponse(raw, [poLine()]);
  assert.equal(out.supplierName, null);
  assert.equal(out.invoiceNumber, null);
});

test("coerceParsedResponse: ignores non-array `lines`", () => {
  const raw = JSON.stringify({ lines: "not-an-array" });
  const out = coerceParsedResponse(raw, [poLine()]);
  assert.equal(out.ok, true);
  assert.deepEqual(out.lines, []);
});

test("coerceParsedResponse: ignores garbage entries inside lines array", () => {
  const raw = JSON.stringify({
    lines: [null, "string", 42, { rawDescription: "only real one" }],
  });
  const out = coerceParsedResponse(raw, [poLine()]);
  assert.equal(out.lines.length, 1);
  assert.equal(out.lines[0].rawDescription, "only real one");
});

test("coerceParsedResponse: totals with wrong types become null", () => {
  const raw = JSON.stringify({
    lines: [],
    totals: { subtotalCents: {}, taxCents: [], totalCents: true },
  });
  const out = coerceParsedResponse(raw, [poLine()]);
  assert.equal(out.totals?.subtotalCents, null);
  assert.equal(out.totals?.taxCents, null);
  assert.equal(out.totals?.totalCents, null);
});

test("coerceParsedResponse: totals as an array is ignored", () => {
  const raw = JSON.stringify({ lines: [], totals: [1, 2, 3] });
  const out = coerceParsedResponse(raw, [poLine()]);
  // totals defaults to all-null
  assert.equal(out.totals?.subtotalCents, null);
  assert.equal(out.totals?.taxCents, null);
  assert.equal(out.totals?.totalCents, null);
});

// ── sanityCheckParse ──────────────────────────────────────────────────

function buildResult(overrides: Partial<InvoiceParseResult> = {}): InvoiceParseResult {
  return {
    ok: true,
    lines: [],
    totals: { subtotalCents: null, taxCents: null, totalCents: null },
    supplierName: null,
    invoiceNumber: null,
    ...overrides,
  };
}

test("sanityCheckParse: clean invoice → no flags", () => {
  const result = buildResult({
    supplierName: "Sysco Toronto",
    lines: [
      {
        lineId: "line-1",
        rawDescription: "Tomato",
        quantityPacks: 3,
        unitCostCents: 4500,
        extPriceCents: 13500,
        confidence: "high",
        note: "",
      },
    ],
    totals: { subtotalCents: 13500, taxCents: null, totalCents: null },
  });
  const flags = sanityCheckParse(result, {
    supplierName: "Sysco",
    lines: [poLine()],
  });
  assert.deepEqual(flags, []);
});

test("sanityCheckParse: flags line math mismatch when qty*unit != extPrice", () => {
  const result = buildResult({
    lines: [
      {
        lineId: "line-1",
        rawDescription: "Tomato",
        quantityPacks: 3,
        unitCostCents: 4500, // expected 13500
        extPriceCents: 18000, // printed 18000 — 33% off
        confidence: "high",
        note: "",
      },
    ],
  });
  const flags = sanityCheckParse(result, {
    supplierName: "Sysco",
    lines: [poLine()],
  });
  const mismatch = flags.find((f) => f.kind === "line_math_mismatch");
  assert.ok(mismatch, "expected a line_math_mismatch flag");
  assert.equal(mismatch!.lineIndex, 0);
  assert.equal(mismatch!.delta, 4500);
});

test("sanityCheckParse: tolerates sub-5% rounding on line math", () => {
  // $4.99/lb × 2.5 lb = $12.475; printed as $12.48.
  const result = buildResult({
    lines: [
      {
        lineId: "line-1",
        rawDescription: "Beef",
        quantityPacks: 2.5,
        unitCostCents: 499,
        extPriceCents: 1248,
        confidence: "high",
        note: "",
      },
    ],
  });
  const flags = sanityCheckParse(result, {
    supplierName: "Sysco",
    lines: [poLine()],
  });
  assert.equal(
    flags.filter((f) => f.kind === "line_math_mismatch").length,
    0
  );
});

test("sanityCheckParse: flags subtotal mismatch", () => {
  const result = buildResult({
    lines: [
      {
        lineId: "line-1",
        rawDescription: "Tomato",
        quantityPacks: 3,
        unitCostCents: 4500,
        extPriceCents: 13500,
        confidence: "high",
        note: "",
      },
    ],
    totals: { subtotalCents: 20000, taxCents: null, totalCents: null },
  });
  const flags = sanityCheckParse(result, {
    supplierName: "Sysco",
    lines: [poLine()],
  });
  const subFlag = flags.find((f) => f.kind === "subtotal_mismatch");
  assert.ok(subFlag);
  assert.equal(subFlag!.reportedCents, 20000);
  assert.equal(subFlag!.sumCents, 13500);
});

test("sanityCheckParse: subtotal check tolerates <5% drift", () => {
  const result = buildResult({
    lines: [
      {
        lineId: "line-1",
        rawDescription: "Tomato",
        quantityPacks: 3,
        unitCostCents: 4500,
        extPriceCents: 13500,
        confidence: "high",
        note: "",
      },
    ],
    totals: { subtotalCents: 13800, taxCents: null, totalCents: null },
  });
  const flags = sanityCheckParse(result, {
    supplierName: "Sysco",
    lines: [poLine()],
  });
  assert.equal(
    flags.filter((f) => f.kind === "subtotal_mismatch").length,
    0
  );
});

test("sanityCheckParse: subtotal math falls back to qty*unit when extPrice missing", () => {
  const result = buildResult({
    lines: [
      {
        lineId: "line-1",
        rawDescription: "Tomato",
        quantityPacks: 3,
        unitCostCents: 4500,
        extPriceCents: null,
        confidence: "high",
        note: "",
      },
    ],
    totals: { subtotalCents: 13500, taxCents: null, totalCents: null },
  });
  const flags = sanityCheckParse(result, {
    supplierName: "Sysco",
    lines: [poLine()],
  });
  assert.equal(
    flags.filter((f) => f.kind === "subtotal_mismatch").length,
    0
  );
});

test("sanityCheckParse: flags supplier-name mismatch when nothing overlaps", () => {
  const result = buildResult({ supplierName: "Gordon Food Service" });
  const flags = sanityCheckParse(result, {
    supplierName: "Sysco Toronto",
    lines: [poLine()],
  });
  const mismatch = flags.find((f) => f.kind === "supplier_name_mismatch");
  assert.ok(mismatch);
  assert.equal(mismatch!.invoiceName, "Gordon Food Service");
  assert.equal(mismatch!.expectedName, "Sysco Toronto");
});

test("sanityCheckParse: supplier name match on any shared ≥3-char token", () => {
  // "Sysco Toronto" (invoice) vs "Sysco Foodservice Inc." (PO)
  const result = buildResult({ supplierName: "Sysco Toronto" });
  const flags = sanityCheckParse(result, {
    supplierName: "Sysco Foodservice Inc.",
    lines: [poLine()],
  });
  assert.equal(
    flags.filter((f) => f.kind === "supplier_name_mismatch").length,
    0
  );
});

test("sanityCheckParse: supplier name match ignores generic corp tokens", () => {
  // Both names share only "inc" and "co" — should NOT count as a match.
  const result = buildResult({ supplierName: "Alpha Co Inc" });
  const flags = sanityCheckParse(result, {
    supplierName: "Beta Co Inc",
    lines: [poLine()],
  });
  assert.equal(
    flags.filter((f) => f.kind === "supplier_name_mismatch").length,
    1
  );
});

test("sanityCheckParse: no supplier name → no supplier flag", () => {
  const result = buildResult({ supplierName: null });
  const flags = sanityCheckParse(result, {
    supplierName: "Sysco",
    lines: [poLine()],
  });
  assert.equal(
    flags.filter((f) => f.kind === "supplier_name_mismatch").length,
    0
  );
});

test("sanityCheckParse: flags quantity outlier (>10× ordered)", () => {
  const result = buildResult({
    lines: [
      {
        lineId: "line-1",
        rawDescription: "Tomato",
        quantityPacks: 33, // ordered 3 → 33 typo
        unitCostCents: 4500,
        extPriceCents: null,
        confidence: "medium",
        note: "",
      },
    ],
  });
  const flags = sanityCheckParse(result, {
    supplierName: "Sysco",
    lines: [poLine({ quantityOrdered: 3 })],
  });
  const outlier = flags.find((f) => f.kind === "quantity_outlier");
  assert.ok(outlier);
  assert.equal(outlier!.ordered, 3);
  assert.equal(outlier!.reported, 33);
});

test("sanityCheckParse: 2-3× overshipment does NOT flag outlier", () => {
  // Supplier cross-docks happen; 2-3× is allowed without warning.
  const result = buildResult({
    lines: [
      {
        lineId: "line-1",
        rawDescription: "Tomato",
        quantityPacks: 9,
        unitCostCents: 4500,
        extPriceCents: null,
        confidence: "medium",
        note: "",
      },
    ],
  });
  const flags = sanityCheckParse(result, {
    supplierName: "Sysco",
    lines: [poLine({ quantityOrdered: 3 })],
  });
  assert.equal(
    flags.filter((f) => f.kind === "quantity_outlier").length,
    0
  );
});

test("sanityCheckParse: unmatched (null lineId) rows skip the outlier check", () => {
  const result = buildResult({
    lines: [
      {
        lineId: null,
        rawDescription: "Bonus item",
        quantityPacks: 500, // huge but no PO line to compare against
        unitCostCents: 100,
        extPriceCents: null,
        confidence: "high",
        note: "",
      },
    ],
  });
  const flags = sanityCheckParse(result, {
    supplierName: "Sysco",
    lines: [poLine({ quantityOrdered: 1 })],
  });
  assert.equal(
    flags.filter((f) => f.kind === "quantity_outlier").length,
    0
  );
});

// ── classifyPriceVariance ─────────────────────────────────────────────

test("classifyPriceVariance: equal prices → none", () => {
  const out = classifyPriceVariance(1000, 1000);
  assert.equal(out.severity, "none");
  assert.equal(out.deltaPct, 0);
  assert.equal(out.deltaCents, 0);
});

test("classifyPriceVariance: +5% → watch", () => {
  const out = classifyPriceVariance(1000, 1050);
  assert.equal(out.severity, "watch");
});

test("classifyPriceVariance: -5% → watch (symmetric)", () => {
  const out = classifyPriceVariance(1000, 950);
  assert.equal(out.severity, "watch");
});

test("classifyPriceVariance: +15% → review", () => {
  const out = classifyPriceVariance(1000, 1150);
  assert.equal(out.severity, "review");
});

test("classifyPriceVariance: just under watch threshold (4.99%) → none", () => {
  const out = classifyPriceVariance(1000, 1049);
  assert.equal(out.severity, "none");
});

test("classifyPriceVariance: null inputs → none / null deltas", () => {
  const a = classifyPriceVariance(null, 1000);
  const b = classifyPriceVariance(1000, null);
  const c = classifyPriceVariance(undefined, undefined);
  for (const out of [a, b, c]) {
    assert.equal(out.severity, "none");
    assert.equal(out.deltaPct, null);
    assert.equal(out.deltaCents, null);
  }
});

test("classifyPriceVariance: zero/negative expected → none (can't ratio)", () => {
  assert.equal(classifyPriceVariance(0, 500).severity, "none");
  assert.equal(classifyPriceVariance(-100, 500).severity, "none");
});

// ── classifyQuantityShortfall ────────────────────────────────────────

test("classifyQuantityShortfall: full delivery → none", () => {
  assert.equal(classifyQuantityShortfall(10, 10), "none");
});

test("classifyQuantityShortfall: overage → none (not a shortfall)", () => {
  assert.equal(classifyQuantityShortfall(10, 12), "none");
});

test("classifyQuantityShortfall: 5% short → watch", () => {
  assert.equal(classifyQuantityShortfall(20, 19), "watch");
});

test("classifyQuantityShortfall: 20% short → review", () => {
  assert.equal(classifyQuantityShortfall(10, 8), "review");
});

test("classifyQuantityShortfall: 4% short (under 5% threshold) → none", () => {
  assert.equal(classifyQuantityShortfall(100, 96), "none");
});

test("classifyQuantityShortfall: null received → none", () => {
  assert.equal(classifyQuantityShortfall(10, null), "none");
  assert.equal(classifyQuantityShortfall(10, undefined), "none");
});

test("classifyQuantityShortfall: zero ordered → none (guards div-by-zero)", () => {
  assert.equal(classifyQuantityShortfall(0, 5), "none");
  assert.equal(classifyQuantityShortfall(-1, 0), "none");
});
