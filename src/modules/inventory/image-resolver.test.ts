import test from "node:test";
import assert from "node:assert/strict";

import { buildInventoryImageUrl } from "./image-resolver";

// ── Direct image URL passthrough ──────────────────────────────────

test("direct .jpg URL is returned verbatim", () => {
  const url = "https://images.example.com/product-12345.jpg";
  assert.equal(
    buildInventoryImageUrl({ name: "X", productUrl: url }),
    url,
  );
});

test("direct .jpeg/.png/.webp/.gif/.avif/.svg URLs all pass through", () => {
  for (const ext of ["jpeg", "png", "webp", "gif", "avif", "svg"]) {
    const url = `https://cdn.example.com/p.${ext}`;
    assert.equal(
      buildInventoryImageUrl({ name: "Item", productUrl: url }),
      url,
      `extension .${ext} should pass through`,
    );
  }
});

test("direct image URL is case-insensitive on extension (.JPG, .PNG)", () => {
  const url = "https://cdn.example.com/P.JPG";
  assert.equal(
    buildInventoryImageUrl({ name: "Item", productUrl: url }),
    url,
  );
});

test("image URL with ?query or #fragment after extension still recognised", () => {
  const q = "https://cdn.example.com/p.jpg?v=2";
  const h = "https://cdn.example.com/p.jpg#anchor";
  assert.equal(buildInventoryImageUrl({ name: "X", productUrl: q }), q);
  assert.equal(buildInventoryImageUrl({ name: "X", productUrl: h }), h);
});

test("product-page URLs (no image extension) do NOT pass through as direct images", () => {
  // /dp/B000... is a product PAGE, not an image. The sync builder
  // should NOT return it — it should fall through to Clearbit /
  // letter avatar. The async resolveProductImage() is what fetches
  // og:image for product pages.
  const result = buildInventoryImageUrl({
    name: "Thing",
    productUrl: "https://www.amazon.com/dp/B000000001",
  });
  assert.notEqual(result, "https://www.amazon.com/dp/B000000001");
});

// ── Clearbit logo fallback ────────────────────────────────────────

test("supplier website → Clearbit logo URL when no productUrl", () => {
  const result = buildInventoryImageUrl({
    name: "Coffee",
    supplierWebsite: "https://shop.sysco.com",
  });
  assert.match(result, /^https:\/\/logo\.clearbit\.com\/shop\.sysco\.com\?size=256$/);
});

test("Clearbit URL strips 'www.' from hostname (logos keyed on bare domain)", () => {
  const result = buildInventoryImageUrl({
    name: "X",
    supplierWebsite: "https://www.costco.com",
  });
  assert.match(result, /^https:\/\/logo\.clearbit\.com\/costco\.com\?size=256$/);
});

test("Clearbit fallback accepts bare hostname (no scheme)", () => {
  const result = buildInventoryImageUrl({
    name: "X",
    supplierWebsite: "sysco.com",
  });
  assert.match(result, /logo\.clearbit\.com\/sysco\.com/);
});

test("malformed supplier website → skip Clearbit, fall to letter avatar", () => {
  // Garbage that can't be URL-parsed even after adding https:// prefix.
  const result = buildInventoryImageUrl({
    name: "X",
    supplierWebsite: "://not a url at all!!!",
  });
  // Should NOT be a clearbit URL.
  assert.ok(
    !result.startsWith("https://logo.clearbit.com/"),
    `got clearbit URL for malformed input: ${result}`,
  );
});

// ── Letter avatar fallback ────────────────────────────────────────

test("no productUrl, no supplierWebsite → data: SVG letter avatar", () => {
  const result = buildInventoryImageUrl({ name: "Oat Milk" });
  assert.match(result, /^data:image\/svg\+xml;utf8,/);
});

test("letter avatar uses FIRST letter of name, uppercased", () => {
  const result = buildInventoryImageUrl({ name: "oat milk" });
  const svg = decodeURIComponent(result.replace(/^data:image\/svg\+xml;utf8,/, ""));
  // The letter rendered should be "O" (first char of name, uppercased).
  // Avoid matching text inside the font-family attribute by requiring
  // the letter to be between the closing <text ...> opener and </text>.
  assert.match(svg, />O</);
  // Must NOT contain a lowercase letter-render.
  assert.ok(!/>o</.test(svg), "letter should be uppercased");
});

test("empty name → '?' placeholder (never throw or produce ' ' avatar)", () => {
  const result = buildInventoryImageUrl({ name: "" });
  const svg = decodeURIComponent(result.replace(/^data:image\/svg\+xml;utf8,/, ""));
  assert.match(svg, />\?</);
});

test("name with leading whitespace still yields the first real letter", () => {
  const result = buildInventoryImageUrl({ name: "   Latte" });
  const svg = decodeURIComponent(result.replace(/^data:image\/svg\+xml;utf8,/, ""));
  assert.match(svg, />L</);
});

test("non-Latin name yields the first non-Latin character in the avatar", () => {
  const result = buildInventoryImageUrl({ name: "咖啡" });
  const svg = decodeURIComponent(result.replace(/^data:image\/svg\+xml;utf8,/, ""));
  // String.prototype.toUpperCase() is a no-op on CJK; the raw char
  // survives verbatim between the text tags.
  assert.match(svg, />咖</);
});

// ── Category colouring ────────────────────────────────────────────

test("COFFEE category uses the brown swatch (#5b3a1f)", () => {
  const result = buildInventoryImageUrl({ name: "Beans", category: "COFFEE" });
  const svg = decodeURIComponent(result.replace(/^data:image\/svg\+xml;utf8,/, ""));
  assert.match(svg, /fill="#5b3a1f"/);
});

test("DAIRY category uses the light swatch + dark text (contrast flip)", () => {
  const result = buildInventoryImageUrl({ name: "Milk", category: "DAIRY" });
  const svg = decodeURIComponent(result.replace(/^data:image\/svg\+xml;utf8,/, ""));
  // DAIRY bg is #f3f4f6 (very light) → text must be dark (#111827).
  assert.match(svg, /fill="#f3f4f6"/);
  assert.match(svg, /fill="#111827"/);
});

test("CLEANING category uses dark-blue bg + white text", () => {
  const result = buildInventoryImageUrl({ name: "Bleach", category: "CLEANING" });
  const svg = decodeURIComponent(result.replace(/^data:image\/svg\+xml;utf8,/, ""));
  assert.match(svg, /fill="#3b82f6"/);
  assert.match(svg, /fill="#ffffff"/);
});

test("unknown category falls back to SUPPLY swatch", () => {
  const unknown = buildInventoryImageUrl({
    name: "X",
    category: "NOT_A_REAL_CATEGORY",
  });
  const supply = buildInventoryImageUrl({ name: "X", category: "SUPPLY" });
  // Both should render the same swatch even with different category strings.
  const unknownSvg = decodeURIComponent(unknown.replace(/^data:image\/svg\+xml;utf8,/, ""));
  const supplySvg = decodeURIComponent(supply.replace(/^data:image\/svg\+xml;utf8,/, ""));
  // The background rect colour should match.
  const bgOf = (svg: string) => svg.match(/<rect[^>]*fill="(#[0-9a-fA-F]+)"/)?.[1];
  assert.equal(bgOf(unknownSvg), bgOf(supplySvg));
});

test("no category → defaults to SUPPLY swatch (never throws)", () => {
  const result = buildInventoryImageUrl({ name: "X" });
  const svg = decodeURIComponent(result.replace(/^data:image\/svg\+xml;utf8,/, ""));
  assert.match(svg, /fill="#64748b"/); // SUPPLY
});

test("lowercased category still matches (case-insensitive swatch lookup)", () => {
  const result = buildInventoryImageUrl({ name: "X", category: "coffee" });
  const svg = decodeURIComponent(result.replace(/^data:image\/svg\+xml;utf8,/, ""));
  assert.match(svg, /fill="#5b3a1f"/);
});

// ── XML injection defence in letter-avatar SVG ────────────────────

test("name with XML-special chars is escaped inside the SVG (no injection)", () => {
  // If a manager names an item with "<script>" or "&" or quotes, the
  // SVG must still be well-formed — otherwise the data URL renders
  // broken or (worst case) parses embedded script.
  const result = buildInventoryImageUrl({
    name: `<script>alert('xss')</script>`,
  });
  const svg = decodeURIComponent(result.replace(/^data:image\/svg\+xml;utf8,/, ""));
  // First char is "<" which must appear escaped as &lt; inside <text>.
  assert.match(svg, />&lt;</);
  // Raw "<script>" must not appear inside the avatar.
  assert.ok(!svg.includes("<script>"), `raw <script> leaked: ${svg}`);
});

test("name starting with '&' renders as &amp; in SVG", () => {
  const result = buildInventoryImageUrl({ name: "&roasters" });
  const svg = decodeURIComponent(result.replace(/^data:image\/svg\+xml;utf8,/, ""));
  assert.match(svg, />&amp;</);
});

test("name starting with '\"' renders as &quot; in SVG", () => {
  const result = buildInventoryImageUrl({ name: `"double"` });
  const svg = decodeURIComponent(result.replace(/^data:image\/svg\+xml;utf8,/, ""));
  assert.match(svg, />&quot;</);
});

test("name starting with single-quote renders as &apos; in SVG", () => {
  const result = buildInventoryImageUrl({ name: "'single'" });
  const svg = decodeURIComponent(result.replace(/^data:image\/svg\+xml;utf8,/, ""));
  assert.match(svg, />&apos;</);
});

// ── Preference chain: productUrl beats supplierWebsite ────────────

test("direct image URL WINS over supplier website (productUrl preferred)", () => {
  const result = buildInventoryImageUrl({
    name: "X",
    productUrl: "https://direct.example.com/a.png",
    supplierWebsite: "https://sysco.com",
  });
  assert.equal(result, "https://direct.example.com/a.png");
  assert.ok(!result.includes("clearbit"), "clearbit must not win over direct image");
});

test("product-PAGE URL falls through to supplier Clearbit (not the page itself)", () => {
  // /dp/X is not a direct image, so the sync builder uses supplier
  // Clearbit instead.
  const result = buildInventoryImageUrl({
    name: "X",
    productUrl: "https://amazon.com/dp/B000",
    supplierWebsite: "https://sysco.com",
  });
  assert.match(result, /^https:\/\/logo\.clearbit\.com\/sysco\.com/);
});

// ── Data URL shape + size guardrails ──────────────────────────────

test("letter avatar data URL is URL-encoded (spaces → %20, etc.)", () => {
  // data: URLs must be URL-encoded; a raw space would break in some
  // contexts (email clients, older Safari).
  const result = buildInventoryImageUrl({ name: "X" });
  assert.match(result, /^data:image\/svg\+xml;utf8,/);
  // After the prefix, must not contain raw whitespace or un-encoded
  // angle brackets.
  const payload = result.slice("data:image/svg+xml;utf8,".length);
  assert.ok(!/ /.test(payload), "raw space in data URL payload");
  assert.ok(!/</.test(payload), "raw < in data URL payload");
  assert.ok(!/>/.test(payload), "raw > in data URL payload");
});

test("letter avatar is small enough to inline (< 2KB encoded)", () => {
  // The avatar ends up in <img src="..."> and in DB rows — it must
  // stay tiny. Current impl ~500 bytes; cap at 2KB to catch
  // regressions (e.g. switching to a big inline PNG).
  const result = buildInventoryImageUrl({ name: "Latte" });
  assert.ok(result.length < 2048, `avatar too big: ${result.length} bytes`);
});
