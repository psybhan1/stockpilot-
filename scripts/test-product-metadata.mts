// Tests the product-metadata HTML parser (pure function) + the
// generic-item-name heuristic. Both are the key pieces that prevent
// the "searches for 'Item from Amazon'" bug from recurring.

const { parseProductMetadata, fetchProductMetadata, _resetProductMetadataCacheForTests } =
  await import("../src/modules/automation/product-metadata.ts");
const { looksLikeGenericItemName } = await import(
  "../src/modules/operator-bot/agent.ts"
);

// Reset cache before each scenario so state doesn't leak between
// scenarios (the real thing is a module-level Map). Tests also pass
// skipPuppeteer=true so we don't accidentally try to launch real
// Chrome during tests.
function freshOpts(extras: Record<string, unknown> = {}) {
  _resetProductMetadataCacheForTests();
  return { skipPuppeteer: true, skipCache: false, ...extras };
}

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
  const meta = await fetchProductMetadata("https://fake.example/product", freshOpts({
    fetchImpl: async () =>
      new Response(
        `<meta property="og:title" content="My Cool Product">`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      ),
  }));
  assert(meta?.title === "My Cool Product", `title extracted (got: ${meta?.title})`);
});

await runScenario("fetchProductMetadata: 404 returns null", async () => {
  const meta = await fetchProductMetadata("https://fake.example/404", freshOpts({
    fetchImpl: async () => new Response("not found", { status: 404 }),
  }));
  assert(meta === null, "404 → null");
});

await runScenario("fetchProductMetadata: non-HTML content-type returns null", async () => {
  const meta = await fetchProductMetadata("https://fake.example/image.png", freshOpts({
    fetchImpl: async () =>
      new Response("binary", {
        status: 200,
        headers: { "Content-Type": "image/png" },
      }),
  }));
  assert(meta === null, "non-HTML → null");
});

await runScenario("fetchProductMetadata: thrown error returns null (no propagation)", async () => {
  const meta = await fetchProductMetadata("https://fake.example/x", freshOpts({
    fetchImpl: async () => {
      throw new Error("network down");
    },
  }));
  assert(meta === null, "network error → null");
});

// ── Puppeteer primary + microlink fallback ────────────────────────
await runScenario(
  "fetchProductMetadata: Amazon URL → puppeteer primary (skips direct)",
  async () => {
    const hits: string[] = [];
    let puppeteerCalls = 0;
    const meta = await fetchProductMetadata(
      "https://www.amazon.ca/dp/B000FDL68W?ref=foo",
      freshOpts({
        skipPuppeteer: false,
        fetchImpl: async (url: string | URL | Request) => {
          const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : String(url);
          hits.push(href);
          return new Response("should not be called", { status: 500 });
        },
        puppeteerImpl: async (u: string) => {
          puppeteerCalls += 1;
          return {
            title: "Urnex Rinza Alkaline Formula Milk Frother Cleaner, 33.6 Ounce",
            description: "For use on the milk systems of coffee machines",
            imageUrl: null,
          };
        },
      })
    );
    assert(meta !== null, "metadata returned");
    assert(
      meta?.title === "Urnex Rinza Alkaline Formula Milk Frother Cleaner, 33.6 Ounce",
      `real title via puppeteer (got: ${meta?.title})`
    );
    assert(meta?.source === "puppeteer", `source=puppeteer (got: ${meta?.source})`);
    assert(puppeteerCalls === 1, "puppeteer was called once");
    assert(
      hits.length === 0,
      `direct fetch NOT called (got ${hits.length}) — Amazon is known-blocked`
    );
  }
);

await runScenario(
  "fetchProductMetadata: direct hits for non-blocked site, puppeteer + microlink never called",
  async () => {
    const hits: string[] = [];
    let puppeteerCalls = 0;
    const meta = await fetchProductMetadata("https://small-site.example/cool-widget", freshOpts({
      skipPuppeteer: false,
      fetchImpl: async (url: string | URL | Request) => {
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
      puppeteerImpl: async () => {
        puppeteerCalls += 1;
        return null;
      },
    }));
    assert(meta?.title === "Cool Widget 2.0", `direct title (got: ${meta?.title})`);
    assert(meta?.source === "direct", `source=direct (got: ${meta?.source})`);
    assert(hits.length === 1, "only direct was called");
    assert(puppeteerCalls === 0, "puppeteer NOT called (direct won)");
    assert(
      !hits.some((h) => h.startsWith("https://api.microlink.io")),
      "microlink NOT called"
    );
  }
);

await runScenario(
  "fetchProductMetadata: direct fails + puppeteer fails → microlink rescues",
  async () => {
    const hits: string[] = [];
    let puppeteerCalls = 0;
    const meta = await fetchProductMetadata("https://obscure.example/product", freshOpts({
      skipPuppeteer: false,
      fetchImpl: async (url: string | URL | Request) => {
        const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : String(url);
        hits.push(href);
        if (href.startsWith("https://obscure.example")) {
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
      puppeteerImpl: async () => {
        puppeteerCalls += 1;
        return null; // puppeteer also fails
      },
    }));
    assert(meta?.title === "Rescued Title", `microlink rescued (got: ${meta?.title})`);
    assert(meta?.source === "microlink", "source flagged microlink");
    assert(puppeteerCalls === 1, "puppeteer was attempted");
    assert(hits.some((h) => h.startsWith("https://api.microlink.io")), "microlink called");
  }
);

await runScenario("fetchProductMetadata: microlink JSON fail status → null", async () => {
  const meta = await fetchProductMetadata("https://www.amazon.com/dp/XXX", freshOpts({
    skipPuppeteer: true,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ status: "fail", message: "quota exceeded" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
  }));
  assert(meta === null, "non-success status → null");
});

await runScenario("fetchProductMetadata: microlink HTTP error → null", async () => {
  const meta = await fetchProductMetadata("https://www.amazon.com/dp/XXX", freshOpts({
    skipPuppeteer: true,
    fetchImpl: async () => new Response("429", { status: 429 }),
  }));
  assert(meta === null, "HTTP error → null");
});

// ── Microlink retry-once on transient failures ────────────────────
await runScenario(
  "fetchProductMetadata: microlink 502 first time, success on retry",
  async () => {
    _resetProductMetadataCacheForTests();
    let attempts = 0;
    const meta = await fetchProductMetadata("https://www.amazon.com/dp/RETRY", {
      skipPuppeteer: true,
      fetchImpl: (async (url) => {
        const href =
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.toString()
              : String(url);
        if (!href.startsWith("https://api.microlink.io")) {
          return new Response("unexpected", { status: 500 });
        }
        attempts += 1;
        if (attempts === 1) {
          // First try fails with a transient 502
          return new Response("bad gateway", { status: 502 });
        }
        return new Response(
          JSON.stringify({
            status: "success",
            data: { title: "Recovered Title" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch,
    });
    assert(meta?.title === "Recovered Title", `retry recovered (got: ${meta?.title})`);
    assert(attempts === 2, `exactly 2 attempts (got ${attempts})`);
  }
);

await runScenario(
  "fetchProductMetadata: microlink persistent failure → null after retry",
  async () => {
    _resetProductMetadataCacheForTests();
    let attempts = 0;
    const meta = await fetchProductMetadata("https://www.amazon.com/dp/PERMA", {
      skipPuppeteer: true,
      fetchImpl: (async () => {
        attempts += 1;
        return new Response("down", { status: 502 });
      }) as typeof fetch,
    });
    assert(meta === null, "null after all retries exhausted");
    assert(attempts === 2, `retried once (got ${attempts} attempts)`);
  }
);

// ── Cache tests ────────────────────────────────────────────────────
await runScenario("fetchProductMetadata: same URL twice → cache hit", async () => {
  _resetProductMetadataCacheForTests();
  let fetchCount = 0;
  const stub = async (url: string | URL | Request) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : String(url);
    fetchCount += 1;
    if (href.startsWith("https://small-site.example")) {
      return new Response(`<meta property="og:title" content="Cached Widget">`, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }
    return new Response("x", { status: 500 });
  };

  const first = await fetchProductMetadata("https://small-site.example/x", {
    skipPuppeteer: true,
    fetchImpl: stub as typeof fetch,
  });
  assert(first?.source === "direct", "first call hits direct");
  assert(fetchCount === 1, `fetched once (got ${fetchCount})`);

  const second = await fetchProductMetadata("https://small-site.example/x", {
    skipPuppeteer: true,
    fetchImpl: stub as typeof fetch,
  });
  assert(second?.title === "Cached Widget", "cached title returned");
  assert(second?.source === "cache", `source=cache (got: ${second?.source})`);
  assert(fetchCount === 1, `still 1 fetch — cache prevented second (got ${fetchCount})`);
});

await runScenario(
  "fetchProductMetadata: cacheKey normalises tracking params so /dp/X?ref=A and /dp/X?ref=B hit same entry",
  async () => {
    _resetProductMetadataCacheForTests();
    let puppeteerCalls = 0;
    const puppeteerImpl = async () => {
      puppeteerCalls += 1;
      return { title: "Amazon Product", description: null, imageUrl: null };
    };
    const first = await fetchProductMetadata(
      "https://www.amazon.com/dp/B005YJZE2I?ref=foo",
      { skipPuppeteer: false, puppeteerImpl, fetchImpl: undefined }
    );
    const second = await fetchProductMetadata(
      "https://www.amazon.com/dp/B005YJZE2I?ref=bar&pd_rd_w=x",
      { skipPuppeteer: false, puppeteerImpl, fetchImpl: undefined }
    );
    assert(first?.title === "Amazon Product", "first hit");
    assert(second?.source === "cache", "second was a cache hit despite different tracking params");
    assert(
      puppeteerCalls === 1,
      `puppeteer only called once across both (got ${puppeteerCalls})`
    );
  }
);

await runScenario("fetchProductMetadata: skipCache=true forces re-fetch", async () => {
  _resetProductMetadataCacheForTests();
  let fetchCount = 0;
  const stub = async () => {
    fetchCount += 1;
    return new Response(`<meta property="og:title" content="Fresh Widget">`, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  };
  await fetchProductMetadata("https://small-site.example/x", {
    skipPuppeteer: true,
    fetchImpl: stub as typeof fetch,
  });
  await fetchProductMetadata("https://small-site.example/x", {
    skipPuppeteer: true,
    skipCache: true,
    fetchImpl: stub as typeof fetch,
  });
  assert(fetchCount === 2, `two fetches when skipCache=true (got ${fetchCount})`);
});

await runScenario(
  "fetchProductMetadata: preferService=true skips direct + prefers puppeteer path",
  async () => {
    _resetProductMetadataCacheForTests();
    const hits: string[] = [];
    let puppeteerCalls = 0;
    await fetchProductMetadata("https://small-site.example/x", {
      preferService: true,
      fetchImpl: (async (url) => {
        const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : String(url);
        hits.push(href);
        return new Response("y", { status: 500 });
      }) as typeof fetch,
      puppeteerImpl: async () => {
        puppeteerCalls += 1;
        return { title: "Forced Puppeteer", description: null, imageUrl: null };
      },
    });
    assert(puppeteerCalls === 1, "puppeteer used");
    assert(
      !hits.some((h) => h.startsWith("https://small-site.example")),
      "direct NOT called when preferService=true"
    );
  }
);

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
