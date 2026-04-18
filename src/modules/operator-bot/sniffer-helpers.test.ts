import test from "node:test";
import assert from "node:assert/strict";

import {
  capitaliseItem,
  findAllUrls,
  findUrl,
  hostnameToSupplierLabel,
  itemNameFromUrl,
  looksLikeOrderIntent,
  normaliseSupplierName,
  normalizeProductUrl,
  parseQuantityFromText,
  sniffApproveOrCancel,
} from "./sniffer-helpers";

// ── normalizeProductUrl ──────────────────────────────────────────────────

test("normalizeProductUrl: keeps a clean https URL as-is", () => {
  assert.equal(
    normalizeProductUrl("https://www.amazon.com/dp/B005"),
    "https://www.amazon.com/dp/B005"
  );
});

test("normalizeProductUrl: prepends https when scheme missing", () => {
  assert.equal(normalizeProductUrl("amazon.com"), "https://amazon.com/");
  assert.equal(
    normalizeProductUrl("www.lcbo.com/foo"),
    "https://www.lcbo.com/foo"
  );
});

test("normalizeProductUrl: strips markdown wrappers + trailing punctuation", () => {
  assert.equal(
    normalizeProductUrl("<https://amazon.com>"),
    "https://amazon.com/"
  );
  assert.equal(
    normalizeProductUrl("`https://amazon.com`"),
    "https://amazon.com/"
  );
  assert.equal(
    normalizeProductUrl("https://amazon.com."),
    "https://amazon.com/"
  );
  assert.equal(
    normalizeProductUrl("https://amazon.com,"),
    "https://amazon.com/"
  );
});

test("normalizeProductUrl: rejects non-http(s) schemes", () => {
  assert.equal(normalizeProductUrl("javascript:alert(1)"), "");
  assert.equal(normalizeProductUrl("file:///etc/passwd"), "");
  assert.equal(normalizeProductUrl("data:text/html,foo"), "");
});

test("normalizeProductUrl: empty / whitespace → empty string", () => {
  assert.equal(normalizeProductUrl(""), "");
  assert.equal(normalizeProductUrl("   "), "");
});

test("normalizeProductUrl: unparseable returns empty string", () => {
  assert.equal(normalizeProductUrl("not a url"), "");
});

// ── findUrl ──────────────────────────────────────────────────────────────

test("findUrl: extracts an https URL from free-form text", () => {
  assert.equal(
    findUrl("hey check this out https://www.amazon.com/dp/B005"),
    "https://www.amazon.com/dp/B005"
  );
});

test("findUrl: handles bare www without scheme", () => {
  assert.equal(
    findUrl("buy www.lcbo.com/wisers please"),
    "https://www.lcbo.com/wisers"
  );
});

test("findUrl: handles amzn.to short links", () => {
  assert.equal(findUrl("get amzn.to/3xyz now"), "https://amzn.to/3xyz");
});

test("findUrl: handles a.co short links", () => {
  assert.equal(findUrl("a.co/d/abc123 thanks"), "https://a.co/d/abc123");
});

test("findUrl: returns null when no URL", () => {
  assert.equal(findUrl("just some words"), null);
  assert.equal(findUrl(""), null);
});

test("findUrl: strips trailing punctuation that runs into the URL", () => {
  // Trailing comma should not be part of the URL.
  assert.equal(
    findUrl("here: https://amazon.com/foo, what do you think"),
    "https://amazon.com/foo"
  );
});

// ── findAllUrls ──────────────────────────────────────────────────────────

test("findAllUrls: pulls every URL from a bulk paste", () => {
  const urls = findAllUrls(
    "add these to cart https://amazon.com/a https://lcbo.com/b www.costco.com/c"
  );
  assert.deepEqual(urls, [
    "https://amazon.com/a",
    "https://lcbo.com/b",
    "https://www.costco.com/c",
  ]);
});

test("findAllUrls: deduplicates", () => {
  const urls = findAllUrls(
    "https://amazon.com/x https://amazon.com/x https://amazon.com/x"
  );
  assert.deepEqual(urls, ["https://amazon.com/x"]);
});

test("findAllUrls: returns empty list when no URLs", () => {
  assert.deepEqual(findAllUrls("nothing here"), []);
  assert.deepEqual(findAllUrls(""), []);
});

test("findAllUrls: handles mixed URL forms in one message", () => {
  const urls = findAllUrls("https://amazon.com/a amzn.to/x www.lcbo.com/y");
  assert.equal(urls.length, 3);
  assert.ok(urls.includes("https://amazon.com/a"));
  assert.ok(urls.includes("https://amzn.to/x"));
  assert.ok(urls.includes("https://www.lcbo.com/y"));
});

// ── hostnameToSupplierLabel ──────────────────────────────────────────────

test("hostnameToSupplierLabel: amazon.com → Amazon", () => {
  assert.equal(
    hostnameToSupplierLabel("https://www.amazon.com/dp/B005"),
    "Amazon"
  );
  assert.equal(
    hostnameToSupplierLabel("https://www.amazon.ca/dp/B005"),
    "Amazon"
  );
  assert.equal(
    hostnameToSupplierLabel("https://www.amazon.co.uk/dp/B005"),
    "Amazon"
  );
});

test("hostnameToSupplierLabel: short links → Amazon", () => {
  assert.equal(hostnameToSupplierLabel("https://amzn.to/3xyz"), "Amazon");
  assert.equal(hostnameToSupplierLabel("https://a.co/d/abc"), "Amazon");
});

test("hostnameToSupplierLabel: known suppliers", () => {
  assert.equal(
    hostnameToSupplierLabel("https://www.costco.com/foo"),
    "Costco"
  );
  assert.equal(
    hostnameToSupplierLabel("https://www.walmart.com/foo"),
    "Walmart"
  );
  assert.equal(
    hostnameToSupplierLabel("https://www.target.com/foo"),
    "Target"
  );
  assert.equal(hostnameToSupplierLabel("https://www.lcbo.com/foo"), "LCBO");
  assert.equal(
    hostnameToSupplierLabel("https://shop.sysco.com/foo"),
    "Sysco"
  );
  assert.equal(
    hostnameToSupplierLabel("https://www.webstaurantstore.com/foo"),
    "WebstaurantStore"
  );
  assert.equal(
    hostnameToSupplierLabel("https://www.homedepot.com/foo"),
    "Home Depot"
  );
  assert.equal(
    hostnameToSupplierLabel("https://www.staples.com/foo"),
    "Staples"
  );
});

test("hostnameToSupplierLabel: unknown host → first segment titled", () => {
  assert.equal(
    hostnameToSupplierLabel("https://wholesalefoods.example/foo"),
    "Wholesalefoods"
  );
});

test("hostnameToSupplierLabel: malformed URL → null", () => {
  assert.equal(hostnameToSupplierLabel("not a url"), null);
  assert.equal(hostnameToSupplierLabel(""), null);
});

// ── itemNameFromUrl ──────────────────────────────────────────────────────

test("itemNameFromUrl: extracts Amazon /Slug/dp/ASIN", () => {
  assert.equal(
    itemNameFromUrl(
      "https://www.amazon.com/Urnex-Cafiza-Espresso/dp/B005FDL68W"
    ),
    "Urnex Cafiza Espresso"
  );
});

test("itemNameFromUrl: extracts Amazon /Slug/gp/product/ASIN", () => {
  assert.equal(
    itemNameFromUrl(
      "https://www.amazon.com/JP-Wisers-Whisky/gp/product/B0XYZ"
    ),
    "JP Wisers Whisky"
  );
});

test("itemNameFromUrl: returns null when no slug", () => {
  assert.equal(itemNameFromUrl("https://www.amazon.com/dp/B005"), null);
  assert.equal(itemNameFromUrl("https://www.lcbo.com/foo"), null);
  assert.equal(itemNameFromUrl(""), null);
});

// ── parseQuantityFromText ────────────────────────────────────────────────

test("parseQuantityFromText: bare digit", () => {
  assert.equal(parseQuantityFromText("order 5 of these"), 5);
  assert.equal(parseQuantityFromText("get me 12"), 12);
  assert.equal(parseQuantityFromText("3"), 3);
});

test("parseQuantityFromText: word digits", () => {
  assert.equal(parseQuantityFromText("add three to the cart"), 3);
  assert.equal(parseQuantityFromText("order seven of these"), 7);
  assert.equal(parseQuantityFromText("twelve please"), 12);
});

test("parseQuantityFromText: 'a dozen' → 12", () => {
  assert.equal(parseQuantityFromText("we need a dozen of these"), 12);
});

test("parseQuantityFromText: 'a' / 'an' → 1", () => {
  assert.equal(parseQuantityFromText("get an espresso machine"), 1);
  assert.equal(parseQuantityFromText("buy a coffee maker"), 1);
});

test("parseQuantityFromText: rejects digits glued to letters", () => {
  // "7-Eleven" should not be parsed as quantity 7.
  assert.equal(parseQuantityFromText("buy from 7-Eleven near me"), 1);
  // "M-2" isn't a quantity.
  assert.equal(parseQuantityFromText("get the M-2 model"), 1);
  // "Route66" isn't a quantity.
  assert.equal(parseQuantityFromText("Route66 mug"), 1);
});

test("parseQuantityFromText: rejects ASIN digits inside URL", () => {
  assert.equal(
    parseQuantityFromText("add this https://amazon.com/dp/B000FDL68W"),
    1
  );
});

test("parseQuantityFromText: still picks free quantity outside URL", () => {
  assert.equal(
    parseQuantityFromText("add 3 of https://amazon.com/dp/B000FDL68W"),
    3
  );
});

test("parseQuantityFromText: rejects digits outside 1-999 range", () => {
  // "9999" should fall through (treated as not-a-quantity).
  assert.equal(parseQuantityFromText("year 9999 catalog"), 1);
  // "0" should fall through.
  assert.equal(parseQuantityFromText("0 of these"), 1);
});

test("parseQuantityFromText: empty / no quantity → 1", () => {
  assert.equal(parseQuantityFromText(""), 1);
  assert.equal(parseQuantityFromText("add this thing"), 1);
});

test("parseQuantityFromText: case-insensitive word digits", () => {
  assert.equal(parseQuantityFromText("ADD THREE OF THESE"), 3);
  assert.equal(parseQuantityFromText("Twelve please"), 12);
});

// ── capitaliseItem ───────────────────────────────────────────────────────

test("capitaliseItem: title-cases each word", () => {
  assert.equal(capitaliseItem("oat milk"), "Oat Milk");
  assert.equal(capitaliseItem("jp wisers whisky"), "Jp Wisers Whisky");
});

test("capitaliseItem: handles single word", () => {
  assert.equal(capitaliseItem("milk"), "Milk");
});

test("capitaliseItem: collapses multiple spaces", () => {
  // Multiple spaces between words → single space, all capitalised.
  assert.equal(capitaliseItem("oat   milk"), "Oat Milk");
});

test("capitaliseItem: preserves already-capitalised letters", () => {
  // "JP Wisers" → "JP Wisers" (no lowercasing of trailing chars)
  assert.equal(capitaliseItem("JP wisers"), "JP Wisers");
});

test("capitaliseItem: empty string passes through", () => {
  assert.equal(capitaliseItem(""), "");
});

// ── normaliseSupplierName ────────────────────────────────────────────────

test("normaliseSupplierName: strips 'my' / 'the' prefix", () => {
  assert.equal(normaliseSupplierName("my LCBO"), "LCBO");
  assert.equal(normaliseSupplierName("the Costco"), "Costco");
});

test("normaliseSupplierName: strips trailing 'cart' / 'website' / 'shop' / 'store'", () => {
  assert.equal(normaliseSupplierName("LCBO cart"), "LCBO");
  assert.equal(normaliseSupplierName("Amazon website"), "Amazon");
  assert.equal(normaliseSupplierName("Costco shop"), "Costco");
  assert.equal(normaliseSupplierName("Walmart store"), "Walmart");
});

test("normaliseSupplierName: strips trailing punctuation", () => {
  assert.equal(normaliseSupplierName("Amazon."), "Amazon");
  assert.equal(normaliseSupplierName("LCBO!"), "LCBO");
  assert.equal(normaliseSupplierName("Costco?"), "Costco");
});

test("normaliseSupplierName: combination — 'my Amazon cart.'", () => {
  assert.equal(normaliseSupplierName("my Amazon cart"), "Amazon");
});

test("normaliseSupplierName: leaves clean names alone", () => {
  assert.equal(normaliseSupplierName("Amazon"), "Amazon");
  assert.equal(normaliseSupplierName("LCBO"), "LCBO");
});

test("normaliseSupplierName: trims whitespace", () => {
  assert.equal(normaliseSupplierName("  Amazon  "), "Amazon");
});

// ── looksLikeOrderIntent ─────────────────────────────────────────────────

test("looksLikeOrderIntent: triggers on order verbs", () => {
  assert.ok(looksLikeOrderIntent("add these"));
  assert.ok(looksLikeOrderIntent("order this"));
  assert.ok(looksLikeOrderIntent("buy now"));
  assert.ok(looksLikeOrderIntent("get me one"));
  assert.ok(looksLikeOrderIntent("we need three"));
  assert.ok(looksLikeOrderIntent("put it in the cart"));
  assert.ok(looksLikeOrderIntent("please order"));
});

test("looksLikeOrderIntent: false for plain links / questions", () => {
  assert.equal(looksLikeOrderIntent("check out this link"), false);
  assert.equal(looksLikeOrderIntent("look at this"), false);
  assert.equal(looksLikeOrderIntent("https://amazon.com/foo"), false);
});

test("looksLikeOrderIntent: case-insensitive", () => {
  assert.ok(looksLikeOrderIntent("ADD this"));
  assert.ok(looksLikeOrderIntent("ORDER now"));
});

// ── sniffApproveOrCancel ─────────────────────────────────────────────────

test("sniffApproveOrCancel: clear approves", () => {
  assert.equal(sniffApproveOrCancel("yes"), "approve");
  assert.equal(sniffApproveOrCancel("yep"), "approve");
  assert.equal(sniffApproveOrCancel("yup"), "approve");
  assert.equal(sniffApproveOrCancel("yeah"), "approve");
  assert.equal(sniffApproveOrCancel("ok"), "approve");
  assert.equal(sniffApproveOrCancel("okay"), "approve");
  assert.equal(sniffApproveOrCancel("approve"), "approve");
  assert.equal(sniffApproveOrCancel("approve it"), "approve");
  assert.equal(sniffApproveOrCancel("send it"), "approve");
  assert.equal(sniffApproveOrCancel("go ahead"), "approve");
  assert.equal(sniffApproveOrCancel("do it"), "approve");
  assert.equal(sniffApproveOrCancel("looks good"), "approve");
  assert.equal(sniffApproveOrCancel("lgtm"), "approve");
  assert.equal(sniffApproveOrCancel("sure"), "approve");
});

test("sniffApproveOrCancel: clear cancels", () => {
  assert.equal(sniffApproveOrCancel("cancel"), "cancel");
  assert.equal(sniffApproveOrCancel("nvm"), "cancel");
  assert.equal(sniffApproveOrCancel("never mind"), "cancel");
  assert.equal(sniffApproveOrCancel("scrap that"), "cancel");
  assert.equal(sniffApproveOrCancel("stop"), "cancel");
  assert.equal(sniffApproveOrCancel("abort"), "cancel");
  assert.equal(sniffApproveOrCancel("nope"), "cancel");
  assert.equal(sniffApproveOrCancel("nah"), "cancel");
  assert.equal(sniffApproveOrCancel("no"), "cancel");
});

test("sniffApproveOrCancel: 'don't send it' → cancel (negation wins)", () => {
  // Regression: the apostrophe is stripped to produce "dont send it".
  // "send it" looks approve-ish but the leading "dont" must flip it.
  assert.equal(sniffApproveOrCancel("don't send it"), "cancel");
  assert.equal(sniffApproveOrCancel("dont send it"), "cancel");
  assert.equal(sniffApproveOrCancel("do not send it"), "cancel");
});

test("sniffApproveOrCancel: 'no go ahead' → cancel (no wins over go ahead)", () => {
  assert.equal(sniffApproveOrCancel("no go ahead"), "cancel");
});

test("sniffApproveOrCancel: emoji approves", () => {
  assert.equal(sniffApproveOrCancel("👍"), "approve");
  assert.equal(sniffApproveOrCancel("✅"), "approve");
  assert.equal(sniffApproveOrCancel("✔"), "approve");
  assert.equal(sniffApproveOrCancel("✓"), "approve");
  assert.equal(sniffApproveOrCancel("🆗"), "approve");
});

test("sniffApproveOrCancel: emoji cancels", () => {
  assert.equal(sniffApproveOrCancel("❌"), "cancel");
  assert.equal(sniffApproveOrCancel("🚫"), "cancel");
  assert.equal(sniffApproveOrCancel("🛑"), "cancel");
});

test("sniffApproveOrCancel: too long → null (LLM handles)", () => {
  // > 40 chars → ambiguous, fall through to LLM.
  const long = "yes please send it but only the first three items";
  assert.equal(sniffApproveOrCancel(long), null);
});

test("sniffApproveOrCancel: contains digits → null (likely a new order)", () => {
  // "order 5 of these" contains a digit → not a yes/no, must be new order.
  assert.equal(sniffApproveOrCancel("yes 5"), null);
  assert.equal(sniffApproveOrCancel("approve 3"), null);
});

test("sniffApproveOrCancel: empty / whitespace → null", () => {
  assert.equal(sniffApproveOrCancel(""), null);
  assert.equal(sniffApproveOrCancel("   "), null);
});

test("sniffApproveOrCancel: random non-trigger words → null", () => {
  assert.equal(sniffApproveOrCancel("hello"), null);
  assert.equal(sniffApproveOrCancel("how are you"), null);
  assert.equal(sniffApproveOrCancel("what is this"), null);
});

test("sniffApproveOrCancel: case-insensitive", () => {
  assert.equal(sniffApproveOrCancel("YES"), "approve");
  assert.equal(sniffApproveOrCancel("Cancel"), "cancel");
  assert.equal(sniffApproveOrCancel("LGTM"), "approve");
});

test("sniffApproveOrCancel: with surrounding punctuation", () => {
  assert.equal(sniffApproveOrCancel("yes!"), "approve");
  assert.equal(sniffApproveOrCancel("yes."), "approve");
  assert.equal(sniffApproveOrCancel("yes!!!"), "approve");
  assert.equal(sniffApproveOrCancel("cancel."), "cancel");
});

test("sniffApproveOrCancel: 'approve and send' → approve", () => {
  assert.equal(sniffApproveOrCancel("approve and send"), "approve");
});

test("sniffApproveOrCancel: null/undefined safe", () => {
  // The function uses (text ?? "") so undefined shouldn't crash.
  assert.equal(
    sniffApproveOrCancel(undefined as unknown as string),
    null
  );
});

test("sniffApproveOrCancel: 'sure thing' → approve", () => {
  assert.equal(sniffApproveOrCancel("sure thing"), "approve");
});

test("sniffApproveOrCancel: 'not now' → cancel (negation)", () => {
  assert.equal(sniffApproveOrCancel("not now"), "cancel");
});
