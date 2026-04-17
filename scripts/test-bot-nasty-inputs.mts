// "Nasty real-user messages" test — the stuff café managers
// actually send. Targets the pre-LLM order sniffer + helpers.
// Every test mirrors something a real person might type (or
// voice-dictate) on Telegram.
//
// If the bot mishandles any of these, the user's right — the most
// important part of the app is broken.

process.env.N8N_WEBHOOK_SECRET =
  process.env.N8N_WEBHOOK_SECRET ?? "test-nasty-secret";

const { sniffOrderIntent, findAllUrls } = await import(
  "../src/modules/operator-bot/order-sniffer.ts"
);

// Mock fetch for URL enrichment so tests are offline-safe.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request) => {
  const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : String(url);
  if (href.startsWith("https://api.microlink.io")) {
    return new Response(
      JSON.stringify({
        status: "success",
        data: { title: "Oat Milk 946ml Barista Blend" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  if (/\/dp\//.test(href)) {
    return new Response(
      `<meta property="og:title" content="Oat Milk 946ml Barista Blend">`,
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }
  return realFetch(url, { cache: "no-store" });
}) as typeof fetch;

// ── Harness ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: unknown, label: string, detail?: string) {
  if (cond) {
    passed += 1;
    console.log(`    ✅ ${label}`);
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`    ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function scenario(name: string, fn: () => void | Promise<void>) {
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

// Unwrap helper: sniffer returns { orders: [...] } | null. Most
// scenarios have one order; some have multiple.
type Order = {
  itemName: string;
  quantity: number;
  supplierName: string;
  websiteUrl?: string;
};
function ordersOf(r: { orders: Order[] } | null): Order[] {
  return r?.orders ?? [];
}

// ── 1. Canonical cases: these MUST work ───────────────────────────

await scenario("canonical: 'order 5 bags of oat milk from costco'", async () => {
  const o = ordersOf(await sniffOrderIntent("order 5 bags of oat milk from costco"));
  assert(o.length === 1, `1 order (got ${o.length})`);
  if (o.length === 1) {
    assert(o[0].quantity === 5, `qty=5 (got ${o[0].quantity})`);
    assert(/oat\s*milk/i.test(o[0].itemName), `item contains 'oat milk' (got ${o[0].itemName})`);
    assert(/costco/i.test(o[0].supplierName), `supplier costco (got ${o[0].supplierName})`);
  }
});

await scenario("terse: 'need 2 cases of oat milk from amazon'", async () => {
  const o = ordersOf(await sniffOrderIntent("need 2 cases of oat milk from amazon"));
  // "need" isn't in ORDER_VERBS (only "we need"). This is a real
  // bug if it fails — shortening "we need" to "need" is natural.
  if (o.length === 1) {
    assert(o[0].quantity === 2, `qty=2 (got ${o[0].quantity})`);
  } else {
    assert(false, `'need' alone didn't match — bug: users drop the 'we' in casual text`, `got ${o.length} orders`);
  }
});

await scenario("polite: 'please order 3 lbs of coffee from costco'", async () => {
  const o = ordersOf(await sniffOrderIntent("please order 3 lbs of coffee from costco"));
  assert(o.length === 1, `1 order (got ${o.length})`);
  if (o.length === 1) assert(o[0].quantity === 3, `qty=3`);
});

await scenario("imperative: 'buy 4 bottles of vanilla syrup from amazon'", async () => {
  const o = ordersOf(await sniffOrderIntent("buy 4 bottles of vanilla syrup from amazon"));
  assert(o.length === 1, `1 order (got ${o.length})`);
  if (o.length === 1) {
    assert(o[0].quantity === 4, `qty=4`);
    assert(/vanilla/i.test(o[0].itemName), `item contains 'vanilla' (got ${o[0].itemName})`);
  }
});

await scenario("'get me': 'get me 6 gallons of milk from costco'", async () => {
  const o = ordersOf(await sniffOrderIntent("get me 6 gallons of milk from costco"));
  assert(o.length === 1, `1 order`);
  if (o.length === 1) assert(o[0].quantity === 6, `qty=6`);
});

// ── 2. Unicode / emoji / punctuation / caps ────────────────────────

await scenario("emoji trailing: 'order 5 bags of oat milk from costco 😭'", async () => {
  const o = ordersOf(await sniffOrderIntent("order 5 bags of oat milk from costco 😭"));
  if (o.length === 1) {
    assert(o[0].quantity === 5, `qty=5 (got ${o[0].quantity})`);
    assert(
      /costco/i.test(o[0].supplierName),
      `supplier still costco (got '${o[0].supplierName}')`
    );
  } else {
    assert(
      false,
      `emoji trailing broke parsing — bug`,
      `got ${o.length} orders`
    );
  }
});

await scenario("unicode item: 'order 3 bags of café espresso from costco'", async () => {
  const o = ordersOf(await sniffOrderIntent("order 3 bags of café espresso from costco"));
  if (o.length === 1) {
    assert(
      /café/i.test(o[0].itemName),
      `item preserves accent (got ${o[0].itemName})`
    );
  } else {
    assert(false, `accent broke parsing — bug`, `got ${o.length}`);
  }
});

await scenario("SHOUTING: 'ORDER 5 BAGS OF OAT MILK FROM COSTCO!!!'", async () => {
  const o = ordersOf(await sniffOrderIntent("ORDER 5 BAGS OF OAT MILK FROM COSTCO!!!"));
  if (o.length === 1) {
    assert(o[0].quantity === 5, `qty=5 (got ${o[0].quantity})`);
  } else {
    assert(false, `caps + !!! broke parsing — bug`, `got ${o.length}`);
  }
});

await scenario("leading/trailing whitespace: '   order 3 lbs beans from costco   '", async () => {
  const o = ordersOf(await sniffOrderIntent("   order 3 lbs beans from costco   "));
  assert(o.length === 1, `whitespace tolerated (got ${o.length})`);
});

// ── 3. Word quantity ──────────────────────────────────────────────

await scenario("word qty: 'order ten bags of rice from costco'", async () => {
  const o = ordersOf(await sniffOrderIntent("order ten bags of rice from costco"));
  // Sniffer requires digit in the primary regex. Word qty falls
  // through to LLM (null). Document as a gap, not a bug per se —
  // but users typing "ten bags" will see "what?" reply without LLM.
  if (o.length === 0) {
    assert(true, "word qty falls through to LLM (known gap)");
  } else {
    assert(o[0].quantity === 10, `if parsed, qty=10 (got ${o[0].quantity})`);
  }
});

await scenario("dozen: 'order a dozen cases of eggs from costco'", async () => {
  const o = ordersOf(await sniffOrderIntent("order a dozen cases of eggs from costco"));
  if (o.length === 1) {
    assert(o[0].quantity === 12, `dozen → 12 (got ${o[0].quantity})`);
  } else {
    assert(true, "dozen falls to LLM (known gap)");
  }
});

// ── 4. URL handling ───────────────────────────────────────────────

await scenario("bare URL (no verb): 'https://amazon.com/dp/B0AAAAAAAA'", async () => {
  const o = ordersOf(await sniffOrderIntent("https://amazon.com/dp/B0AAAAAAAA"));
  assert(o.length === 0, `no verb → no PO (got ${o.length})`);
});

await scenario("'check this out' + URL (non-order context)", async () => {
  const o = ordersOf(
    await sniffOrderIntent(
      "hey check out this product https://amazon.com/dp/B0AAAAAAAA"
    )
  );
  // "check" isn't an order verb → should not match. BUT
  // looksLikeOrderIntent uses a loose \bget\b which "check out"
  // doesn't hit. Should be null.
  assert(o.length === 0, `'check out' is not an order (got ${o.length})`);
});

await scenario("'add this' + URL: match + enrich from og:title", async () => {
  const o = ordersOf(
    await sniffOrderIntent(
      "add this to my cart https://amazon.com/dp/B0AAAAAAAA"
    )
  );
  assert(o.length === 1, `matched URL + verb (got ${o.length})`);
  if (o.length === 1) {
    assert(/amazon/i.test(o[0].supplierName), "supplier amazon");
    assert(
      o[0].websiteUrl?.includes("amazon.com/dp/"),
      "URL preserved"
    );
    // og:title should have enriched it to "Oat Milk..."
    assert(o[0].itemName.length > 3, `name enriched (got '${o[0].itemName}')`);
  }
});

await scenario("3 URLs + order verb: bulk paste → 3 orders", async () => {
  const o = ordersOf(
    await sniffOrderIntent(
      "add these to my cart https://amazon.com/dp/B0AAAAAAAA " +
        "https://amazon.com/dp/B0BBBBBBBB " +
        "https://amazon.com/dp/B0CCCCCCCC"
    )
  );
  assert(o.length === 3, `3 orders (got ${o.length})`);
  if (o.length === 3) {
    assert(
      o.every((x) => x.supplierName.toLowerCase().includes("amazon")),
      "all amazon"
    );
  }
});

await scenario("bulk URLs WITHOUT order verb → null", async () => {
  const o = ordersOf(
    await sniffOrderIntent(
      "check these out https://amazon.com/dp/B0AAAAAAAA " +
        "https://amazon.com/dp/B0BBBBBBBB"
    )
  );
  assert(o.length === 0, `no verb → no PO (got ${o.length})`);
});

// ── 5. Quantity parsing edge cases ─────────────────────────────────

await scenario("digit inside word: 'order Route66 coffee from costco' (default qty 1)", async () => {
  const o = ordersOf(await sniffOrderIntent("order Route66 coffee from costco"));
  if (o.length === 1) {
    assert(o[0].quantity !== 66, `qty is NOT 66 (got ${o[0].quantity})`);
  } else {
    assert(true, "null match acceptable (no standalone digit)");
  }
});

await scenario("ASIN-like in text: 'order this B000FDL68W from amazon' (no digit qty)", async () => {
  const o = ordersOf(await sniffOrderIntent("order this B000FDL68W from amazon"));
  if (o.length === 1) {
    assert(
      o[0].quantity < 100,
      `ASIN digits not grabbed (got ${o[0].quantity})`
    );
  }
});

await scenario("no quantity: 'order oat milk from costco' → null", async () => {
  const o = ordersOf(await sniffOrderIntent("order oat milk from costco"));
  // No digit → regex fails. No URL → fallback fails. LLM takes it.
  assert(o.length === 0, `null without a qty digit (got ${o.length})`);
});

// ── 6. Pathological inputs ─────────────────────────────────────────

await scenario("empty string → null", async () => {
  const o = ordersOf(await sniffOrderIntent(""));
  assert(o.length === 0, "null for empty");
});

await scenario("whitespace only → null", async () => {
  const o = ordersOf(await sniffOrderIntent("   \t\n  "));
  assert(o.length === 0, "null for whitespace");
});

await scenario("single emoji → null", async () => {
  const o = ordersOf(await sniffOrderIntent("👀"));
  assert(o.length === 0, "null for emoji-only");
});

await scenario("just a question mark → null", async () => {
  const o = ordersOf(await sniffOrderIntent("?"));
  assert(o.length === 0, "null for punct-only");
});

await scenario("'ok' → null", async () => {
  const o = ordersOf(await sniffOrderIntent("ok"));
  assert(o.length === 0, "null for 'ok'");
});

await scenario("just '5' → null", async () => {
  const o = ordersOf(await sniffOrderIntent("5"));
  assert(o.length === 0, "null for single digit");
});

await scenario("just 'milk' → null", async () => {
  const o = ordersOf(await sniffOrderIntent("milk"));
  assert(o.length === 0, "null for single word");
});

await scenario("non-order prose → null", async () => {
  const o = ordersOf(
    await sniffOrderIntent(
      "we had a lovely weekend and the kids caught fireflies"
    )
  );
  assert(o.length === 0, "null for no-intent prose");
});

// ── 7. Supplier name variants ──────────────────────────────────────

await scenario("'my costco cart' normalized to 'costco'", async () => {
  const o = ordersOf(
    await sniffOrderIntent("order 3 bags of oat milk from MY costco cart")
  );
  assert(o.length === 1, `matched (got ${o.length})`);
  if (o.length === 1) {
    assert(
      /costco/i.test(o[0].supplierName),
      `'my ... cart' stripped to 'costco' (got '${o[0].supplierName}')`
    );
    assert(
      !/cart/i.test(o[0].supplierName),
      "'cart' suffix stripped"
    );
  }
});

await scenario("unknown supplier without URL → null (bail to LLM)", async () => {
  const o = ordersOf(
    await sniffOrderIntent("order 3 bags of oat milk from randomlocalshop")
  );
  assert(o.length === 0, "unknown supplier without URL is LLM territory");
});

// ── 8. Multi-intent  ──────────────────────────────────────────────

await scenario("multi-item 'and': 'order 3 bags of milk from costco and 2 lbs coffee from amazon'", async () => {
  const o = ordersOf(
    await sniffOrderIntent(
      "order 3 bags of milk from costco and 2 lbs coffee from amazon"
    )
  );
  // Sniffer's splitMultipart should handle this. Either 2 orders
  // or bail-null; anything in between (e.g. 1 order) means the
  // second half was silently dropped.
  assert(
    o.length === 2 || o.length === 0,
    `either split fully (2) or bail (0); got ${o.length}`
  );
  if (o.length === 2) {
    const milk = o.find((x) => /milk/i.test(x.itemName));
    const coffee = o.find((x) => /coffee/i.test(x.itemName));
    assert(milk != null, "milk order found");
    assert(coffee != null, "coffee order found");
    if (milk) assert(milk.quantity === 3, `milk qty=3 (got ${milk.quantity})`);
    if (coffee) assert(coffee.quantity === 2, `coffee qty=2 (got ${coffee.quantity})`);
  }
});

await scenario("cancel + order mixed: sniffer bails (don't invent 'cancel' as an item)", async () => {
  const o = ordersOf(
    await sniffOrderIntent(
      "cancel the milk one and order 5 bags of coffee from costco"
    )
  );
  // Either null (bail — LLM handles both intents) or exactly 1
  // order for the coffee half. Crucially must NOT create an order
  // with "cancel" as the item name.
  if (o.length > 0) {
    assert(
      o.every((x) => !/cancel/i.test(x.itemName)),
      `'cancel' is not an item (got items: ${o.map((x) => x.itemName).join(", ")})`
    );
  } else {
    assert(true, "bail acceptable");
  }
});

// ── 9. URL extraction ─────────────────────────────────────────────

await scenario("findAllUrls: extracts multiple from mixed text", () => {
  const urls = findAllUrls(
    "check https://amazon.com/dp/A1 and www.costco.com/item/42 plus http://lcbo.com/p/123"
  );
  assert(urls.length >= 2, `found >=2 URLs (got ${urls.length})`);
});

await scenario("findAllUrls: empty input → empty array", () => {
  const urls = findAllUrls("");
  assert(Array.isArray(urls) && urls.length === 0, "empty array");
});

await scenario("findAllUrls: not fooled by item names ending in .com", () => {
  const urls = findAllUrls("order coffee.com brand beans from costco");
  // This IS ambiguous — "coffee.com" could be a URL or a brand.
  // We accept whatever the sniffer thinks; just shouldn't crash.
  assert(Array.isArray(urls), "returns array");
});

// ── 10. Voice-transcription artifacts ──────────────────────────────

await scenario("voice: 'um order uh 5 bags of oat milk from costco'", async () => {
  const o = ordersOf(
    await sniffOrderIntent("um order uh 5 bags of oat milk from costco")
  );
  // Leading "um " breaks the anchored regex. Acceptable to null
  // (LLM handles); just must not mangle.
  if (o.length === 1) {
    assert(
      !/um|uh/i.test(o[0].itemName),
      `fillers stripped (got '${o[0].itemName}')`
    );
  }
  assert(true, "did not throw");
});

await scenario("voice: 'yeah like 5 bags of oat milk from costco please'", async () => {
  const o = ordersOf(
    await sniffOrderIntent(
      "yeah like 5 bags of oat milk from costco please"
    )
  );
  // Leading hedge words break the anchored regex. Known gap.
  assert(true, "did not throw");
});

// ── 11. Unit abbreviations (real invoice language) ────────────────

await scenario("abbrev: 'order 3 cs of milk from costco' (cs = case)", async () => {
  const o = ordersOf(await sniffOrderIntent("order 3 cs of milk from costco"));
  if (o.length === 1) {
    assert(o[0].quantity === 3, `qty=3 (got ${o[0].quantity})`);
  } else {
    assert(
      false,
      `'cs' unit abbrev failed`,
      `got ${o.length} orders — real packing slips use 'cs'`
    );
  }
});

await scenario("abbrev: 'order 2 gal of milk from costco'", async () => {
  const o = ordersOf(await sniffOrderIntent("order 2 gal of milk from costco"));
  if (o.length === 1) {
    assert(o[0].quantity === 2, `qty=2`);
  } else {
    assert(false, "'gal' abbrev failed", `got ${o.length}`);
  }
});

await scenario("spelled-out: 'order 3 pounds of beans from costco'", async () => {
  const o = ordersOf(
    await sniffOrderIntent("order 3 pounds of beans from costco")
  );
  if (o.length === 1) assert(o[0].quantity === 3, `qty=3`);
  else assert(false, "'pounds' spelled out failed", `got ${o.length}`);
});

await scenario("spelled-out: 'order 2 kilos of beans from costco'", async () => {
  const o = ordersOf(
    await sniffOrderIntent("order 2 kilos of beans from costco")
  );
  if (o.length === 1) assert(o[0].quantity === 2, `qty=2`);
  else assert(false, "'kilos' failed", `got ${o.length}`);
});

// ── 12. Politeness prefixes ───────────────────────────────────────

await scenario("'can u order 5 ... from costco'", async () => {
  const o = ordersOf(
    await sniffOrderIntent("can u order 5 bags of oat milk from costco")
  );
  if (o.length === 1) assert(o[0].quantity === 5, `qty=5`);
  else assert(false, "'can u' prefix failed", `got ${o.length}`);
});

await scenario("'pls order 3 ... from amazon'", async () => {
  const o = ordersOf(
    await sniffOrderIntent("pls order 3 bags of beans from amazon")
  );
  if (o.length === 1) assert(o[0].quantity === 3, `qty=3`);
  else assert(false, "'pls' shortcut failed", `got ${o.length}`);
});

// ── 13. Alternative verbs ─────────────────────────────────────────

await scenario("'grab 3 bags of ... from costco'", async () => {
  const o = ordersOf(
    await sniffOrderIntent("grab 3 bags of paper cups from costco")
  );
  if (o.length === 1) assert(o[0].quantity === 3, `qty=3`);
  else assert(false, "'grab' verb failed", `got ${o.length}`);
});

await scenario("'pick up 2 cases of ... from costco'", async () => {
  const o = ordersOf(
    await sniffOrderIntent("pick up 2 cases of oat milk from costco")
  );
  if (o.length === 1) assert(o[0].quantity === 2, `qty=2`);
  else assert(false, "'pick up' failed", `got ${o.length}`);
});

await scenario("'restock 5 bags of ... from costco'", async () => {
  const o = ordersOf(
    await sniffOrderIntent("restock 5 bags of flour from costco")
  );
  if (o.length === 1) assert(o[0].quantity === 5, `qty=5`);
  else assert(false, "'restock' verb failed", `got ${o.length}`);
});

// ── 14. Trailing symbols / emoji mid-message ──────────────────────

await scenario("heart emoji: 'order 3 bags of oat milk from costco ❤️'", async () => {
  const o = ordersOf(
    await sniffOrderIntent("order 3 bags of oat milk from costco ❤️")
  );
  if (o.length === 1) assert(o[0].quantity === 3, `qty=3`);
  else assert(false, "heart emoji failed", `got ${o.length}`);
});

await scenario("multi-emoji + punct: 'ORDER 5 BAGS OAT MILK FROM COSTCO!!!🙏🙏'", async () => {
  const o = ordersOf(
    await sniffOrderIntent("ORDER 5 BAGS OAT MILK FROM COSTCO!!!🙏🙏")
  );
  if (o.length === 1) assert(o[0].quantity === 5, `qty=5`);
  else assert(false, "multi-emoji trailing failed", `got ${o.length}`);
});

// ── Report ─────────────────────────────────────────────────────────

console.log(
  `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPassed: ${passed}\nFailed: ${failed}${
    failed > 0 ? "\n\nFailures:\n  - " + failures.join("\n  - ") : ""
  }`
);
if (failed > 0) process.exit(1);
else console.log("\n🎉 ALL BOT NASTY-INPUT TESTS PASSED");
