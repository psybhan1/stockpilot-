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

// ── Microlink fallback ─────────────────────────────────────────────
await runScenario(
  "fetchProductMetadata: Amazon URL skips direct + hits microlink first",
  async () => {
    const hits: string[] = [];
    const meta = await fetchProductMetadata(
      "https://www.amazon.ca/dp/B000FDL68W?ref=foo",
      {
        fetchImpl: async (url) => {
          const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : String(url);
          hits.push(href);
          if (href.startsWith("https://api.microlink.io")) {
            return new Response(
              JSON.stringify({
                status: "success",
                data: {
                  title: "Urnex Rinza Alkaline Formula Milk Frother Cleaner, 33.6 Ounce",
                  description: "For use on the milk systems of coffee machines",
                  image: { url: "https://cdn.example/rinza.jpg" },
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("direct should not be called", { status: 500 });
        },
      }
    );
    assert(meta !== null, "metadata returned");
    assert(
      meta?.title === "Urnex Rinza Alkaline Formula Milk Frother Cleaner, 33.6 Ounce",
      `real title via microlink (got: ${meta?.title})`
    );
    assert(meta?.source === "microlink", `source=microlink (got: ${meta?.source})`);
    assert(
      hits.length === 1,
      `only ONE fetch fired for Amazon (got ${hits.length}) — direct was skipped`
    );
    assert(
      hits[0].startsWith("https://api.microlink.io"),
      "that one fetch went to microlink"
    );
  }
);

await runScenario(
  "fetchProductMetadata: direct hits for non-blocked site, microlink never called",
  async () => {
    const hits: string[] = [];
    const meta = await fetchProductMetadata("https://small-site.example/cool-widget", {
      fetchImpl: async (url) => {
        const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : String(url);
        hits.push(href);
        if (href.startsWith("https://small-site.example")) {
          return new Response(
            `<meta property="og:title" content="Cool Widget 2.0">`,
            { status: 200, headers: { "Content-Type": "text/html" } }
          );
        }
        return new Response("unreachable", { status: 500 });
      },
    });
    assert(meta?.title === "Cool Widget 2.0", `direct title (got: ${meta?.title})`);
    assert(meta?.source === "direct", `source=direct (got: ${meta?.source})`);
    assert(hits.length === 1, "only direct was called");
    assert(
      !hits.some((h) => h.startsWith("https://api.microlink.io")),
      "microlink NOT called"
    );
  }
);

await runScenario(
  "fetchProductMetadata: direct fails → microlink rescues (non-Amazon site)",
  async () => {
    const hits: string[] = [];
    const meta = await fetchProductMetadata("https://obscure.example/product", {
      fetchImpl: async (url) => {
        const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : String(url);
        hits.push(href);
        if (href.startsWith("https://obscure.example")) {
          // Direct returns captcha with no metadata
          return new Response(`<html><head><title>Bot Check</title></head></html>`, {
            status: 200,
            headers: { "Content-Type": "text/html" },
          });
        }
        if (href.startsWith("https://api.microlink.io")) {
          return new Response(
            JSON.stringify({
              status: "success",
              data: { title: "Real Product Name", image: { url: null } },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("wat", { status: 500 });
      },
    });
    // Direct returned <title>Bot Check</title>. Title is present, so
    // microlink isn't called (by design — length check ≥ 3). This
    // asserts we fall through to microlink ONLY when direct returned
    // nothing or too-short. Actually "Bot Check" has length 9, so
    // direct "wins" — but that's the correct behavior. For a real
    // "microlink rescues" scenario, direct must return empty.
    // Re-test with empty direct:
    const hits2: string[] = [];
    const meta2 = await fetchProductMetadata("https://obscure.example/product", {
      fetchImpl: async (url) => {
        const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : String(url);
        hits2.push(href);
        if (href.startsWith("https://obscure.example")) {
          // No metadata at all
          return new Response(`<html><head></head></html>`, {
            status: 200,
            headers: { "Content-Type": "text/html" },
          });
        }
        if (href.startsWith("https://api.microlink.io")) {
          return new Response(
            JSON.stringify({
              status: "success",
              data: { title: "Rescued Title" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("wat", { status: 500 });
      },
    });
    assert(meta?.title === "Bot Check", "direct won when it had content");
    assert(meta2?.title === "Rescued Title", `microlink rescued (got: ${meta2?.title})`);
    assert(meta2?.source === "microlink", "source flagged microlink");
    assert(hits2.length === 2, "both direct and microlink were called");
  }
);

await runScenario("fetchProductMetadata: microlink JSON error → null", async () => {
  const meta = await fetchProductMetadata("https://www.amazon.com/dp/XXX", {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ status: "fail", message: "quota exceeded" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
  });
  assert(meta === null, "non-success status → null");
});

await runScenario("fetchProductMetadata: microlink HTTP error → null", async () => {
  const meta = await fetchProductMetadata("https://www.amazon.com/dp/XXX", {
    fetchImpl: async () => new Response("429", { status: 429 }),
  });
  assert(meta === null, "HTTP error → null");
});

await runScenario("fetchProductMetadata: preferService=true skips direct", async () => {
  const hits: string[] = [];
  await fetchProductMetadata("https://small-site.example/x", {
    preferService: true,
    fetchImpl: async (url) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : String(url);
      hits.push(href);
      return new Response(
        JSON.stringify({ status: "success", data: { title: "Forced Service" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    },
  });
  assert(hits.length === 1, "only one fetch");
  assert(hits[0].startsWith("https://api.microlink.io"), "went straight to microlink");
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
