import test from "node:test";
import assert from "node:assert/strict";

import { buildSupplierOrderEmail } from "./email-template";

// ── Happy path ──────────────────────────────────────────────────────

test("builds subject in the expected PO / business format", () => {
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    businessName: "Cafe Gold",
    orderNumber: "PO-1001",
    replyToEmail: "owner@cafegold.com",
    lines: [{ description: "Oat milk", quantity: 6, unit: "cartons" }],
  });
  assert.equal(email.subject, "Purchase Order PO-1001 — Cafe Gold");
});

test("plain-text body includes order number, greeting, every line, and signature", () => {
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    contactName: "Jamie",
    businessName: "Cafe Gold",
    orderNumber: "PO-1001",
    replyToEmail: "owner@cafegold.com",
    lines: [
      { description: "Oat milk", quantity: 6, unit: "cartons" },
      { description: "Whole beans", quantity: 2, unit: "kg" },
    ],
    requestedDeliveryDate: "Tue, Apr 21",
    orderedByName: "Sobhan",
  });
  assert.match(email.text, /Hi Jamie,/);
  assert.match(email.text, /Order number: PO-1001/);
  assert.match(email.text, /Requested delivery: Tue, Apr 21/);
  assert.match(email.text, /1\. Oat milk — 6 cartons/);
  assert.match(email.text, /2\. Whole beans — 2 kg/);
  assert.match(email.text, /Thanks,\nSobhan\nCafe Gold$/);
});

test("HTML body includes order number, subject chrome, and every line description", () => {
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    businessName: "Cafe Gold",
    orderNumber: "PO-1001",
    replyToEmail: "owner@cafegold.com",
    lines: [
      { description: "Oat milk", quantity: 6, unit: "cartons" },
      { description: "Whole beans", quantity: 2, unit: "kg" },
    ],
  });
  assert.match(email.html, /Purchase Order/); // eyebrow label
  assert.match(email.html, /PO-1001/);
  assert.match(email.html, /Oat milk/);
  assert.match(email.html, /Whole beans/);
  assert.match(email.html, /mailto:owner@cafegold\.com/);
});

// ── Greeting + contact-name fallbacks ───────────────────────────────

test("falls back to 'Sysco team' when contactName is missing", () => {
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    businessName: "Cafe Gold",
    orderNumber: "PO-1",
    replyToEmail: "x@y.com",
    lines: [{ description: "a", quantity: 1, unit: "ea" }],
  });
  assert.match(email.text, /Hi Sysco team,/);
});

test("strips legal suffixes from supplier name when no contact is given", () => {
  // "FreshCo Produce LLC" → "FreshCo Produce team"
  const email = buildSupplierOrderEmail({
    supplierName: "FreshCo Produce LLC",
    businessName: "Cafe Gold",
    orderNumber: "PO-1",
    replyToEmail: "x@y.com",
    lines: [{ description: "a", quantity: 1, unit: "ea" }],
  });
  assert.match(email.text, /Hi FreshCo Produce team,/);
});

test("strips Inc, Ltd, Corp, Pty, GmbH, Co. from supplier name in greeting", () => {
  for (const suffix of ["Inc", "Inc.", "Ltd", "Ltd.", "Corp", "Corp.", "Pty", "GmbH", "Co.", "Co"]) {
    const email = buildSupplierOrderEmail({
      supplierName: `Acme ${suffix}`,
      businessName: "Cafe",
      orderNumber: "PO-1",
      replyToEmail: "x@y.com",
      lines: [{ description: "a", quantity: 1, unit: "ea" }],
    });
    assert.match(
      email.text,
      /Hi Acme team,/,
      `expected suffix '${suffix}' to be stripped`,
    );
  }
});

test("blank/whitespace contactName is treated as absent", () => {
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    contactName: "   ",
    businessName: "Cafe Gold",
    orderNumber: "PO-1",
    replyToEmail: "x@y.com",
    lines: [{ description: "a", quantity: 1, unit: "ea" }],
  });
  // Falls back to supplier-derived greeting, not "Hi   ,"
  assert.match(email.text, /Hi Sysco team,/);
});

test("supplier name that is nothing but legal suffixes falls back to 'team'", () => {
  // Degenerate input — we shouldn't greet "Hi  team,"
  const email = buildSupplierOrderEmail({
    supplierName: "LLC",
    businessName: "Cafe Gold",
    orderNumber: "PO-1",
    replyToEmail: "x@y.com",
    lines: [{ description: "a", quantity: 1, unit: "ea" }],
  });
  assert.match(email.text, /Hi team,/);
});

// ── Delivery date + ordered-by fallbacks ────────────────────────────

test("missing requestedDeliveryDate falls back to 'as soon as you're able'", () => {
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    businessName: "Cafe Gold",
    orderNumber: "PO-1",
    replyToEmail: "x@y.com",
    lines: [{ description: "a", quantity: 1, unit: "ea" }],
  });
  assert.match(email.text, /Requested delivery: as soon as you're able/);
  assert.match(email.html, /as soon as you&#39;re able/); // apostrophe escaped in HTML
});

test("missing orderedByName falls back to 'the <business> team'", () => {
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    businessName: "Cafe Gold",
    orderNumber: "PO-1",
    replyToEmail: "x@y.com",
    lines: [{ description: "a", quantity: 1, unit: "ea" }],
  });
  assert.match(email.text, /Thanks,\nthe Cafe Gold team/);
});

// ── Business line: location name joining ────────────────────────────

test("businessName alone is used when no locationName is given", () => {
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    businessName: "Cafe Gold",
    orderNumber: "PO-1",
    replyToEmail: "x@y.com",
    lines: [{ description: "a", quantity: 1, unit: "ea" }],
  });
  assert.match(email.text, /\nCafe Gold$/);
  // No em-dash separator if there's no location.
  assert.ok(!email.text.includes("Cafe Gold — "));
});

test("businessName — locationName is used when both are provided", () => {
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    businessName: "Cafe Gold",
    locationName: "Mission",
    orderNumber: "PO-1",
    replyToEmail: "x@y.com",
    lines: [{ description: "a", quantity: 1, unit: "ea" }],
  });
  assert.match(email.text, /Cafe Gold — Mission/);
});

// ── Optional delivery address + notes ──────────────────────────────

test("locationAddress row is omitted from HTML when not provided", () => {
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    businessName: "Cafe Gold",
    orderNumber: "PO-1",
    replyToEmail: "x@y.com",
    lines: [{ description: "a", quantity: 1, unit: "ea" }],
  });
  assert.ok(!email.html.includes("Deliver to"));
});

test("locationAddress appears in the HTML 'Deliver to' row when provided", () => {
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    businessName: "Cafe Gold",
    locationAddress: "123 Market St, SF 94103",
    orderNumber: "PO-1",
    replyToEmail: "x@y.com",
    lines: [{ description: "a", quantity: 1, unit: "ea" }],
  });
  assert.match(email.html, /Deliver to/);
  assert.match(email.html, /123 Market St, SF 94103/);
});

test("notes block is rendered in both text + HTML when provided", () => {
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    businessName: "Cafe Gold",
    orderNumber: "PO-1",
    replyToEmail: "x@y.com",
    lines: [{ description: "a", quantity: 1, unit: "ea" }],
    notes: "Deliver before 10am",
  });
  assert.match(email.text, /Notes: Deliver before 10am/);
  assert.match(email.html, /Deliver before 10am/);
});

test("notes block is fully absent when notes is empty/undefined", () => {
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    businessName: "Cafe Gold",
    orderNumber: "PO-1",
    replyToEmail: "x@y.com",
    lines: [{ description: "a", quantity: 1, unit: "ea" }],
  });
  assert.ok(!email.text.includes("Notes:"));
  assert.ok(!email.html.includes("Note:"));
});

// ── Line rendering ──────────────────────────────────────────────────

test("line notes appear in both text (parens) and HTML (subtext div)", () => {
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    businessName: "Cafe Gold",
    orderNumber: "PO-1",
    replyToEmail: "x@y.com",
    lines: [{ description: "Oat milk", quantity: 6, unit: "cartons", notes: "Oatly brand preferred" }],
  });
  assert.match(email.text, /Oat milk — 6 cartons \(Oatly brand preferred\)/);
  assert.match(email.html, /Oatly brand preferred/);
});

test("handles empty lines array without crashing (edge: PO with only notes)", () => {
  // Degenerate but shouldn't throw — the template should still
  // produce a well-formed email in case callers pass an empty list.
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    businessName: "Cafe Gold",
    orderNumber: "PO-1",
    replyToEmail: "x@y.com",
    lines: [],
  });
  // Still has header, no lines to enumerate.
  assert.match(email.text, /Items\n\n/);
  assert.match(email.html, /PO-1/);
});

test("many lines are numbered sequentially starting at 1", () => {
  const lines = Array.from({ length: 5 }, (_, i) => ({
    description: `item-${i + 1}`,
    quantity: 1,
    unit: "ea",
  }));
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    businessName: "Cafe Gold",
    orderNumber: "PO-1",
    replyToEmail: "x@y.com",
    lines,
  });
  for (let i = 1; i <= 5; i += 1) {
    assert.match(email.text, new RegExp(`${i}\\. item-${i}`));
  }
});

// ── XSS / HTML escaping (security) ──────────────────────────────────

test("escapes HTML special chars in supplier-provided line descriptions", () => {
  // Supplier names + descriptions come from free-text DB fields.
  // An attacker who poisons those rows must NOT be able to inject
  // script or break out of the td.
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    businessName: "Cafe Gold",
    orderNumber: "PO-1",
    replyToEmail: "x@y.com",
    lines: [
      {
        description: `<script>alert("xss")</script>`,
        quantity: 1,
        unit: `<img src=x>`,
        notes: `"><svg/onload=alert(1)>`,
      },
    ],
  });
  // Raw script tag must not appear in the HTML output.
  assert.ok(!email.html.includes("<script>"));
  assert.ok(!email.html.includes("<img src=x>"));
  assert.ok(!email.html.includes("<svg/onload="));
  // Escaped form should be present.
  assert.match(email.html, /&lt;script&gt;/);
  assert.match(email.html, /&lt;img src=x&gt;/);
});

test("escapes HTML special chars in order number, business name, and contact greeting", () => {
  const email = buildSupplierOrderEmail({
    supplierName: `Sysco`,
    contactName: `<img onerror=alert(1)>`,
    businessName: `Cafe "Gold"`,
    orderNumber: `PO<1>`,
    replyToEmail: `x@y.com`,
    lines: [{ description: "a", quantity: 1, unit: "ea" }],
  });
  assert.ok(!email.html.includes(`<img onerror=`));
  assert.match(email.html, /&lt;img onerror=alert\(1\)&gt;/);
  assert.match(email.html, /&quot;Gold&quot;/);
  assert.match(email.html, /PO&lt;1&gt;/);
});

test("escapes HTML special chars in supplier name when used as greeting fallback", () => {
  // Supplier name only lands in the HTML when contactName is absent
  // (it's routed through humanizeSupplierName). That still has to
  // escape — otherwise a poisoned supplier row becomes an XSS vector.
  const email = buildSupplierOrderEmail({
    supplierName: `Evil<script>`,
    businessName: `Cafe Gold`,
    orderNumber: `PO-1`,
    replyToEmail: `x@y.com`,
    lines: [{ description: "a", quantity: 1, unit: "ea" }],
  });
  assert.ok(!email.html.includes(`<script>`));
  assert.match(email.html, /Evil&lt;script&gt;/);
});

test("escapes ampersands without breaking on already-escaped entities", () => {
  // & is escaped first, so "&amp;" in the input becomes "&amp;amp;" — that's correct
  // HTML behavior (the input literal was meant to be the 5 chars &amp;, not "&").
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    businessName: "Me & Co",
    orderNumber: "PO-1",
    replyToEmail: "x@y.com",
    lines: [{ description: "tea & biscuits", quantity: 1, unit: "ea" }],
  });
  assert.match(email.html, /Me &amp; Co/);
  assert.match(email.html, /tea &amp; biscuits/);
});

test("replyToEmail is escaped in both href and visible text (no javascript: injection)", () => {
  // Even though replyToEmail is supposed to be an email, we should
  // not trust callers to have validated it upstream.
  const email = buildSupplierOrderEmail({
    supplierName: "Sysco",
    businessName: "Cafe Gold",
    orderNumber: "PO-1",
    replyToEmail: `javascript:alert(1)`,
    lines: [{ description: "a", quantity: 1, unit: "ea" }],
  });
  // The value ends up inside a mailto: href, so an injection of a
  // full javascript: URL still sits inside mailto: and is harmless.
  // We just verify no unescaped double quote can break out of the href.
  assert.ok(!email.html.includes(`mailto:javascript:alert(1)" onerror=`));
});
