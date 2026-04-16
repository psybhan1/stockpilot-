// Tests the cart-link helper that powers the post-cart-ready Telegram
// message. The user complaint was: "the cart adds, but I have no way
// to open it." This proves we now produce real tap-targets:
//
//   - For Amazon URLs we extract the ASIN and build a deep
//     /gp/aws/cart/add.html link that adds the items to the USER's
//     own logged-in Amazon cart in one tap (works WITHOUT saved
//     cookies — Amazon associates the cart with the manager's own
//     session, not the agent's).
//   - For any supplier we always include an "open cart" / "open
//     supplier" URL button as a fallback.
//   - Locale handling: a .ca supplier yields amazon.ca cart link.
//   - Generic non-Amazon site falls back gracefully.

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

async function runScenario(name: string, fn: () => void) {
  console.log(`\n━━ ${name}`);
  try {
    fn();
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`    ❌ THREW: ${msg}`);
  }
}

// ── ASIN extraction ────────────────────────────────────────────────
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

// ── buildCartLinks: Amazon ─────────────────────────────────────────
await runScenario("Amazon URL with ASIN → both buttons populated", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
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
  assert(links.openCartLabel === "🛒 Open Amazon cart", "Amazon-specific label");
  assert(
    links.addToMyCartUrl?.includes("ASIN.1=B005YJZE2I") &&
      links.addToMyCartUrl?.includes("Quantity.1=3") &&
      links.addToMyCartUrl?.includes("/gp/aws/cart/add.html"),
    `add-to-my-cart URL has ASIN + qty: ${links.addToMyCartUrl}`
  );
});

await runScenario("Amazon multi-line PO gets numbered ASINs", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    lines: [
      {
        description: "Item A",
        quantityOrdered: 2,
        productUrl: "https://www.amazon.com/dp/B0AAAAAAAA",
      },
      {
        description: "Item B",
        quantityOrdered: 5,
        productUrl: "https://www.amazon.com/dp/B0BBBBBBBB",
      },
    ],
  });
  const url = links.addToMyCartUrl ?? "";
  assert(url.includes("ASIN.1=B0AAAAAAAA") && url.includes("Quantity.1=2"), "line 1 in URL");
  assert(url.includes("ASIN.2=B0BBBBBBBB") && url.includes("Quantity.2=5"), "line 2 in URL");
});

await runScenario("Amazon locale: .ca supplier → amazon.ca cart link", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.ca",
    supplierName: "Amazon",
    lines: [
      { description: "x", quantityOrdered: 1, productUrl: "https://www.amazon.ca/dp/B005YJZE2I" },
    ],
  });
  assert(
    links.openCartUrl === "https://www.amazon.ca/gp/cart/view.html",
    `Canadian storefront preserved: ${links.openCartUrl}`
  );
  assert(
    links.addToMyCartUrl?.startsWith("https://www.amazon.ca/gp/aws/cart/add.html"),
    "add-to-cart URL is .ca too"
  );
});

await runScenario("Amazon shortlink (a.co) without ASIN → only open-cart button", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    lines: [
      { description: "thing", quantityOrdered: 1, productUrl: "https://a.co/d/abc123" },
    ],
  });
  assert(links.openCartUrl === "https://www.amazon.com/gp/cart/view.html", "open-cart URL set");
  assert(links.addToMyCartUrl === null, "no add-to-my-cart URL (no ASIN recoverable)");
});

await runScenario("Amazon detected by supplier name even without website", () => {
  const links = buildCartLinks({
    supplierWebsite: null,
    supplierName: "Amazon",
    lines: [{ description: "x", quantityOrdered: 1, productUrl: null }],
  });
  assert(links.isAmazon === true, "name-based Amazon detection");
  assert(
    links.openCartUrl === "https://www.amazon.com/gp/cart/view.html",
    "fell back to .com root"
  );
});

// ── buildCartLinks: generic ─────────────────────────────────────────
await runScenario("Generic non-Amazon supplier → home-page open-cart only", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.costco.com",
    supplierName: "Costco",
    lines: [
      {
        description: "Oat Milk",
        quantityOrdered: 4,
        productUrl: "https://www.costco.com/oat-milk.product.100634122.html",
      },
    ],
  });
  assert(links.isAmazon === false, "not Amazon");
  assert(links.openCartUrl === "https://www.costco.com", "open-cart URL is home page");
  assert(links.openCartLabel === "🌐 Open Costco", "generic label uses supplier name");
  assert(links.addToMyCartUrl === null, "no add-to-cart URL for generic");
});

await runScenario("Generic supplier with no website → no buttons at all", () => {
  const links = buildCartLinks({
    supplierWebsite: null,
    supplierName: "FreshCo",
    lines: [{ description: "x", quantityOrdered: 1, productUrl: null }],
  });
  assert(links.openCartUrl === null, "no open-cart URL");
  assert(links.addToMyCartUrl === null, "no add-to-cart URL");
});

// ── buildCartReadyKeyboard: button shape ────────────────────────────
await runScenario("Keyboard puts URL row first, then approve/cancel", () => {
  const links = buildCartLinks({
    supplierWebsite: "https://www.amazon.com",
    supplierName: "Amazon",
    lines: [
      {
        description: "x",
        quantityOrdered: 1,
        productUrl: "https://www.amazon.com/dp/B005YJZE2I",
      },
    ],
  });
  const kb = buildCartReadyKeyboard({ agentTaskId: "task-123", links });
  assert(kb.length === 2, `2 rows (got ${kb.length})`);
  // Row 0: URL buttons
  assert(kb[0].length === 2, "URL row has 2 buttons");
  assert(
    kb[0].every((b) => "url" in b),
    "all URL-row buttons are url-type"
  );
  // Row 1: callback buttons
  assert(kb[1].length === 2, "callback row has 2 buttons");
  assert(
    kb[1].every((b) => "callback_data" in b),
    "all callback-row buttons are callback-type"
  );
  const callbacks = kb[1].map((b) => ("callback_data" in b ? b.callback_data : ""));
  assert(callbacks.includes("website_cart_approve:task-123"), "approve callback wired");
  assert(callbacks.includes("website_cart_cancel:task-123"), "cancel callback wired");
});

await runScenario("Keyboard with no URLs → just the callback row", () => {
  const links = buildCartLinks({
    supplierWebsite: null,
    supplierName: "FreshCo",
    lines: [{ description: "x", quantityOrdered: 1, productUrl: null }],
  });
  const kb = buildCartReadyKeyboard({ agentTaskId: "t-1", links });
  assert(kb.length === 1, "single row when no URLs");
  assert(
    kb[0].every((b) => "callback_data" in b),
    "row is callback-only"
  );
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
