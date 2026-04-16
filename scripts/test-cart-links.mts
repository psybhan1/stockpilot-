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
await runScenario("Amazon + credentials → open-cart button, NO product buttons needed", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: true,
    lines: [
      {
        description: "Urnex Cafiza",
        quantityOrdered: 3,
        productUrl: "https://www.amazon.com/Urnex-Cafiza/dp/B005YJZE2I",
      },
    ],
  });
  assert(links.isAmazon === true, "detected Amazon");
  assert(
    links.openCartUrl === "https://www.amazon.com/gp/cart/view.html",
    `open-cart URL: ${links.openCartUrl}`
  );
  assert(links.openCartLabel === "🛒 Open my Amazon cart", "Amazon label");
  // We still build product buttons so the test below passes — the
  // open-cart button is the affordant choice but having both is fine.
  assert(links.productButtons.length === 1, "1 product button (alternate path)");
});

// ── Amazon WITHOUT credentials ─────────────────────────────────────
await runScenario("Amazon WITHOUT credentials → product-page buttons, NO open-cart", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: false,
    lines: [
      {
        description: "Urnex Cafiza",
        quantityOrdered: 3,
        productUrl: "https://www.amazon.com/Urnex-Cafiza/dp/B005YJZE2I",
      },
    ],
  });
  // No open-cart URL — without cookies, opening the cart shows an
  // empty cart in the user's session, which is what they complained
  // about. Better to show product links and let them tap through.
  assert(
    links.openCartUrl === null,
    `no open-cart URL (got: ${links.openCartUrl}) — would mislead without cookies`
  );
  assert(links.productButtons.length === 1, "1 product button");
  assert(
    links.productButtons[0].url === "https://www.amazon.com/dp/B005YJZE2I",
    `product URL: ${links.productButtons[0].url}`
  );
  assert(
    links.productButtons[0].text.startsWith("📦"),
    `product label has emoji: ${links.productButtons[0].text}`
  );
  assert(
    links.productButtons[0].text.includes("Urnex"),
    "product label includes name"
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

await runScenario("Amazon multi-line PO → up to 3 product buttons (cap)", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: false,
    lines: [
      { description: "Item A", quantityOrdered: 1, productUrl: "https://www.amazon.com/dp/B0AAAAAAAA" },
      { description: "Item B", quantityOrdered: 1, productUrl: "https://www.amazon.com/dp/B0BBBBBBBB" },
      { description: "Item C", quantityOrdered: 1, productUrl: "https://www.amazon.com/dp/B0CCCCCCCC" },
      { description: "Item D", quantityOrdered: 1, productUrl: "https://www.amazon.com/dp/B0DDDDDDDD" },
    ],
  });
  assert(links.productButtons.length === 3, "capped at 3 buttons");
  assert(
    !links.productButtons.some((b) => b.url.includes("B0DDDDDDDD")),
    "4th item NOT in buttons"
  );
});

await runScenario("Long product names get truncated for button labels", () => {
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
      },
    ],
  });
  const text = links.productButtons[0].text;
  assert(text.length < 30, `label is short (${text.length} chars: ${text})`);
  assert(text.endsWith("…"), `label ellipsis-truncated: ${text}`);
});

await runScenario("Amazon locale: .ca supplier → amazon.ca product links", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.ca",
    supplierName: "Amazon",
    hasCredentials: true,
    lines: [
      { description: "x", quantityOrdered: 1, productUrl: "https://www.amazon.ca/dp/B005YJZE2I" },
    ],
  });
  assert(
    links.openCartUrl === "https://www.amazon.ca/gp/cart/view.html",
    `Canadian storefront: ${links.openCartUrl}`
  );
  assert(
    links.productButtons[0].url === "https://www.amazon.ca/dp/B005YJZE2I",
    `Canadian product URL: ${links.productButtons[0].url}`
  );
});

await runScenario("Amazon shortlink without ASIN → search-by-name fallback", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: false,
    lines: [
      { description: "thing", quantityOrdered: 1, productUrl: "https://a.co/d/abc123" },
    ],
  });
  // Without an ASIN we can't link to the product page, but we can
  // still send the user to a search results page for the item name.
  // Better than nothing.
  assert(links.productButtons.length === 1, "search-by-name button");
  assert(
    links.productButtons[0].text.startsWith("🔍"),
    "is a search button"
  );
  assert(
    links.productButtons[0].url.includes("/s?k=thing"),
    "search URL by name"
  );
  assert(links.openCartUrl === null, "no open-cart (no creds)");
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
await runScenario("Keyboard with credentials → open-cart row + product alt + callbacks", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: true,
    lines: [
      { description: "x", quantityOrdered: 1, productUrl: "https://www.amazon.com/dp/B005YJZE2I" },
    ],
  });
  const kb = buildCartReadyKeyboard({ agentTaskId: "task-creds", links });
  // open-cart row + product row + callback row = 3
  assert(kb.length === 3, `3 rows (got ${kb.length})`);
  assert(kb[0][0].text === "🛒 Open my Amazon cart", "row 0 is open-cart");
  assert("url" in kb[0][0], "row 0 button is a URL button");
  assert("callback_data" in kb[kb.length - 1][0], "last row is callbacks");
});

await runScenario("Keyboard no-credentials Amazon → product rows + callback row", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    hasCredentials: false,
    lines: [
      { description: "Item A", quantityOrdered: 1, productUrl: "https://www.amazon.com/dp/B0AAAAAAAA" },
      { description: "Item B", quantityOrdered: 1, productUrl: "https://www.amazon.com/dp/B0BBBBBBBB" },
    ],
  });
  const kb = buildCartReadyKeyboard({ agentTaskId: "task-noc", links });
  // 2 product rows + 1 callback row = 3
  assert(kb.length === 3, `3 rows (got ${kb.length})`);
  assert("url" in kb[0][0] && kb[0][0].text.includes("Item A"), "row 0: product A");
  assert("url" in kb[1][0] && kb[1][0].text.includes("Item B"), "row 1: product B");
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

await runScenario("Mixed success/failure → success gets product link, failure gets search", () => {
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
  assert(links.productButtons.length === 2, "both buttons present");
  const goodBtn = links.productButtons.find((b) => b.text.includes("Good Item"));
  const badBtn = links.productButtons.find((b) => b.text.includes("Bad Item"));
  assert(goodBtn?.text.startsWith("📦"), "successful item gets product emoji");
  assert(goodBtn?.url.includes("/dp/B0GOOD0000"), "success → /dp/ link");
  assert(badBtn?.text.startsWith("🔍"), "failed item gets search emoji");
  assert(
    badBtn?.url.includes("/s?k=Bad%20Item"),
    `failure → /s?k= link (got: ${badBtn?.url})`
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
