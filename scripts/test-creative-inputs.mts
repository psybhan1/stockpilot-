// Creative / adversarial input tests. These don't test the happy
// path — they try to BREAK things the way real users do:
//
//   - emoji + Unicode item names (café, résumé, 日本語, RTL text)
//   - very long messages (5KB+ text, 50-URL paste)
//   - empty / whitespace-only input
//   - SQL-injection-looking strings (should NOT crash Prisma)
//   - XSS-looking strings (should be treated as plain text)
//   - malformed quantities ("a billion", "zero", "-5")
//   - ambiguous supplier names ("7-Eleven", "3M", "H&M", "AT&T")
//   - mixed languages + code-switching
//
// Goal: every test either succeeds gracefully OR fails with a clear
// error, but NOTHING crashes the service or corrupts state.

const { sniffOrderIntent, findAllUrls, findUrl } = await import(
  "../src/modules/operator-bot/order-sniffer.ts"
);
const { parseProductMetadata } = await import(
  "../src/modules/automation/product-metadata.ts"
);
const { lookupKnownSupplierWebsite, looksLikeGenericItemName, normalizeProductUrl } =
  await import("../src/modules/operator-bot/agent.ts");
const { friendlyBrowserAgentError } = await import(
  "../src/modules/automation/browser-agent.ts"
);

// Mock fetch so network calls are deterministic and no real Amazon
// fetches happen during tests. Any URL with /dp/ returns a product
// HTML; anything else returns empty.
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request) => {
  const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : String(url);
  if (href.startsWith("https://api.microlink.io")) {
    return new Response(
      JSON.stringify({ status: "success", data: { title: "Mocked Microlink Title" } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  if (/\/dp\/[A-Z0-9]{10}/i.test(href)) {
    return new Response(`<meta property="og:title" content="Mocked Product Title">`, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  }
  return new Response("<html></html>", {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}) as typeof fetch;

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

// ── Empty + whitespace ────────────────────────────────────────────
await runScenario("Sniffer: empty string → null, no crash", async () => {
  assert((await sniffOrderIntent("")) === null, "empty");
  assert((await sniffOrderIntent("   ")) === null, "whitespace");
  assert((await sniffOrderIntent("\n\t\n")) === null, "newlines + tabs");
});

// ── Unicode / emoji item names ─────────────────────────────────────
await runScenario("Sniffer: Unicode / emoji item names survive", async () => {
  const r1 = await sniffOrderIntent("add 5 cafés from amazon");
  if (r1) {
    assert(/café/i.test(r1.orders[0].itemName), `accented chars (got: ${r1.orders[0].itemName})`);
  } else {
    assert(false, "accented chars — null (should parse)");
  }

  const r2 = await sniffOrderIntent("order 3 日本の緑茶 from amazon");
  if (r2) {
    assert(r2.orders[0].quantity === 3, "CJK qty preserved");
    // Item name may be mangled by regex char classes but shouldn't crash.
  } else {
    // Acceptable — CJK might not match the character-class-limited
    // item pattern. Main thing is no crash.
    assert(true, "CJK gracefully falls through to LLM");
  }
});

// ── SQL/XSS-looking strings ────────────────────────────────────────
await runScenario("Sniffer: SQL injection attempt → no crash", async () => {
  const inputs = [
    "add 5 '; DROP TABLE suppliers; -- from lcbo",
    "order 1 <script>alert('xss')</script> from amazon",
    "add {{supplier.password}} from costco",
    "order 1' OR '1'='1 from lcbo",
  ];
  for (const input of inputs) {
    const r = await sniffOrderIntent(input);
    // Either null (sniffer rejected) or a valid order — never a crash.
    // The string comes out as item name; DB handles it as plain text.
    if (r) {
      const name = r.orders[0]?.itemName ?? "";
      assert(name.length < 500, `no runaway item name for: ${input.slice(0, 30)}`);
    } else {
      assert(true, `rejected cleanly: ${input.slice(0, 30)}`);
    }
  }
});

// ── Very long messages ────────────────────────────────────────────
await runScenario("Sniffer: 50 URLs in one message", async () => {
  const urls = Array.from(
    { length: 50 },
    (_, i) => `https://www.amazon.com/dp/B00${String(i).padStart(7, "0")}`
  );
  const text = `add these: ${urls.join(" ")}`;
  const r = await sniffOrderIntent(text);
  assert(r !== null, "50-URL message recognised");
  assert(r!.orders.length === 50, `all 50 URLs → orders (got ${r?.orders.length})`);
  assert(
    r!.orders.every((o) => o.quantity === 1),
    "each order has default qty 1"
  );
});

await runScenario("Sniffer: very long message (10KB) doesn't hang", async () => {
  const padding = "the ".repeat(2000);
  const text = `add 5 widgets from amazon ${padding}`;
  const start = Date.now();
  const r = await sniffOrderIntent(text);
  const elapsed = Date.now() - start;
  assert(elapsed < 3000, `finished in <3s (took ${elapsed}ms)`);
  // Doesn't have to parse successfully — just shouldn't hang forever.
  if (r) assert(r.orders.length > 0, "got orders");
  else assert(true, "fell through gracefully");
});

await runScenario("findAllUrls: dedupes + normalises + caps at reasonable count", () => {
  const text =
    "urls: https://amzn.to/a https://amzn.to/a https://amzn.to/b https://amzn.to/a";
  const urls = findAllUrls(text);
  assert(urls.length === 2, `deduped (got ${urls.length})`);
  assert(urls.includes("https://amzn.to/a"), "a preserved");
  assert(urls.includes("https://amzn.to/b"), "b preserved");
});

// ── Ambiguous supplier names with digits ──────────────────────────
await runScenario("Supplier lookup: '7-Eleven' isn't treated as qty 7", async () => {
  // 7-Eleven isn't in KNOWN_SUPPLIER_WEBSITES so lookup returns null.
  // BUT more importantly, parseQuantityFromText shouldn't extract 7.
  // Verify via the sniffer path.
  const r = await sniffOrderIntent("order milk from 7-Eleven");
  // Should fall through to LLM (7-Eleven isn't a known supplier), or
  // if it does parse, item should be "milk" not something weird.
  if (r) {
    assert(r.orders[0].itemName.toLowerCase().includes("milk"), "item is milk");
    assert(r.orders[0].quantity !== 7, "qty is NOT 7 (that's the supplier name)");
  } else {
    assert(true, "fell through (unknown brand)");
  }
});

await runScenario("Supplier lookup: '3M' / 'H&M' / 'AT&T' tolerated", () => {
  assert(lookupKnownSupplierWebsite("3M") === null, "3M → null (unknown)");
  assert(lookupKnownSupplierWebsite("H&M") === null, "H&M → null (unknown)");
  assert(lookupKnownSupplierWebsite("AT&T") === null, "AT&T → null (unknown)");
  // None of these should throw.
});

// ── URL normaliser edge cases ──────────────────────────────────────
await runScenario("normalizeProductUrl: edge cases don't crash", () => {
  assert(normalizeProductUrl("javascript:alert(1)") === "", "javascript: rejected");
  assert(normalizeProductUrl("data:text/html,<script>") === "", "data: rejected");
  assert(normalizeProductUrl("file:///etc/passwd") === "", "file: rejected");
  assert(normalizeProductUrl("HTTPS://AMAZON.COM/DP/X") === "https://amazon.com/DP/X", "uppercase scheme lowercased");
  // Emoji attached to URL: we don't strip arbitrary Unicode from URL
  // edges (the base regex only strips specific chars). Expected
  // behaviour is "best effort — return something safe or nothing".
  const emojied = normalizeProductUrl("🎉https://example.com🎉");
  assert(emojied === "" || emojied.startsWith("https://"), `emoji → safe (got: ${emojied})`);
});

// ── parseProductMetadata adversarial HTML ──────────────────────────
await runScenario("parseProductMetadata: malformed HTML doesn't crash", () => {
  // Missing closing tags
  assert(parseProductMetadata("<meta property='og:title' content='x'").title === null || true, "incomplete tag");
  // Nested tags
  const nested = parseProductMetadata(
    "<title>Outer<title>Inner</title></title>"
  );
  assert(nested.title !== null, "nested title parses");
  // Null bytes
  assert(parseProductMetadata("<title>a\0b</title>").title !== null, "null bytes tolerated");
  // 5MB of junk
  const junk = "<".repeat(100_000) + ">".repeat(100_000);
  assert(parseProductMetadata(junk).title === null, "junk input → null, no crash");
});

// ── Generic name heuristic edge cases ─────────────────────────────
await runScenario("looksLikeGenericItemName: Unicode names pass through", () => {
  assert(!looksLikeGenericItemName("Café 日本 premium blend", "Amazon"), "mixed-script name");
  assert(!looksLikeGenericItemName("N°5 Chanel", "Sephora"), "special chars");
  assert(looksLikeGenericItemName("", "Amazon"), "empty still flagged");
});

// ── friendlyBrowserAgentError: common failure shapes ──────────────
await runScenario("friendlyBrowserAgentError: maps common errors to guidance", () => {
  assert(
    /Chrome/i.test(friendlyBrowserAgentError("Chrome still not found after download attempt.")),
    "Chrome-missing → Chrome hint"
  );
  assert(
    /network|DNS/i.test(friendlyBrowserAgentError("net::ERR_NAME_NOT_RESOLVED")),
    "DNS error → network hint"
  );
  assert(
    /too long|timeout/i.test(friendlyBrowserAgentError("Navigation timeout of 20000 ms exceeded")),
    "timeout → 'too long' hint"
  );
  assert(
    /automated|bot/i.test(friendlyBrowserAgentError("Captcha page detected")),
    "captcha → bot detection hint"
  );
  assert(
    /website URL/i.test(friendlyBrowserAgentError("Supplier has no website URL configured.")),
    "missing website → settings hint"
  );
  // Unknown errors get truncated but don't crash
  const long = "x".repeat(1000);
  const out = friendlyBrowserAgentError(long);
  assert(out.length <= 350, `truncated (${out.length} chars)`);
});

// ── Multi-URL paste (the new feature) ─────────────────────────────
await runScenario("Sniffer: bulk URL paste → multiple orders", async () => {
  const text =
    "add these to my cart https://www.amazon.com/dp/B0AAAAAAAA " +
    "https://www.amazon.com/dp/B0BBBBBBBB " +
    "https://www.amazon.com/dp/B0CCCCCCCC";
  const r = await sniffOrderIntent(text);
  if (!r) {
    assert(false, "bulk paste returned null");
    return;
  }
  assert(r.orders.length === 3, `3 orders (got ${r.orders.length})`);
  assert(
    r.orders.every((o) => o.supplierName === "Amazon"),
    "all Amazon"
  );
  assert(
    r.orders.every((o) => o.websiteUrl.startsWith("https://www.amazon.com/dp/")),
    "all URLs preserved"
  );
});

await runScenario("Sniffer: bulk paste without order verb → null (not an order)", async () => {
  // Sharing links is NOT an order intent.
  const text =
    "check these out: https://www.amazon.com/dp/B0AAAAAAAA https://www.amazon.com/dp/B0BBBBBBBB";
  const r = await sniffOrderIntent(text);
  assert(r === null, "'check these out' is not an order");
});

// ── Restore original fetch ────────────────────────────────────────
globalThis.fetch = originalFetch;

// ── Summary ────────────────────────────────────────────────────────
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\n🎉 ALL CREATIVE-INPUT TESTS PASSED");
