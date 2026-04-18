import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCartLinks,
  buildCartReadyKeyboard,
  buildDeepCartAddUrl,
  extractAmazonAsin,
} from "./cart-links";

// ── extractAmazonAsin ────────────────────────────────────────────

test("extractAmazonAsin: pulls ASIN from /dp/ URL", () => {
  assert.equal(
    extractAmazonAsin("https://www.amazon.com/dp/B005YJZE2I"),
    "B005YJZE2I",
  );
});

test("extractAmazonAsin: pulls ASIN from /dp/ URL with product-name prefix", () => {
  // Amazon typically renders /Some-Product-Name/dp/B005YJZE2I/ — the
  // slug is an SEO filler. The parser must ignore it.
  assert.equal(
    extractAmazonAsin("https://www.amazon.com/Gasket-Seal/dp/B005YJZE2I/ref=sr_1_1"),
    "B005YJZE2I",
  );
});

test("extractAmazonAsin: pulls ASIN from /gp/product/ URL", () => {
  assert.equal(
    extractAmazonAsin("https://www.amazon.com/gp/product/B00123ABCD"),
    "B00123ABCD",
  );
});

test("extractAmazonAsin: uppercases lowercase ASINs (user-pasted URL noise)", () => {
  assert.equal(
    extractAmazonAsin("https://amazon.com/dp/b005yjze2i"),
    "B005YJZE2I",
  );
});

test("extractAmazonAsin: ignores trailing query/fragments", () => {
  assert.equal(
    extractAmazonAsin("https://www.amazon.com/dp/B005YJZE2I?ref=abc"),
    "B005YJZE2I",
  );
  assert.equal(
    extractAmazonAsin("https://www.amazon.com/dp/B005YJZE2I#reviews"),
    "B005YJZE2I",
  );
  assert.equal(
    extractAmazonAsin("https://www.amazon.com/dp/B005YJZE2I/"),
    "B005YJZE2I",
  );
});

test("extractAmazonAsin: returns null for null/undefined/empty", () => {
  assert.equal(extractAmazonAsin(null), null);
  assert.equal(extractAmazonAsin(undefined), null);
  assert.equal(extractAmazonAsin(""), null);
});

test("extractAmazonAsin: returns null for shortlinks (a.co, amzn.to)", () => {
  // Shortlinks require an HTTP resolve step we don't do at PO time.
  // The docstring promises null here — lock it.
  assert.equal(extractAmazonAsin("https://a.co/d/abcdef"), null);
  assert.equal(extractAmazonAsin("https://amzn.to/3xyzABC"), null);
});

test("extractAmazonAsin: returns null for non-Amazon URLs", () => {
  assert.equal(
    extractAmazonAsin("https://www.walmart.com/ip/Widget/123456"),
    null,
  );
  assert.equal(extractAmazonAsin("https://example.com/dp/whatever"), null);
});

test("extractAmazonAsin: rejects ASIN candidates of wrong length", () => {
  // 10 chars exactly. 9 or 11 means malformed / different ID space.
  assert.equal(extractAmazonAsin("https://amazon.com/dp/B005YJZE2"), null);
  assert.equal(extractAmazonAsin("https://amazon.com/dp/B005YJZE2IX"), null);
});

test("extractAmazonAsin: returns null for non-URL strings (no throw)", () => {
  // Callers pass in user-pasted text that may not be a URL at all.
  assert.equal(extractAmazonAsin("not a url"), null);
  assert.equal(extractAmazonAsin("/dp/shortpath"), null);
});

// ── buildDeepCartAddUrl: Amazon branch ──────────────────────────

test("buildDeepCartAddUrl: empty lines → null", () => {
  assert.equal(
    buildDeepCartAddUrl({
      supplierWebsite: "https://www.amazon.com",
      supplierName: "Amazon",
      lines: [],
    }),
    null,
  );
});

test("buildDeepCartAddUrl: single Amazon item → per_item with one button", () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    lines: [
      {
        description: "Gasket Seal",
        quantityOrdered: 2,
        productUrl: "https://www.amazon.com/dp/B005YJZE2I",
      },
    ],
  });
  assert.equal(link?.kind, "per_item");
  if (link?.kind !== "per_item") throw new Error("type guard");
  assert.equal(link.perItem.length, 1);
  assert.match(link.primary.url, /\/dp\/B005YJZE2I$/);
  assert.match(link.primary.label, /Gasket Seal/);
  assert.match(link.primary.label, /×2/);
});

test("buildDeepCartAddUrl: multi-item Amazon → primary is storefront, each item its own button", () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    lines: [
      {
        description: "Foo",
        quantityOrdered: 1,
        productUrl: "https://amazon.com/dp/B000000001",
      },
      {
        description: "Bar",
        quantityOrdered: 3,
        productUrl: "https://amazon.com/dp/B000000002",
      },
    ],
  });
  assert.equal(link?.kind, "per_item");
  if (link?.kind !== "per_item") throw new Error("type guard");
  assert.equal(link.perItem.length, 2);
  assert.equal(link.primary.url, "https://www.amazon.com/");
  assert.match(link.primary.label, /2 items below/);
});

test("buildDeepCartAddUrl: Amazon but no ASINs extractable → open_site", () => {
  // User pasted amzn.to shortlinks which we can't resolve. Degrade
  // gracefully to "just open Amazon" rather than null.
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    lines: [
      {
        description: "Thing",
        quantityOrdered: 1,
        productUrl: "https://amzn.to/3xyz",
      },
    ],
  });
  assert.equal(link?.kind, "open_site");
  if (link?.kind !== "open_site") throw new Error("type guard");
  assert.match(link.primary.url, /^https:\/\/www\.amazon\.com\//);
});

test("buildDeepCartAddUrl: respects locale storefront (amazon.ca)", () => {
  // User in Canada uses amazon.ca; cart links must land there, not
  // .com (different account, different currency).
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://www.amazon.ca",
    supplierName: "Amazon Canada",
    lines: [
      {
        description: "Foo",
        quantityOrdered: 1,
        productUrl: "https://www.amazon.ca/dp/B000000001",
      },
    ],
  });
  assert.equal(link?.kind, "per_item");
  if (link?.kind !== "per_item") throw new Error("type guard");
  assert.match(link.primary.url, /amazon\.ca/);
});

test("buildDeepCartAddUrl: detects Amazon by product URL even if supplier website missing", () => {
  // Common case: supplier row has no website but user pasted an
  // Amazon product URL.
  const link = buildDeepCartAddUrl({
    supplierWebsite: null,
    supplierName: "Generic Supplier",
    lines: [
      {
        description: "Thing",
        quantityOrdered: 1,
        productUrl: "https://www.amazon.com/dp/B000000001",
      },
    ],
  });
  assert.equal(link?.kind, "per_item");
});

test("buildDeepCartAddUrl: detects Amazon by name substring ('Amazon Fresh')", () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: null,
    supplierName: "Amazon Fresh",
    lines: [
      { description: "Thing", quantityOrdered: 1, productUrl: null },
    ],
  });
  // No product URL, no supplier website — open storefront is the
  // only honest option.
  assert.equal(link?.kind, "open_site");
});

test("buildDeepCartAddUrl: truncates long product descriptions in button label", () => {
  const longName = "This is a ridiculously long product description that goes on forever";
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    lines: [
      {
        description: longName,
        quantityOrdered: 1,
        productUrl: "https://www.amazon.com/dp/B000000001",
      },
    ],
  });
  assert.equal(link?.kind, "per_item");
  if (link?.kind !== "per_item") throw new Error("type guard");
  // Label should end with ellipsis and be bounded; full name should NOT appear.
  assert.ok(!link.primary.label.includes("goes on forever"));
  assert.match(link.primary.label, /…/);
});

test("buildDeepCartAddUrl: floors quantity at 1 (guard against zero/negative input)", () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    lines: [
      {
        description: "Item",
        quantityOrdered: 0,
        productUrl: "https://www.amazon.com/dp/B000000001",
      },
    ],
  });
  assert.equal(link?.kind, "per_item");
  if (link?.kind !== "per_item") throw new Error("type guard");
  assert.match(link.primary.label, /×1/);
});

// ── buildDeepCartAddUrl: Walmart branch ─────────────────────────

test("buildDeepCartAddUrl: Walmart single item → populates with affiliate cart URL", () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://www.walmart.com",
    supplierName: "Walmart",
    lines: [
      {
        description: "Flour",
        quantityOrdered: 3,
        productUrl: "https://www.walmart.com/ip/All-Purpose-Flour/12345678",
      },
    ],
  });
  assert.equal(link?.kind, "populates");
  if (link?.kind !== "populates") throw new Error("type guard");
  assert.match(link.primary.url, /^https:\/\/affil\.walmart\.com\/cart\/addToCart\?items=/);
  assert.match(link.primary.url, /12345678_3/);
  assert.match(link.primary.label, /Walmart/);
});

test("buildDeepCartAddUrl: Walmart multi-item → comma-joined items string", () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://www.walmart.com",
    supplierName: "Walmart",
    lines: [
      {
        description: "A",
        quantityOrdered: 2,
        productUrl: "https://www.walmart.com/ip/A/11111",
      },
      {
        description: "B",
        quantityOrdered: 5,
        productUrl: "https://www.walmart.com/ip/B/22222",
      },
    ],
  });
  assert.equal(link?.kind, "populates");
  if (link?.kind !== "populates") throw new Error("type guard");
  assert.match(link.primary.url, /items=11111_2,22222_5/);
  assert.match(link.primary.label, /Add 2 items/);
});

test("buildDeepCartAddUrl: Walmart but no extractable IDs → falls through to per-item", () => {
  // Every product URL is garbage; we fall through to the generic
  // per-item branch which uses the raw URLs.
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://www.walmart.com",
    supplierName: "Walmart",
    lines: [
      {
        description: "X",
        quantityOrdered: 1,
        productUrl: "https://example.com/not-walmart",
      },
    ],
  });
  assert.equal(link?.kind, "per_item");
});

// ── buildDeepCartAddUrl: Generic branch ─────────────────────────

test("buildDeepCartAddUrl: generic supplier with product URLs → per_item", () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://sysco.com",
    supplierName: "Sysco",
    lines: [
      {
        description: "Tomato paste",
        quantityOrdered: 4,
        productUrl: "https://sysco.com/products/tomato-paste-12345",
      },
    ],
  });
  assert.equal(link?.kind, "per_item");
  if (link?.kind !== "per_item") throw new Error("type guard");
  assert.equal(link.primary.url, "https://sysco.com/products/tomato-paste-12345");
});

test("buildDeepCartAddUrl: generic with no product URLs but supplier website → open_site", () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://sysco.com",
    supplierName: "Sysco",
    lines: [{ description: "X", quantityOrdered: 1, productUrl: null }],
  });
  assert.equal(link?.kind, "open_site");
  if (link?.kind !== "open_site") throw new Error("type guard");
  assert.equal(link.primary.url, "https://sysco.com");
});

test("buildDeepCartAddUrl: generic with neither product URLs nor website → null", () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: null,
    supplierName: "Unknown Supplier",
    lines: [{ description: "X", quantityOrdered: 1, productUrl: null }],
  });
  assert.equal(link, null);
});

// ── buildCartLinks: Amazon happy path ───────────────────────────

test("buildCartLinks: Amazon + any added item → cart URL is set", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    lines: [
      {
        description: "Thing",
        quantityOrdered: 1,
        productUrl: "https://www.amazon.com/dp/B000000001",
        added: true,
      },
    ],
    hasCredentials: true,
  });
  assert.equal(links.isAmazon, true);
  assert.match(links.openCartUrl ?? "", /\/gp\/cart\/view\.html$/);
  assert.equal(links.openCartLabel, "🛒 Open my Amazon cart");
});

test("buildCartLinks: Amazon, every item failed → no cart URL (cart is empty)", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    lines: [
      {
        description: "Thing",
        quantityOrdered: 1,
        productUrl: "https://www.amazon.com/dp/B000000001",
        added: false,
      },
    ],
    hasCredentials: true,
  });
  assert.equal(links.openCartUrl, null);
  // But a search-fallback button IS emitted so the manager can
  // find the item themselves.
  assert.equal(links.productButtons.length, 1);
  assert.match(links.productButtons[0].url, /\/s\?k=Thing$/);
});

test("buildCartLinks: successful adds don't emit search-fallback buttons (avoid noise)", () => {
  // User feedback pinned in source: the bot used to echo back the
  // same URL the user provided → pointless clutter. Locks the fix.
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    lines: [
      {
        description: "Thing",
        quantityOrdered: 1,
        productUrl: "https://www.amazon.com/dp/B000000001",
        added: true,
      },
      {
        description: "Other",
        quantityOrdered: 2,
        productUrl: "https://www.amazon.com/dp/B000000002",
      }, // added=undefined → assume yes
    ],
    hasCredentials: true,
  });
  assert.equal(links.productButtons.length, 0);
});

test("buildCartLinks: mixed success — only failed items get search buttons", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    lines: [
      { description: "Won", quantityOrdered: 1, productUrl: "https://www.amazon.com/dp/B1", added: true },
      { description: "Lost", quantityOrdered: 1, productUrl: "https://www.amazon.com/dp/B2", added: false },
    ],
    hasCredentials: true,
  });
  assert.equal(links.productButtons.length, 1);
  assert.match(links.productButtons[0].text, /Lost/);
  // openCartUrl still set because at least one add succeeded.
  assert.match(links.openCartUrl ?? "", /\/gp\/cart/);
});

test("buildCartLinks: Amazon.ca locale preserved on cart URL", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.ca",
    supplierName: "Amazon Canada",
    lines: [
      { description: "X", quantityOrdered: 1, productUrl: "https://www.amazon.ca/dp/B000000001", added: true },
    ],
    hasCredentials: true,
  });
  assert.match(links.openCartUrl ?? "", /amazon\.ca/);
});

test("buildCartLinks: search URL encodes special chars (quotes, ampersands)", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    lines: [
      {
        description: 'Heinz "57" Sauce & Glaze',
        quantityOrdered: 1,
        productUrl: "https://www.amazon.com/dp/B000000001",
        added: false,
      },
    ],
    hasCredentials: true,
  });
  assert.equal(links.productButtons.length, 1);
  const url = links.productButtons[0].url;
  // Raw quotes/ampersands would break the URL. Verify encoded.
  assert.ok(!url.includes('"'), `unencoded quote in ${url}`);
  assert.match(url, /%22/); // encoded quote
  assert.match(url, /%26/); // encoded &
});

test("buildCartLinks: caps failed-item search buttons at 3 (keyboard sanity)", () => {
  // Source slices lines[0..3]; even if 10 items failed, only up to
  // 3 search buttons are emitted.
  const lines = Array.from({ length: 10 }, (_, i) => ({
    description: `Item ${i}`,
    quantityOrdered: 1,
    productUrl: `https://www.amazon.com/dp/B00000000${i}`,
    added: false,
  }));
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    lines,
    hasCredentials: true,
  });
  assert.ok(links.productButtons.length <= 3, `got ${links.productButtons.length} buttons`);
});

// ── buildCartLinks: generic branch ──────────────────────────────

test("buildCartLinks: non-Amazon supplier → open website, no search buttons", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://sysco.com",
    supplierName: "Sysco",
    lines: [{ description: "Thing", quantityOrdered: 1, productUrl: null }],
    hasCredentials: false,
  });
  assert.equal(links.isAmazon, false);
  assert.equal(links.openCartUrl, "https://sysco.com");
  assert.match(links.openCartLabel, /Sysco/);
  assert.equal(links.productButtons.length, 0);
});

test("buildCartLinks: generic with no website at all → null open URL", () => {
  const links = buildCartLinks({
    supplierWebsite: null,
    supplierName: "Joe's Meats",
    lines: [{ description: "X", quantityOrdered: 1, productUrl: null }],
    hasCredentials: false,
  });
  assert.equal(links.openCartUrl, null);
});

// ── buildCartReadyKeyboard ──────────────────────────────────────

test("buildCartReadyKeyboard: always emits approve/cancel row last", () => {
  const rows = buildCartReadyKeyboard({
    agentTaskId: "task_123",
    links: {
      openCartUrl: null,
      productButtons: [],
      openCartLabel: "Open",
      isAmazon: false,
    },
  });
  const last = rows[rows.length - 1];
  assert.equal(last.length, 2);
  const approve = last[0] as { callback_data: string };
  const cancel = last[1] as { callback_data: string };
  assert.match(approve.callback_data, /^website_cart_approve:task_123$/);
  assert.match(cancel.callback_data, /^website_cart_cancel:task_123$/);
});

test("buildCartReadyKeyboard: embeds task ID into both callbacks (required for routing)", () => {
  // The Telegram bot router matches on the callback_data prefix; if
  // the task ID is missing or mis-delimited, the button silently
  // 404s.
  const rows = buildCartReadyKeyboard({
    agentTaskId: "abc-xyz-123",
    links: { openCartUrl: null, productButtons: [], openCartLabel: "x", isAmazon: false },
  });
  const last = rows[rows.length - 1];
  for (const btn of last) {
    assert.ok(
      (btn as { callback_data: string }).callback_data.endsWith(":abc-xyz-123"),
    );
  }
});

test("buildCartReadyKeyboard: open-cart URL produces first row when present", () => {
  const rows = buildCartReadyKeyboard({
    agentTaskId: "t1",
    links: {
      openCartUrl: "https://www.amazon.com/gp/cart/view.html",
      productButtons: [],
      openCartLabel: "🛒 Open",
      isAmazon: true,
    },
  });
  const first = rows[0][0] as { text: string; url: string };
  assert.equal(first.url, "https://www.amazon.com/gp/cart/view.html");
  assert.equal(first.text, "🛒 Open");
});

test("buildCartReadyKeyboard: omits open-cart row when openCartUrl is null", () => {
  const rows = buildCartReadyKeyboard({
    agentTaskId: "t1",
    links: { openCartUrl: null, productButtons: [], openCartLabel: "x", isAmazon: false },
  });
  // Only one row: the approve/cancel pair.
  assert.equal(rows.length, 1);
});

test("buildCartReadyKeyboard: each product button gets its own row (labels don't squash)", () => {
  const rows = buildCartReadyKeyboard({
    agentTaskId: "t1",
    links: {
      openCartUrl: "https://amazon.com/cart",
      productButtons: [
        { text: "🔍 Search: A", url: "https://amazon.com/s?k=A" },
        { text: "🔍 Search: B", url: "https://amazon.com/s?k=B" },
      ],
      openCartLabel: "Open",
      isAmazon: true,
    },
  });
  // Row 0 = cart. Rows 1..2 = product buttons. Row 3 = approve/cancel.
  assert.equal(rows.length, 4);
  assert.equal(rows[1].length, 1);
  assert.equal(rows[2].length, 1);
  assert.equal(rows[3].length, 2);
});
