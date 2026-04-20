// Tests the pre-LLM order sniffer, the Amazon error-page detector,
// the age-gate text matcher, and the expanded known-supplier lookup.
//
// These are all pure functions so they run without a DB or browser —
// cheap to keep green.

const { sniffOrderIntent, findUrl } = await import(
  "../src/modules/operator-bot/order-sniffer.ts"
);
const { lookupKnownSupplierWebsite } = await import(
  "../src/modules/operator-bot/agent.ts"
);
const { detectAmazonErrorFromState } = await import(
  "../src/modules/automation/sites/amazon.ts"
);
const { isAgeGateConfirmText } = await import(
  "../src/modules/automation/sites/generic.ts"
);

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

// ── Mock fetch globally for any product-metadata calls the sniffer
//    triggers when a URL has no slug. Amazon URLs now skip the
//    direct fetch and go straight to microlink.io, so the mock needs
//    to handle BOTH the direct URL pattern AND the microlink API
//    shape `api.microlink.io/?url=<encoded>`.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request) => {
  const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : String(url);

  // Microlink API call — return the real product title regardless of
  // which upstream URL is encoded in the query. Tests only care that
  // SOME title comes back.
  if (href.startsWith("https://api.microlink.io")) {
    return new Response(
      JSON.stringify({
        status: "success",
        data: {
          title: "Urnex Rinza Alkaline Formula Milk Frother Cleaner, 33.6 Ounce",
          description: "For use on milk systems of coffee machines",
          image: { url: null },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Direct fetch of a specific ASIN — return HTML with og:title.
  if (href.includes("/dp/B000FDL68W")) {
    return new Response(
      `<!doctype html><html><head>
        <meta property="og:title" content="Urnex Rinza Alkaline Formula Milk Frother Cleaner, 33.6 Ounce">
      </head><body></body></html>`,
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }

  // Any other URL — return empty HTML so the sniffer falls back.
  if (href.startsWith("http")) {
    return new Response("<!doctype html><html><head><title></title></head></html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  }
  return realFetch(url);
}) as typeof fetch;

// ── Sniffer: URL + order verb ──────────────────────────────────────
await runScenario("Sniffer: URL + 'order this' → single Amazon order", async () => {
  const r = await sniffOrderIntent("order this https://www.amazon.com/Urnex-Cafiza/dp/B005YJZE2I");
  if (!r) {
    assert(false, "sniffer returned null for URL+verb");
    return;
  }
  assert(r.orders.length === 1, "one order");
  assert(r.orders[0].supplierName === "Amazon", `supplier=Amazon (got ${r.orders[0].supplierName})`);
  assert(
    r.orders[0].websiteUrl === "https://www.amazon.com/Urnex-Cafiza/dp/B005YJZE2I",
    `URL preserved (got ${r.orders[0].websiteUrl})`
  );
  assert(r.orders[0].quantity === 1, "default qty 1");
  assert(
    /urnex cafiza/i.test(r.orders[0].itemName),
    `item name from URL slug (got ${r.orders[0].itemName})`
  );
});

await runScenario("Sniffer: URL + 'add to cart' → Amazon order", async () => {
  const r = await sniffOrderIntent("add this to my cart https://www.amazon.ca/dp/B005YJZE2I");
  if (!r) {
    assert(false, "sniffer returned null");
    return;
  }
  assert(r.orders.length === 1, "one order");
  assert(r.orders[0].supplierName === "Amazon", "supplier is Amazon");
});

// ── THE BUG from the screenshot ────────────────────────────────────
// User pasted `amazon.ca/dp/B000FDL68W?ref=...` (Amazon's old URL
// format, no product-name slug) with "add three in the cart". Before
// the fix, sniffer produced itemName="Item from Amazon" which became
// the search query when the dog page fallback fired. After the fix,
// we fetch the page and lift the real product title.
await runScenario(
  "Sniffer: URL with no slug + quantity word → og:title enriches item name",
  async () => {
    const r = await sniffOrderIntent(
      "add three in the cart https://www.amazon.ca/dp/B000FDL68W?ref=sspa_dk_detail_0"
    );
    if (!r) {
      assert(false, "sniffer returned null for the dp-only URL message");
      return;
    }
    const o = r.orders[0];
    assert(o.quantity === 3, `qty parsed from 'three' (got ${o.quantity})`);
    assert(o.supplierName === "Amazon", "supplier detected from hostname");
    assert(
      /urnex rinza alkaline formula milk frother cleaner/i.test(o.itemName),
      `item name came from og:title, not 'Item from Amazon' (got: ${o.itemName})`
    );
    assert(!/^item from /i.test(o.itemName), "NOT the generic fallback");
  }
);

// ── Sniffer: "add N X from LCBO" (the original bug) ────────────────
await runScenario("Sniffer: 'add 5 bottles of jp wisers from lcbo'", async () => {
  const r = await sniffOrderIntent("add 5 bottles of jp wisers from lcbo");
  if (!r) {
    assert(false, "sniffer returned null for the lcbo bug message");
    return;
  }
  assert(r.orders.length === 1, `one order (got ${r.orders.length})`);
  const o = r.orders[0];
  assert(o.quantity === 5, `qty=5 (got ${o.quantity})`);
  assert(/jp wisers/i.test(o.itemName), `item preserved (got ${o.itemName})`);
  assert(o.supplierName.toLowerCase() === "lcbo", `supplier=lcbo (got ${o.supplierName})`);
  assert(o.websiteUrl === "", "no URL");
});

await runScenario(
  "Sniffer: MULTI-item 'add 5 bottles of jp wisers and 3 box of bella terra in my cart in lcbo website'",
  async () => {
    const r = await sniffOrderIntent(
      "add 5 bottles of jp wisers and 3 box of bella terra in my cart in lcbo website"
    );
    if (!r) {
      assert(false, "multi-item bug message returned null");
      return;
    }
    assert(r.orders.length === 2, `two orders (got ${r.orders.length})`);
    const [a, b] = r.orders;
    assert(a.quantity === 5 && /wisers/i.test(a.itemName), "first: 5 jp wisers");
    assert(b.quantity === 3 && /bella terra/i.test(b.itemName), "second: 3 bella terra");
    assert(
      a.supplierName.toLowerCase() === "lcbo" &&
        b.supplierName.toLowerCase() === "lcbo",
      "both go to LCBO"
    );
  }
);

await runScenario("Sniffer: 'order 12 oz coffee from amazon'", async () => {
  const r = await sniffOrderIntent("order 12 oz coffee from amazon");
  if (!r) {
    assert(false, "sniffer returned null");
    return;
  }
  assert(r.orders.length === 1, "one order");
  assert(r.orders[0].quantity === 12, "qty=12");
  assert(r.orders[0].supplierName.toLowerCase() === "amazon", "supplier=amazon");
});

await runScenario("Sniffer: 'buy 3 cases of oat milk at costco'", async () => {
  const r = await sniffOrderIntent("buy 3 cases of oat milk at costco");
  if (!r) {
    assert(false, "sniffer returned null");
    return;
  }
  assert(r.orders.length === 1, "one order");
  assert(/oat milk/i.test(r.orders[0].itemName), "item=oat milk");
  assert(r.orders[0].supplierName.toLowerCase() === "costco", "supplier=costco");
});

// ── Sniffer: should NOT match (fall through to LLM) ────────────────
await runScenario("Sniffer: greeting → null", async () => {
  assert((await sniffOrderIntent("hi")) === null, "'hi' → null");
  assert((await sniffOrderIntent("how are you")) === null, "'how are you' → null");
  assert((await sniffOrderIntent("what do I have")) === null, "'what do I have' → null");
});

await runScenario("Sniffer: stock report (no supplier, no URL) → null", async () => {
  assert((await sniffOrderIntent("oat milk 2 left")) === null, "stock status → null");
  assert(
    (await sniffOrderIntent("we have 5 bags of coffee")) === null,
    "we have N X → null"
  );
});

await runScenario("Sniffer: order intent but UNKNOWN supplier → null (falls to LLM)", async () => {
  assert(
    (await sniffOrderIntent("order 5 widgets from bobs random mart")) === null,
    "unknown supplier → null"
  );
});

await runScenario("Sniffer: 'approve' / 'cancel' → null (those aren't orders)", async () => {
  assert((await sniffOrderIntent("approve")) === null, "'approve' → null");
  assert((await sniffOrderIntent("cancel")) === null, "'cancel' → null");
  assert((await sniffOrderIntent("nvm")) === null, "'nvm' → null");
});

// ── findUrl ────────────────────────────────────────────────────────
await runScenario("findUrl extracts URLs from messy text", () => {
  assert(
    findUrl("order this https://www.amazon.com/dp/B005YJZE2I please") ===
      "https://www.amazon.com/dp/B005YJZE2I",
    "URL inside a sentence"
  );
  assert(
    findUrl("here it is: https://a.co/d/abc?ref=foo") ===
      "https://a.co/d/abc?ref=foo",
    "URL with query string"
  );
  assert(
    findUrl("from amzn.to/3xH8Wfp thanks") === "https://amzn.to/3xH8Wfp",
    "shortlink gets https prefix"
  );
  assert(findUrl("just text") === null, "no URL → null");
});

// ── Known-supplier lookup (expanded + smart matching) ─────────────
await runScenario("lookupKnownSupplierWebsite: common brand variants", () => {
  // Original list
  assert(lookupKnownSupplierWebsite("Amazon") === "https://www.amazon.com", "Amazon");
  assert(lookupKnownSupplierWebsite("lcbo") === "https://www.lcbo.com", "lcbo");
  // New additions
  assert(lookupKnownSupplierWebsite("US Foods") === "https://www.usfoods.com", "US Foods");
  assert(
    lookupKnownSupplierWebsite("Restaurant Depot") === "https://www.restaurantdepot.com",
    "Restaurant Depot"
  );
  assert(lookupKnownSupplierWebsite("GFS") === "https://gfs.com", "GFS acronym");
  assert(
    lookupKnownSupplierWebsite("Gordon Food Service") === "https://gfs.com",
    "Gordon Food Service → gfs"
  );
  assert(lookupKnownSupplierWebsite("BevMo") === "https://www.bevmo.com", "BevMo");
  assert(lookupKnownSupplierWebsite("Total Wine") === "https://www.totalwine.com", "Total Wine");
  assert(lookupKnownSupplierWebsite("SAQ") === "https://www.saq.com", "SAQ");
  assert(
    lookupKnownSupplierWebsite("Sam's Club") === "https://www.samsclub.com",
    "Sam's Club with apostrophe"
  );
  assert(
    lookupKnownSupplierWebsite("Trader Joe's") === "https://www.traderjoes.com",
    "Trader Joe's"
  );
});

await runScenario("lookupKnownSupplierWebsite: smart matching on variants", () => {
  // Leading "the"
  assert(
    lookupKnownSupplierWebsite("the LCBO") === "https://www.lcbo.com",
    "'the LCBO' matches"
  );
  // Trailing noise words
  assert(
    lookupKnownSupplierWebsite("LCBO store") === "https://www.lcbo.com",
    "'LCBO store' matches"
  );
  assert(
    lookupKnownSupplierWebsite("Costco website") === "https://www.costco.com",
    "'Costco website' matches"
  );
  assert(
    lookupKnownSupplierWebsite("my Walmart cart") === "https://www.walmart.com",
    "'my Walmart cart' matches"
  );
  // First-token fallback
  assert(
    lookupKnownSupplierWebsite("Amazon Prime") === "https://www.amazon.com",
    "'Amazon Prime' → amazon"
  );
  // Trailing punctuation
  assert(
    lookupKnownSupplierWebsite("LCBO.") === "https://www.lcbo.com",
    "'LCBO.' strips trailing dot"
  );
});

await runScenario("lookupKnownSupplierWebsite: unknowns return null", () => {
  assert(lookupKnownSupplierWebsite("Bobs Mystery Mart") === null, "unknown brand → null");
  assert(lookupKnownSupplierWebsite("") === null, "empty → null");
  assert(lookupKnownSupplierWebsite("   ") === null, "whitespace → null");
});

// ── Amazon error detection ─────────────────────────────────────────
await runScenario("detectAmazonErrorFromState: English error page", () => {
  assert(
    detectAmazonErrorFromState({
      url: "https://www.amazon.com/errors/validateCaptcha",
      title: "Amazon.com",
      bodyText: "Sorry! We couldn't find that page. Try searching or go to Amazon's home page.",
    }),
    "error URL path"
  );
  assert(
    detectAmazonErrorFromState({
      url: "https://www.amazon.com/Dogs-of-Amazon",
      title: "Dogs of Amazon - Page Not Found",
      bodyText: "We're sorry. The web address you entered is not a functioning page on our site.",
    }),
    "title contains 'page not found'"
  );
});

await runScenario("detectAmazonErrorFromState: French error page (amazon.ca)", () => {
  // Exactly what the user hit in the screenshot.
  assert(
    detectAmazonErrorFromState({
      url: "https://www.amazon.ca/some/broken/path",
      title: "Amazon.ca",
      bodyText:
        "Nous sommes désolés, une erreur s'est produite. Veuillez s'il vous plaît retourner sur la page précédente ou accéder à la page d'accueil d'Amazon.ca.",
    }),
    "French error copy triggers detection"
  );
});

await runScenario("detectAmazonErrorFromState: real product page → false", () => {
  assert(
    !detectAmazonErrorFromState({
      url: "https://www.amazon.com/Urnex-Cafiza/dp/B005YJZE2I",
      title: "Urnex Cafiza Espresso Machine Cleaning Tablets - Amazon.com",
      bodyText: "Urnex Cafiza is a professional espresso machine cleaner. Add to Cart. Buy Now.",
    }),
    "happy product page → not error"
  );
});

await runScenario("detectAmazonErrorFromState: search page → false", () => {
  assert(
    !detectAmazonErrorFromState({
      url: "https://www.amazon.com/s?k=coffee",
      title: "Amazon.com: coffee",
      bodyText: "Results for coffee. Sponsored. Organic results follow.",
    }),
    "search page → not error"
  );
});

// ── Age-gate text matching ─────────────────────────────────────────
await runScenario("isAgeGateConfirmText recognises confirmation text", () => {
  assert(isAgeGateConfirmText("Yes, I'm 21+"), "Yes, I'm 21+");
  assert(isAgeGateConfirmText("I am 19 or older"), "I am 19 or older");
  assert(isAgeGateConfirmText("I am of legal age"), "I am of legal age");
  assert(isAgeGateConfirmText("I am 21 or older"), "I am 21 or older");
  assert(isAgeGateConfirmText("Enter Site"), "Enter Site");
  assert(isAgeGateConfirmText("Confirm age"), "Confirm age");
  assert(isAgeGateConfirmText("19+"), "19+");
  assert(isAgeGateConfirmText("21+"), "21+");
});

await runScenario("isAgeGateConfirmText rejects denials + unrelated text", () => {
  assert(!isAgeGateConfirmText("No, I'm under 21"), "denial No, I'm under");
  assert(!isAgeGateConfirmText("No, I'm not"), "denial No, I'm not");
  assert(!isAgeGateConfirmText("Exit"), "exit");
  assert(!isAgeGateConfirmText("Add to Cart"), "Add to Cart — unrelated");
  assert(!isAgeGateConfirmText("Sign in"), "Sign in — unrelated");
  assert(!isAgeGateConfirmText(""), "empty → false");
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
console.log("\n🎉 ALL SNIFFER/ADAPTER-HELPER TESTS PASSED");
