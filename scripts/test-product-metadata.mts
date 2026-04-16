// Tests the product-metadata HTML parser (pure function) + the
// generic-item-name heuristic. Both are the key pieces that prevent
// the "searches for 'Item from Amazon'" bug from recurring.

const { parseProductMetadata, fetchProductMetadata } = await import(
  "../src/modules/automation/product-metadata.ts"
);
const { looksLikeGenericItemName } = await import(
  "../src/modules/operator-bot/agent.ts"
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

// ── parseProductMetadata: og:title takes priority ─────────────────
await runScenario("parseProductMetadata: og:title wins over <title>", () => {
  const html = `
    <html><head>
      <title>Amazon.ca : Some Noisy - Title - With - Dashes</title>
      <meta property="og:title" content="Urnex Rinza Alkaline Formula Milk Frother Cleaner, 33.6 Ounce">
    </head><body></body></html>
  `;
  const meta = parseProductMetadata(html);
  assert(
    meta.title === "Urnex Rinza Alkaline Formula Milk Frother Cleaner, 33.6 Ounce",
    `og:title used (got: ${meta.title})`
  );
});

await runScenario("parseProductMetadata: reversed attribute order", () => {
  const html = `<meta content="Product Y" property="og:title">`;
  const meta = parseProductMetadata(html);
  assert(meta.title === "Product Y", `got ${meta.title}`);
});

await runScenario("parseProductMetadata: Amazon #productTitle when no og", () => {
  const html = `
    <html><head><title>Amazon</title></head><body>
      <span id="productTitle">Urnex Cafiza Espresso Cleaning Tablets</span>
    </body></html>
  `;
  const meta = parseProductMetadata(html);
  assert(
    meta.title === "Urnex Cafiza Espresso Cleaning Tablets",
    `productTitle span (got: ${meta.title})`
  );
});

await runScenario("parseProductMetadata: <title> as last resort, noise stripped", () => {
  const html = `<html><head><title>Urnex Cafiza - Amazon.ca</title></head></html>`;
  const meta = parseProductMetadata(html);
  assert(meta.title === "Urnex Cafiza", `Amazon suffix stripped (got: ${meta.title})`);
});

await runScenario("parseProductMetadata: <h1> fallback for non-Amazon sites", () => {
  const html = `
    <html><head><title>LCBO</title></head><body>
      <h1>JP Wiser's Deluxe Canadian Whisky 750 mL</h1>
    </body></html>
  `;
  const meta = parseProductMetadata(html);
  assert(/jp wiser/i.test(meta.title ?? ""), `used <h1> (got: ${meta.title})`);
});

await runScenario("parseProductMetadata: HTML entities decoded", () => {
  const html = `<meta property="og:title" content="Peet&#39;s Coffee &amp; Tea">`;
  const meta = parseProductMetadata(html);
  assert(meta.title === "Peet's Coffee & Tea", `entities decoded (got: ${meta.title})`);
});

await runScenario("parseProductMetadata: description + image extracted", () => {
  const html = `
    <meta property="og:title" content="Test">
    <meta property="og:description" content="A short product description.">
    <meta property="og:image" content="https://example.com/image.jpg">
  `;
  const meta = parseProductMetadata(html);
  assert(meta.description === "A short product description.", "description");
  assert(meta.imageUrl === "https://example.com/image.jpg", "image url");
});

await runScenario("parseProductMetadata: empty HTML returns nulls", () => {
  const meta = parseProductMetadata("");
  assert(meta.title === null, "title null");
  assert(meta.description === null, "description null");
  assert(meta.imageUrl === null, "image null");
});

// ── fetchProductMetadata with injected fetch ──────────────────────
await runScenario("fetchProductMetadata: happy path returns parsed metadata", async () => {
  const meta = await fetchProductMetadata("https://fake.example/product", {
    fetchImpl: async () =>
      new Response(
        `<meta property="og:title" content="My Cool Product">`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      ),
  });
  assert(meta?.title === "My Cool Product", `title extracted (got: ${meta?.title})`);
});

await runScenario("fetchProductMetadata: 404 returns null", async () => {
  const meta = await fetchProductMetadata("https://fake.example/404", {
    fetchImpl: async () => new Response("not found", { status: 404 }),
  });
  assert(meta === null, "404 → null");
});

await runScenario("fetchProductMetadata: non-HTML content-type returns null", async () => {
  const meta = await fetchProductMetadata("https://fake.example/image.png", {
    fetchImpl: async () =>
      new Response("binary", {
        status: 200,
        headers: { "Content-Type": "image/png" },
      }),
  });
  assert(meta === null, "non-HTML → null");
});

await runScenario("fetchProductMetadata: thrown error returns null (no propagation)", async () => {
  const meta = await fetchProductMetadata("https://fake.example/x", {
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert(meta === null, "network error → null");
});

// ── looksLikeGenericItemName heuristic ────────────────────────────
await runScenario("looksLikeGenericItemName: catches placeholder names", () => {
  assert(looksLikeGenericItemName("Item from Amazon", "Amazon"), "'Item from Amazon' is generic");
  assert(looksLikeGenericItemName("item from amazon", "Amazon"), "lowercase too");
  assert(looksLikeGenericItemName("Item from Costco", "Costco"), "Costco variant");
  assert(looksLikeGenericItemName("Product from Target", "Target"), "Product variant");
  assert(looksLikeGenericItemName("Amazon item", "Amazon"), "'Amazon item'");
  assert(looksLikeGenericItemName("An Amazon item", "Amazon"), "'An Amazon item'");
  assert(looksLikeGenericItemName("thing", "Amazon"), "bare 'thing'");
  assert(looksLikeGenericItemName("Amazon", "Amazon"), "literal supplier name");
  assert(looksLikeGenericItemName("", "Amazon"), "empty string");
  assert(looksLikeGenericItemName("x", "Amazon"), "single char");
  assert(looksLikeGenericItemName("item", "Amazon"), "just 'item'");
});

await runScenario("looksLikeGenericItemName: real product names pass through", () => {
  assert(
    !looksLikeGenericItemName("Urnex Cafiza Espresso Cleaner", "Amazon"),
    "real product name — not generic"
  );
  assert(
    !looksLikeGenericItemName("JP Wiser's Deluxe Whisky 750ml", "LCBO"),
    "whisky name — not generic"
  );
  assert(
    !looksLikeGenericItemName("Oat Milk Barista Edition", "Costco"),
    "oat milk — not generic"
  );
  assert(
    !looksLikeGenericItemName("Rinza Alkaline Formula", "Amazon"),
    "starts with brand — not generic"
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
console.log("\n🎉 ALL PRODUCT-METADATA TESTS PASSED");
