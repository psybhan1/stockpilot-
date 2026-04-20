import test from "node:test";
import assert from "node:assert/strict";

import { buildWebsiteOrderPlaywrightTemplate } from "./playwright-template";

const BASE = {
  supplierName: "Acme Foods",
  website: "https://acme.example.com",
  orderNumber: "PO-1001",
  lines: [
    { description: "Whole milk 4L", quantity: 6, unit: "carton" },
  ],
};

// ── Identity / shape ──────────────────────────────────────────────────────

test("returns a string starting with the chromium import", () => {
  const out = buildWebsiteOrderPlaywrightTemplate(BASE);
  assert.equal(typeof out, "string");
  assert.ok(out.startsWith(`import { chromium } from "@playwright/test";`));
});

test("output is non-empty and ends with the void main() invocation", () => {
  const out = buildWebsiteOrderPlaywrightTemplate(BASE);
  assert.ok(out.length > 0);
  assert.ok(out.trimEnd().endsWith("void main();"));
});

// ── Supplier name + order number embedding ────────────────────────────────

test("supplier name is JSON-quoted in the order object", () => {
  const out = buildWebsiteOrderPlaywrightTemplate(BASE);
  assert.match(out, /supplierName: "Acme Foods"/);
});

test("order number is JSON-quoted in the order object", () => {
  const out = buildWebsiteOrderPlaywrightTemplate(BASE);
  assert.match(out, /orderNumber: "PO-1001"/);
});

test("supplier name with embedded double-quote is properly escaped (no syntax break)", () => {
  const out = buildWebsiteOrderPlaywrightTemplate({
    ...BASE,
    supplierName: `O'Brien's "Best" Market`,
  });
  // The name must appear with escaped quotes — never a raw " inside the JS string.
  assert.match(out, /supplierName: "O'Brien's \\"Best\\" Market"/);
});

test("order number with backslash is escaped (Windows path leakage scenario)", () => {
  const out = buildWebsiteOrderPlaywrightTemplate({
    ...BASE,
    orderNumber: "PO\\1001",
  });
  // Backslash → JSON escape \\
  assert.match(out, /orderNumber: "PO\\\\1001"/);
});

test("supplier name with newline is escaped (\\n, not literal newline)", () => {
  const out = buildWebsiteOrderPlaywrightTemplate({
    ...BASE,
    supplierName: "Line A\nLine B",
  });
  assert.match(out, /supplierName: "Line A\\nLine B"/);
  // Make sure the literal newline did NOT slip through into the order block.
  const orderBlock = out.split("async function main")[0];
  assert.ok(!/Line A\n\s*Line B/.test(orderBlock));
});

// ── Website fallback ──────────────────────────────────────────────────────

test("uses provided website verbatim when set", () => {
  const out = buildWebsiteOrderPlaywrightTemplate({
    ...BASE,
    website: "https://orders.acme.io/login",
  });
  assert.match(out, /website: "https:\/\/orders\.acme\.io\/login"/);
});

test("falls back to placeholder website when null", () => {
  const out = buildWebsiteOrderPlaywrightTemplate({ ...BASE, website: null });
  assert.match(out, /website: "https:\/\/supplier-portal\.example\.com"/);
});

test("falls back to placeholder website when undefined", () => {
  const { website: _drop, ...rest } = BASE;
  void _drop;
  const out = buildWebsiteOrderPlaywrightTemplate(rest);
  assert.match(out, /website: "https:\/\/supplier-portal\.example\.com"/);
});

test("empty-string website is preserved as empty (caller passed it explicitly — don't second-guess)", () => {
  // ?? only kicks in for null/undefined, not "". Lock the behaviour so we
  // notice if someone changes the operator silently.
  const out = buildWebsiteOrderPlaywrightTemplate({ ...BASE, website: "" });
  assert.match(out, /website: ""/);
});

// ── Lines rendering ───────────────────────────────────────────────────────

test("renders a single line with description quoted, quantity numeric, unit quoted", () => {
  const out = buildWebsiteOrderPlaywrightTemplate(BASE);
  // quantity must be a bare number — NOT "6"
  assert.match(
    out,
    /\{ description: "Whole milk 4L", quantity: 6, unit: "carton" \}/
  );
});

test("renders multiple lines comma-separated, each on its own line", () => {
  const out = buildWebsiteOrderPlaywrightTemplate({
    ...BASE,
    lines: [
      { description: "Milk", quantity: 6, unit: "carton" },
      { description: "Eggs", quantity: 12, unit: "dozen" },
      { description: "Coffee", quantity: 2, unit: "kg" },
    ],
  });
  assert.match(out, /description: "Milk"/);
  assert.match(out, /description: "Eggs"/);
  assert.match(out, /description: "Coffee"/);
  // 3 lines → exactly 2 commas joining them in the lines block
  const linesBlock = out.match(/lines: \[\n([\s\S]*?)\n  \],/);
  assert.ok(linesBlock, "lines block should be present");
  const inner = linesBlock![1];
  assert.equal((inner.match(/^  \{/gm) ?? []).length, 3);
  // Trailing comma is NOT added on the last line (would still parse, but lock current behaviour).
  assert.ok(!inner.trimEnd().endsWith(","));
});

test("renders zero lines as an empty array", () => {
  const out = buildWebsiteOrderPlaywrightTemplate({ ...BASE, lines: [] });
  // The lines block collapses but the brackets are still present.
  assert.match(out, /lines: \[\n\n  \],/);
});

test("description with double-quotes is escaped (no syntax break)", () => {
  const out = buildWebsiteOrderPlaywrightTemplate({
    ...BASE,
    lines: [{ description: `12oz "Tall" cup`, quantity: 100, unit: "case" }],
  });
  assert.match(out, /description: "12oz \\"Tall\\" cup"/);
});

test("unit with backslash is escaped", () => {
  const out = buildWebsiteOrderPlaywrightTemplate({
    ...BASE,
    lines: [{ description: "Filter", quantity: 1, unit: "pack\\bundle" }],
  });
  assert.match(out, /unit: "pack\\\\bundle"/);
});

test("quantity zero is rendered as 0 (not omitted, not coerced to falsy default)", () => {
  const out = buildWebsiteOrderPlaywrightTemplate({
    ...BASE,
    lines: [{ description: "Sample", quantity: 0, unit: "ea" }],
  });
  assert.match(out, /quantity: 0/);
});

test("negative quantity is preserved (caller's responsibility, not ours to clamp)", () => {
  const out = buildWebsiteOrderPlaywrightTemplate({
    ...BASE,
    lines: [{ description: "Return", quantity: -3, unit: "ea" }],
  });
  assert.match(out, /quantity: -3/);
});

test("decimal quantity is preserved (not floored)", () => {
  const out = buildWebsiteOrderPlaywrightTemplate({
    ...BASE,
    lines: [{ description: "Beef", quantity: 2.5, unit: "kg" }],
  });
  assert.match(out, /quantity: 2\.5/);
});

// ── Safety affordances (the whole reason this template exists) ────────────

test("includes a screenshot step for human review", () => {
  const out = buildWebsiteOrderPlaywrightTemplate(BASE);
  assert.match(out, /page\.screenshot\(/);
});

test("screenshot filename is templated with the order number", () => {
  const out = buildWebsiteOrderPlaywrightTemplate({
    ...BASE,
    orderNumber: "PO-9999",
  });
  // The literal template string contains ${order.orderNumber}, so we
  // can't search for "PO-9999" in the file — we check the template
  // expression made it through unevaluated.
  assert.match(out, /stockpilot-\$\{order\.orderNumber\}-review\.png/);
});

test("login fields are commented out (TODO — operator must wire real selectors)", () => {
  const out = buildWebsiteOrderPlaywrightTemplate(BASE);
  // The Email/Password fills must be commented, never live.
  assert.match(out, /\/\/ await page\.getByLabel\("Email"\)\.fill/);
  assert.match(out, /\/\/ await page\.getByLabel\("Password"\)\.fill/);
});

test("never auto-submits — the place-order click is commented out", () => {
  // This is the load-bearing safety guarantee. If someone uncomments
  // this in the template, every generated script would auto-submit
  // POs without human review. The test must scream.
  const out = buildWebsiteOrderPlaywrightTemplate(BASE);
  assert.match(
    out,
    /\/\/ await page\.getByRole\("button", \{ name: \/place order\|submit order\|checkout\/i \}\)\.click\(\);/
  );
  assert.match(out, /Never auto-submit in v1\./);
});

test("uses headless: false so the operator can watch the run live", () => {
  const out = buildWebsiteOrderPlaywrightTemplate(BASE);
  assert.match(out, /chromium\.launch\(\{ headless: false \}\)/);
});

test("waits for networkidle before interacting with the page", () => {
  const out = buildWebsiteOrderPlaywrightTemplate(BASE);
  assert.match(out, /waitForLoadState\("networkidle"\)/);
});

test("loops over the lines array at runtime (not inlined into the loop body)", () => {
  const out = buildWebsiteOrderPlaywrightTemplate(BASE);
  assert.match(out, /for \(const line of order\.lines\)/);
});

// ── Determinism ────────────────────────────────────────────────────────────

test("produces the exact same output for the exact same input (no Date.now / random)", () => {
  const a = buildWebsiteOrderPlaywrightTemplate(BASE);
  const b = buildWebsiteOrderPlaywrightTemplate(BASE);
  assert.equal(a, b);
});

test("is a pure function — does not mutate the input lines array", () => {
  const lines = [
    { description: "Milk", quantity: 6, unit: "carton" },
    { description: "Eggs", quantity: 12, unit: "dozen" },
  ];
  const before = JSON.parse(JSON.stringify(lines));
  buildWebsiteOrderPlaywrightTemplate({ ...BASE, lines });
  assert.deepEqual(lines, before);
});
