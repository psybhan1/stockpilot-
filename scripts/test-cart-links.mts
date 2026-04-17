// Tests the cart-link helper. Real user feedback: pasted "Add to MY
// cart" via /gp/aws/cart/add.html, signed in, found an EMPTY cart —
// Amazon dropped the items at the sign-in redirect. So the helper
// no longer produces that broken URL. Instead, behavior depends on
// whether the manager has saved credentials for this supplier:
//
//   WITH cookies → "🛒 Open my Amazon cart" works, cart is populated
//                  in the manager's real account.
//   WITHOUT     → per-product /dp/<ASIN> buttons so the manager taps
//                  through and adds to their own cart manually. NO
//                  open-cart button (would show empty cart, mislead).

const {
  buildCartLinks,
  buildCartReadyKeyboard,
  extractAmazonAsin,
} = await import("../src/modules/automation/cart-links.ts");

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: unknown, label: string) {
  if (cond) {
    passed += 1;
    console.log(`    ✅ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`    ❌ ${label}`);
  }
}

async function runScenario(name: string, fn: () => void | Promise<void>) {
  console.log(`\n━━ ${name}`);
  try {
    await fn();
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`    ❌ THREW: ${msg}`);
  }
}

// ── ASIN extraction (unchanged) ────────────────────────────────────
await runScenario("extractAmazonAsin handles standard /dp/ URLs", () => {
  assert(
    extractAmazonAsin("https://www.amazon.com/Urnex-Cafiza-Espresso-Cleaning-Tablets/dp/B005YJZE2I") === "B005YJZE2I",
    "long product URL → ASIN"
  );
  assert(
    extractAmazonAsin("https://www.amazon.com/dp/B07XYZ1234") === "B07XYZ1234",
    "short /dp/ URL → ASIN"
  );
  assert(
    extractAmazonAsin("https://www.amazon.com/gp/product/B00ABCDEFG") === "B00ABCDEFG",
    "/gp/product/ URL → ASIN"
  );
  assert(
    extractAmazonAsin("https://www.amazon.ca/dp/B005YJZE2I/?ref=foo") === "B005YJZE2I",
    "trailing slash + query string ignored"
  );
  assert(
    extractAmazonAsin("https://www.amazon.com/dp/b005yjze2i") === "B005YJZE2I",
    "lowercase ASIN normalised to uppercase"
  );
});

await runScenario("extractAmazonAsin returns null for shortlinks and non-Amazon URLs", () => {
  assert(extractAmazonAsin("https://amzn.to/3xH8Wfp") === null, "amzn.to shortlink → null");
  assert(extractAmazonAsin("https://a.co/d/abc123") === null, "a.co shortlink → null");
  assert(extractAmazonAsin("https://costco.com/oat-milk.html") === null, "costco → null");
  assert(extractAmazonAsin(null) === null, "null → null");
  assert(extractAmazonAsin("") === null, "empty → null");
  assert(extractAmazonAsin("not a url") === null, "garbage → null");
});

// ── Amazon WITH credentials ────────────────────────────────────────
await runScenario("Amazon + credentials + success → ONLY cart link, no redundant product buttons", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: true,
    lines: [
      {
        description: "Urnex Cafiza",
        quantityOrdered: 3,
        productUrl: "https://www.amazon.com/Urnex-Cafiza/dp/B005YJZE2I",
        added: true,
      },
    ],
  });
  assert(links.isAmazon === true, "detected Amazon");
  assert(
    links.openCartUrl === "https://www.amazon.com/gp/cart/view.html",
    `cart link set (got: ${links.openCartUrl})`
  );
  assert(links.openCartLabel === "🛒 Open my Amazon cart", "Amazon label");
  assert(
    links.productButtons.length === 0,
    "NO product buttons — would be redundant with the URL user already sent"
  );
});

// ── Amazon WITHOUT credentials, successful add ─────────────────────
await runScenario("Amazon WITHOUT credentials, success → cart link STILL shown", () => {
  // User feedback: previous design suppressed the cart link without
  // credentials and showed product links (= the URL user just sent).
  // That was clutter. Now we always show the cart link and explain
  // in the caption what to expect.
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: false,
    lines: [
      {
        description: "Urnex Cafiza",
        quantityOrdered: 3,
        productUrl: "https://www.amazon.com/Urnex-Cafiza/dp/B005YJZE2I",
        added: true,
      },
    ],
  });
  assert(
    links.openCartUrl === "https://www.amazon.com/gp/cart/view.html",
    `cart link shown even without credentials (got: ${links.openCartUrl})`
  );
  assert(
    links.productButtons.length === 0,
    "NO redundant product buttons for successful adds"
  );
});

// ── Amazon FAILED add → search button appears ─────────────────────
await runScenario("Amazon failed add → search button for the manager to find it", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: false,
    lines: [
      {
        description: "Urnex Cafiza",
        quantityOrdered: 3,
        productUrl: "https://www.amazon.com/Urnex-Cafiza/dp/B005YJZE2I",
        added: false,
      },
    ],
  });
  // Nothing was successfully added → no cart link (it'd be empty).
  assert(links.openCartUrl === null, "no cart link when zero items added");
  assert(links.productButtons.length === 1, "search button surfaced");
  assert(
    links.productButtons[0].text.startsWith("🔍 Search:"),
    `search-type button (got: ${links.productButtons[0].text}`
  );
  assert(
    links.productButtons[0].url.includes("/s?k="),
    "search URL"
  );
});

await runScenario("CRUCIAL: no broken /gp/aws/cart/add.html URL anywhere", () => {
  const cases = [
    { hasCredentials: true },
    { hasCredentials: false },
  ];
  for (const c of cases) {
    const links = buildCartLinks({
      supplierWebsite: "https://www.amazon.com",
      supplierName: "Amazon",
      hasCredentials: c.hasCredentials,
      lines: [
        {
          description: "x",
          quantityOrdered: 2,
          productUrl: "https://www.amazon.com/dp/B005YJZE2I",
        },
      ],
    });
    const allUrls = [
      links.openCartUrl ?? "",
      ...links.productButtons.map((b) => b.url),
    ].join(" ");
    assert(
      !allUrls.includes("aws/cart/add.html"),
      `no aws/cart/add.html in any URL (creds=${c.hasCredentials})`
    );
    // Confirm the helper has no `addToMyCartUrl` field at all.
    assert(
      !("addToMyCartUrl" in links),
      `helper no longer exposes addToMyCartUrl (creds=${c.hasCredentials})`
    );
  }
});

await runScenario("Amazon multi-line PO with all failed → up to 3 search buttons (cap)", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: false,
    lines: [
      { description: "Item A", quantityOrdered: 1, productUrl: "https://www.amazon.com/dp/B0AAAAAAAA", added: false },
      { description: "Item B", quantityOrdered: 1, productUrl: "https://www.amazon.com/dp/B0BBBBBBBB", added: false },
      { description: "Item C", quantityOrdered: 1, productUrl: "https://www.amazon.com/dp/B0CCCCCCCC", added: false },
      { description: "Item D", quantityOrdered: 1, productUrl: "https://www.amazon.com/dp/B0DDDDDDDD", added: false },
    ],
  });
  assert(links.productButtons.length === 3, "capped at 3 buttons");
  assert(
    links.productButtons.every((b) => b.text.startsWith("🔍")),
    "all are search buttons (failed adds)"
  );
});

await runScenario("Long product names get truncated for search-button labels", () => {
  const longName = "Urnex Cafiza Tablets — 100-Count, Espresso Machine Cleaning Tablets, etc.";
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: false,
    lines: [
      {
        description: longName,
        quantityOrdered: 1,
        productUrl: "https://www.amazon.com/dp/B005YJZE2I",
        added: false, // must be failed to get a search button
      },
    ],
  });
  const text = links.productButtons[0].text;
  assert(text.length < 40, `label is short (${text.length} chars: ${text})`);
  assert(text.endsWith("…"), `label ellipsis-truncated: ${text}`);
});

await runScenario("Amazon locale: .ca supplier → amazon.ca cart link", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.ca",
    supplierName: "Amazon",
    hasCredentials: true,
    lines: [
      { description: "x", quantityOrdered: 1, productUrl: "https://www.amazon.ca/dp/B005YJZE2I", added: true },
    ],
  });
  assert(
    links.openCartUrl === "https://www.amazon.ca/gp/cart/view.html",
    `Canadian storefront: ${links.openCartUrl}`
  );
  assert(links.productButtons.length === 0, "no product buttons for success");
});

await runScenario("Amazon shortlink without ASIN, failed add → search-by-name fallback", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: false,
    lines: [
      { description: "thing", quantityOrdered: 1, productUrl: "https://a.co/d/abc123", added: false },
    ],
  });
  assert(links.productButtons.length === 1, "search-by-name button for failed add");
  assert(
    links.productButtons[0].text.startsWith("🔍"),
    "is a search button"
  );
  assert(
    links.productButtons[0].url.includes("/s?k=thing"),
    "search URL by name"
  );
  assert(links.openCartUrl === null, "no cart link (nothing added)");
});

await runScenario("Amazon shortlink without ASIN BUT with creds → open-cart still shows", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: true,
    lines: [
      { description: "thing", quantityOrdered: 1, productUrl: "https://a.co/d/abc123" },
    ],
  });
  assert(
    links.openCartUrl === "https://www.amazon.com/gp/cart/view.html",
    "open-cart shows (cart populated via cookies)"
  );
});

// ── Generic non-Amazon ─────────────────────────────────────────────
await runScenario("Generic supplier WITH credentials → open-cart (home page)", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.costco.com",
    supplierName: "Costco",
    hasCredentials: true,
    lines: [
      {
        description: "Oat Milk",
        quantityOrdered: 4,
        productUrl: "https://www.costco.com/oat-milk.html",
      },
    ],
  });
  assert(links.isAmazon === false, "not Amazon");
  assert(links.openCartUrl === "https://www.costco.com", "open-cart = home page");
  assert(links.openCartLabel === "🌐 Open Costco", "generic label");
  assert(links.productButtons.length === 0, "no product buttons for generic");
});

await runScenario("Generic supplier WITHOUT credentials → home page link still shown", () => {
  // For generic (non-Amazon) suppliers the only useful link IS the
  // home page; we don't have a way to know the cart-page URL without
  // a per-site adapter. So we keep the link even without creds and
  // explain in the message text that the cart is in their session.
  const links = buildCartLinks({
    supplierWebsite: "https://www.costco.com",
    supplierName: "Costco",
    hasCredentials: false,
    lines: [
      { description: "x", quantityOrdered: 1, productUrl: "https://www.costco.com/x.html" },
    ],
  });
  assert(links.openCartUrl === "https://www.costco.com", "home-page link shown");
  assert(links.productButtons.length === 0, "no per-product (generic)");
});

await runScenario("No website at all → no buttons", () => {
  const links = buildCartLinks({
    supplierWebsite: null,
    supplierName: "FreshCo",
    hasCredentials: false,
    lines: [{ description: "x", quantityOrdered: 1, productUrl: null }],
  });
  assert(links.openCartUrl === null, "no open-cart");
  assert(links.productButtons.length === 0, "no product buttons");
});

// ── Keyboard layout ────────────────────────────────────────────────
await runScenario("Keyboard for success → cart row + callbacks (no product row)", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: true,
    lines: [
      { description: "x", quantityOrdered: 1, productUrl: "https://www.amazon.com/dp/B005YJZE2I", added: true },
    ],
  });
  const kb = buildCartReadyKeyboard({ agentTaskId: "task-creds", links });
  // cart row + callback row = 2 (NO product row — user already has that URL)
  assert(kb.length === 2, `2 rows (got ${kb.length})`);
  assert(kb[0][0].text === "🛒 Open my Amazon cart", "row 0 is cart");
  assert("url" in kb[0][0], "row 0 button is a URL button");
  assert("callback_data" in kb[kb.length - 1][0], "last row is callbacks");
});

await runScenario("Keyboard for failed adds → cart hidden, search rows + callback row", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: false,
    lines: [
      { description: "Item A", quantityOrdered: 1, productUrl: "https://www.amazon.com/dp/B0AAAAAAAA", added: false },
      { description: "Item B", quantityOrdered: 1, productUrl: "https://www.amazon.com/dp/B0BBBBBBBB", added: false },
    ],
  });
  const kb = buildCartReadyKeyboard({ agentTaskId: "task-noc", links });
  // 2 search rows + 1 callback row = 3 (no cart link since nothing added)
  assert(kb.length === 3, `3 rows (got ${kb.length})`);
  assert("url" in kb[0][0] && kb[0][0].text.startsWith("🔍"), "row 0: search for Item A");
  assert("url" in kb[1][0] && kb[1][0].text.startsWith("🔍"), "row 1: search for Item B");
  const lastRow = kb[2];
  const callbacks = lastRow.map((b) => ("callback_data" in b ? b.callback_data : ""));
  assert(callbacks.includes("website_cart_approve:task-noc"), "approve callback wired");
  assert(callbacks.includes("website_cart_cancel:task-noc"), "cancel callback wired");
});

await runScenario("Keyboard with no URLs → just callback row", () => {
  const links = buildCartLinks({
    supplierWebsite: null,
    supplierName: "FreshCo",
    hasCredentials: false,
    lines: [{ description: "x", quantityOrdered: 1, productUrl: null }],
  });
  const kb = buildCartReadyKeyboard({ agentTaskId: "t-1", links });
  assert(kb.length === 1, "single row when no URLs");
  assert(
    kb[0].every((b) => "callback_data" in b),
    "row is callback-only"
  );
});

// ── Failure case: agent couldn't add anything ──────────────────────
await runScenario("All lines failed → product link replaced with search button", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: false,
    lines: [
      {
        description: "Espresso Machine Cleaner",
        quantityOrdered: 1,
        productUrl: "https://www.amazon.com/Bad-Product/dp/B005YJZE2I",
        added: false,
      },
    ],
  });
  // The user's lived experience: agent landed on Amazon's 404 dog
  // page, ATC button not found. Sending them to the SAME broken
  // product URL would just reproduce the bug.
  assert(links.productButtons.length === 1, "still shows a button");
  assert(
    links.productButtons[0].text.startsWith("🔍"),
    `now a search button: ${links.productButtons[0].text}`
  );
  assert(
    links.productButtons[0].url.includes("/s?k=Espresso"),
    `search URL by item name: ${links.productButtons[0].url}`
  );
  assert(
    !links.productButtons[0].url.includes("/dp/B005YJZE2I"),
    "broken product URL is NOT linked"
  );
});

await runScenario("All lines failed + credentials set → still no open-cart", () => {
  // Even with cookies, if nothing was added the cart is empty in
  // the user's account too. Don't show open-cart.
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: true,
    lines: [
      {
        description: "Failed Item",
        quantityOrdered: 1,
        productUrl: "https://www.amazon.com/dp/B0BAD00000",
        added: false,
      },
    ],
  });
  assert(links.openCartUrl === null, "no open-cart when nothing was added");
  assert(
    links.productButtons[0].text.startsWith("🔍"),
    "still falls back to search"
  );
});

await runScenario(
  "Mixed success/failure → cart link shown, only failures get search buttons",
  () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: false,
    lines: [
      {
        description: "Good Item",
        quantityOrdered: 1,
        productUrl: "https://www.amazon.com/dp/B0GOOD0000",
        added: true,
      },
      {
        description: "Bad Item",
        quantityOrdered: 1,
        productUrl: "https://www.amazon.com/dp/B0BAD00000",
        added: false,
      },
    ],
  });
  // Cart link IS shown (at least one success).
  assert(
    links.openCartUrl === "https://www.amazon.com/gp/cart/view.html",
    "cart link shown since 1 item was added"
  );
  // Only the FAILED item gets a search button. Successful item
  // doesn't get a redundant "here's the URL you sent" button.
  assert(
    links.productButtons.length === 1,
    `only the failed item has a button (got ${links.productButtons.length})`
  );
  const badBtn = links.productButtons[0];
  assert(badBtn.text.startsWith("🔍 Search"), "failed item has search button");
  assert(
    badBtn.url.includes("/s?k=Bad%20Item"),
    `failure → /s?k= link (got: ${badBtn.url})`
  );
  assert(
    !links.productButtons.some((b) => b.url.includes("/dp/B0GOOD0000")),
    "successful item's /dp/ URL is NOT repeated back to user"
  );
});

// ── Known-supplier lookup ──────────────────────────────────────────
await runScenario("lookupKnownSupplierWebsite handles common brands", async () => {
  const { lookupKnownSupplierWebsite } = await import(
    "../src/modules/operator-bot/agent.ts"
  );
  assert(lookupKnownSupplierWebsite("Amazon") === "https://www.amazon.com", "Amazon");
  assert(lookupKnownSupplierWebsite("amazon") === "https://www.amazon.com", "case-insensitive");
  assert(lookupKnownSupplierWebsite("LCBO") === "https://www.lcbo.com", "LCBO");
  assert(lookupKnownSupplierWebsite("lcbo") === "https://www.lcbo.com", "lcbo lowercase");
  assert(lookupKnownSupplierWebsite("Costco") === "https://www.costco.com", "Costco");
  assert(lookupKnownSupplierWebsite("Walmart") === "https://www.walmart.com", "Walmart");
  assert(lookupKnownSupplierWebsite("Sysco") === "https://shop.sysco.com", "Sysco");
  assert(lookupKnownSupplierWebsite("Home Depot") === "https://www.homedepot.com", "Home Depot");
  assert(lookupKnownSupplierWebsite("UnknownBrand") === null, "unknown → null");
  assert(lookupKnownSupplierWebsite("") === null, "empty → null");
});

// ── buildDeepCartAddUrl — one-tap multi-item cart fill ────────────
const { buildDeepCartAddUrl } = await import(
  "../src/modules/automation/cart-links.ts"
);

await runScenario("buildDeepCartAddUrl: Amazon single ASIN → populates URL", async () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    lines: [
      {
        description: "Urnex Cafiza Espresso Cleaning Tablets",
        quantityOrdered: 3,
        productUrl: "https://www.amazon.com/dp/B005YJZE2I",
      },
    ],
  });
  assert(link != null, "returns a link");
  assert(link?.kind === "populates", "kind is 'populates'");
  assert(/ASIN\.1=B005YJZE2I/.test(link?.url ?? ""), "ASIN in URL");
  assert(/Quantity\.1=3/.test(link?.url ?? ""), "quantity in URL");
  assert(/gp\/aws\/cart\/add\.html/.test(link?.url ?? ""), "add.html endpoint");
  assert(/Add 3 to Amazon cart/i.test(link?.label ?? ""), "label includes qty");
});

await runScenario("buildDeepCartAddUrl: Amazon multi-item → merged URL", async () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: null,
    supplierName: "Amazon",
    lines: [
      { description: "Tablets", quantityOrdered: 2, productUrl: "https://www.amazon.com/dp/B005YJZE2I" },
      { description: "Cups", quantityOrdered: 5, productUrl: "https://www.amazon.com/gp/product/B08TESTAAA" },
      { description: "Lids", quantityOrdered: 5, productUrl: "https://www.amazon.com/dp/B09TESTBBB" },
    ],
  });
  assert(link != null, "returns a link");
  assert(/ASIN\.1=B005YJZE2I&Quantity\.1=2/.test(link?.url ?? ""), "line 1 merged");
  assert(/ASIN\.2=B08TESTAAA&Quantity\.2=5/.test(link?.url ?? ""), "line 2 merged");
  assert(/ASIN\.3=B09TESTBBB&Quantity\.3=5/.test(link?.url ?? ""), "line 3 merged");
  assert(/Add 3 items to Amazon cart/i.test(link?.label ?? ""), "label shows count");
});

await runScenario("buildDeepCartAddUrl: Amazon locale (amazon.ca) preserved", async () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://www.amazon.ca",
    supplierName: "Amazon",
    lines: [
      { description: "Item", quantityOrdered: 1, productUrl: "https://www.amazon.ca/dp/B0CATESTXY" },
    ],
  });
  assert(link != null, "returns link");
  assert(/amazon\.ca\/gp\/aws/.test(link?.url ?? ""), "stays on .ca");
});

await runScenario("buildDeepCartAddUrl: Amazon with no ASINs → storefront", async () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    lines: [
      { description: "Mystery item", quantityOrdered: 1, productUrl: null },
    ],
  });
  assert(link != null, "returns link");
  assert(link?.kind === "product_page", "falls back to product_page");
  assert(/amazon\.com/.test(link?.url ?? ""), "points at storefront");
});

await runScenario("buildDeepCartAddUrl: Walmart item-id extraction", async () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://www.walmart.com",
    supplierName: "Walmart",
    lines: [
      { description: "Oat Milk", quantityOrdered: 3, productUrl: "https://www.walmart.com/ip/Oat-Milk/5265" },
      { description: "Coffee", quantityOrdered: 1, productUrl: "https://www.walmart.com/ip/Coffee-Whatever/4728" },
    ],
  });
  assert(link != null, "returns link");
  assert(link?.kind === "populates", "populates");
  assert(/affil\.walmart\.com\/cart\/addToCart/.test(link?.url ?? ""), "affil URL");
  assert(/items=5265_3,4728_1/.test(link?.url ?? ""), "items joined with qty");
});

await runScenario("buildDeepCartAddUrl: generic supplier with product URL → product_page", async () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://www.lcbo.com",
    supplierName: "LCBO",
    lines: [
      { description: "Wine", quantityOrdered: 6, productUrl: "https://www.lcbo.com/en/product/123" },
    ],
  });
  assert(link != null, "returns link");
  assert(link?.kind === "product_page", "product_page kind");
  assert(/lcbo\.com/.test(link?.url ?? ""), "LCBO URL");
});

await runScenario("buildDeepCartAddUrl: generic supplier no URL → home", async () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://example.com",
    supplierName: "Example",
    lines: [
      { description: "Something", quantityOrdered: 1, productUrl: null },
    ],
  });
  assert(link != null, "returns link");
  assert(link?.url === "https://example.com", "opens home");
  assert(link?.kind === "product_page", "product_page");
});

await runScenario("buildDeepCartAddUrl: empty lines → null", async () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    lines: [],
  });
  assert(link === null, "null for empty lines");
});

await runScenario("buildDeepCartAddUrl: no website + no URL on lines → null", async () => {
  const link = buildDeepCartAddUrl({
    supplierWebsite: null,
    supplierName: "Mystery Supplier",
    lines: [{ description: "Thing", quantityOrdered: 1, productUrl: null }],
  });
  assert(link === null, "null when nothing to link to");
});

// ── Summary ────────────────────────────────────────────────────────
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\n🎉 ALL CART-LINK TESTS PASSED");
