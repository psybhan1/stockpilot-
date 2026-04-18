import test from "node:test";
import assert from "node:assert/strict";

import {
  _resetProductMetadataCacheForTests,
  fetchProductMetadata,
  parseProductMetadata,
} from "./product-metadata";

// Silence the module's chatty console.log lines so test output is
// readable. Each test opts in/out by wrapping.
function quiet<T>(fn: () => T | Promise<T>): Promise<T> {
  const original = console.log;
  console.log = () => {};
  const done = () => { console.log = original; };
  try {
    const result = fn();
    if (result && typeof (result as Promise<T>).then === "function") {
      return (result as Promise<T>).finally(done);
    }
    done();
    return Promise.resolve(result as T);
  } catch (err) {
    done();
    throw err;
  }
}

// ── parseProductMetadata: OG / Twitter meta extraction ───────────

test("parseProductMetadata: og:title wins over <title>", () => {
  const html = `
    <html><head>
      <title>Amazon.com: Urnex Rinza - Amazon.com</title>
      <meta property="og:title" content="Urnex Rinza Acid Cleaner" />
    </head></html>
  `;
  assert.equal(parseProductMetadata(html).title, "Urnex Rinza Acid Cleaner");
});

test("parseProductMetadata: twitter:title used when og:title absent", () => {
  const html = `<meta name="twitter:title" content="Twitter Title Wins" />`;
  assert.equal(parseProductMetadata(html).title, "Twitter Title Wins");
});

test("parseProductMetadata: content attribute before property attribute also matches", () => {
  // matchMeta tries both attribute orderings. Lots of sites emit
  // content-first.
  const html = `<meta content="Reversed Order" property="og:title" />`;
  assert.equal(parseProductMetadata(html).title, "Reversed Order");
});

test("parseProductMetadata: handles single-quoted attributes", () => {
  const html = `<meta property='og:title' content='Single Quoted' />`;
  assert.equal(parseProductMetadata(html).title, "Single Quoted");
});

test("parseProductMetadata: falls back to #productTitle (Amazon) when no og:title", () => {
  const html = `
    <html><body>
      <span id="productTitle">Urnex Cafiza Espresso Machine Cleaner</span>
    </body></html>
  `;
  assert.match(
    parseProductMetadata(html).title ?? "",
    /Urnex Cafiza/,
  );
});

test("parseProductMetadata: falls back to <h1> when no meta and no productTitle", () => {
  const html = `<html><body><h1>Generic Product H1</h1></body></html>`;
  assert.equal(parseProductMetadata(html).title, "Generic Product H1");
});

test("parseProductMetadata: falls back to <title> tag last, stripping SiteName suffix", () => {
  const html = `<title>Widget Deluxe | Amazon.com</title>`;
  assert.equal(parseProductMetadata(html).title, "Widget Deluxe");
});

test("parseProductMetadata: returns null title when nothing parseable", () => {
  assert.equal(parseProductMetadata("<html><body>no metadata</body></html>").title, null);
});

test("parseProductMetadata: returns null for empty string", () => {
  assert.equal(parseProductMetadata("").title, null);
  assert.equal(parseProductMetadata("").description, null);
  assert.equal(parseProductMetadata("").imageUrl, null);
});

// ── parseProductMetadata: title cleaning ─────────────────────────

test("parseProductMetadata: collapses whitespace + strips inner tags from title", () => {
  const html = `<meta property="og:title" content="Line one\n   Line two   with <b>bold</b>" />`;
  // Clean: collapse whitespace, strip tags.
  assert.equal(
    parseProductMetadata(html).title,
    "Line one Line two with bold",
  );
});

test("parseProductMetadata: decodes HTML entities in title", () => {
  const html = `<meta property="og:title" content="Dr. Pepper &amp; Co. &quot;Original&quot;" />`;
  assert.equal(
    parseProductMetadata(html).title,
    `Dr. Pepper & Co. "Original"`,
  );
});

test("parseProductMetadata: decodes numeric + hex entities", () => {
  const html = `<meta property="og:title" content="Caf&#233; Bravo &#x2014; 1kg" />`;
  // &#233; = é, &#x2014; = em dash
  assert.equal(parseProductMetadata(html).title, "Café Bravo — 1kg");
});

test("parseProductMetadata: strips 'Amazon: ' prefix from <title>", () => {
  const html = `<title>Amazon.com: Urnex Rinza Acid Cleaner</title>`;
  assert.match(
    parseProductMetadata(html).title ?? "",
    /^Urnex Rinza/,
  );
});

test("parseProductMetadata: strips ' | Walmart' suffix from <title>", () => {
  const html = `<title>Great Value Olive Oil | Walmart.com</title>`;
  assert.equal(parseProductMetadata(html).title, "Great Value Olive Oil");
});

test("parseProductMetadata: rejects absurdly-long <h1> (>=200 chars is probably page dump)", () => {
  const h1 = "A".repeat(250);
  const html = `<h1>${h1}</h1><title>Short Title</title>`;
  // H1 too long → fall through to <title>.
  assert.equal(parseProductMetadata(html).title, "Short Title");
});

test("parseProductMetadata: rejects <h1> under 3 chars (nav glyph, not product name)", () => {
  const html = `<h1>A</h1><title>Real Title</title>`;
  assert.equal(parseProductMetadata(html).title, "Real Title");
});

// ── parseProductMetadata: description ────────────────────────────

test("parseProductMetadata: extracts og:description", () => {
  const html = `<meta property="og:description" content="A fine espresso cleaner" />`;
  assert.equal(
    parseProductMetadata(html).description,
    "A fine espresso cleaner",
  );
});

test("parseProductMetadata: falls back to twitter:description then generic description", () => {
  const tw = `<meta name="twitter:description" content="Twitter desc" />`;
  assert.equal(parseProductMetadata(tw).description, "Twitter desc");
  const gen = `<meta name="description" content="Generic desc" />`;
  assert.equal(parseProductMetadata(gen).description, "Generic desc");
});

test("parseProductMetadata: truncates description at 300 chars", () => {
  const long = "x".repeat(400);
  const html = `<meta property="og:description" content="${long}" />`;
  const desc = parseProductMetadata(html).description;
  assert.equal(desc?.length, 300);
});

test("parseProductMetadata: null description when no meta tag", () => {
  assert.equal(parseProductMetadata("<title>x</title>").description, null);
});

// ── parseProductMetadata: image URL ──────────────────────────────

test("parseProductMetadata: extracts og:image verbatim (no cleaning)", () => {
  // Image URLs aren't text — must not be run through entity decoder
  // or tag stripper.
  const url = "https://images.example.com/p/12345.jpg?v=2";
  const html = `<meta property="og:image" content="${url}" />`;
  assert.equal(parseProductMetadata(html).imageUrl, url);
});

test("parseProductMetadata: falls back to twitter:image", () => {
  const url = "https://images.example.com/tw.jpg";
  const html = `<meta name="twitter:image" content="${url}" />`;
  assert.equal(parseProductMetadata(html).imageUrl, url);
});

test("parseProductMetadata: null imageUrl when neither og:image nor twitter:image present", () => {
  assert.equal(parseProductMetadata("<title>x</title>").imageUrl, null);
});

// ── parseProductMetadata: robustness ────────────────────────────

test("parseProductMetadata: handles meta tags with extra attributes", () => {
  const html = `<meta itemprop="name" property="og:title" data-foo="x" content="Title" lang="en" />`;
  assert.equal(parseProductMetadata(html).title, "Title");
});

test("parseProductMetadata: ignores attribute names that only *contain* the target key", () => {
  // A `property="not-og:title-suffix"` must NOT match og:title.
  const html = `
    <meta property="not-og:title-suffix" content="Wrong" />
    <meta property="og:title" content="Correct" />
  `;
  assert.equal(parseProductMetadata(html).title, "Correct");
});

test("parseProductMetadata: tolerates unclosed or mis-ordered tags", () => {
  // Real-world HTML is messy. Parser must not throw.
  const html = `<meta property="og:title" content="Fine" ><title>Also fine`;
  assert.doesNotThrow(() => parseProductMetadata(html));
  assert.equal(parseProductMetadata(html).title, "Fine");
});

test("parseProductMetadata: case-insensitive on tag + attribute names", () => {
  const html = `<META PROPERTY="OG:TITLE" CONTENT="All Caps Title" />`;
  assert.equal(parseProductMetadata(html).title, "All Caps Title");
});

// ── fetchProductMetadata: orchestration with stubs ──────────────

test("fetchProductMetadata: direct tier succeeds, no puppeteer/microlink called", async () => {
  await quiet(async () => {
    _resetProductMetadataCacheForTests();
    let puppeteerCalls = 0;
    const fetchImpl = (async () =>
      new Response(
        `<meta property="og:title" content="Directly Fetched" />`,
        { status: 200, headers: { "content-type": "text/html" } },
      )) as typeof fetch;
    const result = await fetchProductMetadata("https://sysco.com/x", {
      fetchImpl,
      puppeteerImpl: async () => {
        puppeteerCalls += 1;
        return null;
      },
    });
    assert.equal(result?.title, "Directly Fetched");
    assert.equal(result?.source, "direct");
    assert.equal(puppeteerCalls, 0, "puppeteer must not run when direct succeeds");
  });
});

test("fetchProductMetadata: skips direct tier for Amazon (known bot-blocker)", async () => {
  await quiet(async () => {
    _resetProductMetadataCacheForTests();
    let directCalls = 0;
    let puppeteerCalls = 0;
    const fetchImpl = (async () => {
      directCalls += 1;
      return new Response("", { status: 200 });
    }) as typeof fetch;
    const puppeteerImpl = async () => {
      puppeteerCalls += 1;
      return { title: "From Puppeteer", description: null, imageUrl: null };
    };
    const result = await fetchProductMetadata("https://www.amazon.com/dp/B000", {
      fetchImpl,
      puppeteerImpl,
    });
    assert.equal(result?.title, "From Puppeteer");
    assert.equal(result?.source, "puppeteer");
    assert.equal(directCalls, 0, "direct must be skipped for amazon.com");
    assert.equal(puppeteerCalls, 1);
  });
});

test("fetchProductMetadata: skips direct for costco + walmart + target + samsclub too", async () => {
  for (const host of ["costco.com", "walmart.com", "target.com", "samsclub.com"]) {
    await quiet(async () => {
      _resetProductMetadataCacheForTests();
      let directCalls = 0;
      const fetchImpl = (async () => {
        directCalls += 1;
        return new Response("", { status: 200 });
      }) as typeof fetch;
      await fetchProductMetadata(`https://www.${host}/p`, {
        fetchImpl,
        puppeteerImpl: async () => ({
          title: "Valid Title",
          description: null,
          imageUrl: null,
        }),
      });
      assert.equal(directCalls, 0, `direct called for ${host}`);
    });
  }
});

test("fetchProductMetadata: direct hits then puppeteer when direct returns empty title", async () => {
  await quiet(async () => {
    _resetProductMetadataCacheForTests();
    let directCalls = 0;
    let puppeteerCalls = 0;
    const fetchImpl = (async () => {
      directCalls += 1;
      // No og:title, no h1, no <title>.
      return new Response("<html>no meta</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;
    const result = await fetchProductMetadata("https://example.com/p", {
      fetchImpl,
      puppeteerImpl: async () => {
        puppeteerCalls += 1;
        return { title: "Rescued By Puppeteer", description: null, imageUrl: null };
      },
    });
    assert.equal(directCalls, 1);
    assert.equal(puppeteerCalls, 1);
    assert.equal(result?.title, "Rescued By Puppeteer");
    assert.equal(result?.source, "puppeteer");
  });
});

test("fetchProductMetadata: preferService=true skips direct entirely", async () => {
  await quiet(async () => {
    _resetProductMetadataCacheForTests();
    let directCalls = 0;
    const fetchImpl = (async () => {
      directCalls += 1;
      return new Response("", { status: 200 });
    }) as typeof fetch;
    await fetchProductMetadata("https://example.com/p", {
      fetchImpl,
      preferService: true,
      puppeteerImpl: async () => ({
        title: "Valid",
        description: null,
        imageUrl: null,
      }),
    });
    assert.equal(directCalls, 0);
  });
});

test("fetchProductMetadata: all three tiers fail → returns null", async () => {
  await quiet(async () => {
    _resetProductMetadataCacheForTests();
    const fetchImpl = (async (url: string) => {
      // Microlink called with ?url=... param. Return 500.
      if (url.startsWith("https://api.microlink.io/")) {
        return new Response("", { status: 500 });
      }
      // Direct: empty body.
      return new Response("", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;
    const result = await fetchProductMetadata("https://example.com/p", {
      fetchImpl,
      puppeteerImpl: async () => null,
    });
    assert.equal(result, null);
  });
});

test("fetchProductMetadata: cache returns same value on second call (no fetches)", async () => {
  await quiet(async () => {
    _resetProductMetadataCacheForTests();
    let fetchCalls = 0;
    const fetchImpl = (async () => {
      fetchCalls += 1;
      return new Response(`<meta property="og:title" content="Cached Thing" />`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;
    const first = await fetchProductMetadata("https://example.com/p", { fetchImpl });
    const second = await fetchProductMetadata("https://example.com/p", { fetchImpl });
    assert.equal(fetchCalls, 1, "second call must hit cache");
    assert.equal(first?.title, "Cached Thing");
    assert.equal(second?.title, "Cached Thing");
    assert.equal(second?.source, "cache");
  });
});

test("fetchProductMetadata: cache key strips tracking params (ref, pd_rd)", async () => {
  await quiet(async () => {
    _resetProductMetadataCacheForTests();
    let fetchCalls = 0;
    const fetchImpl = (async () => {
      fetchCalls += 1;
      return new Response(`<meta property="og:title" content="Same Product" />`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;
    // Two URLs that differ only in tracking params — cache should
    // treat them as the same product.
    await fetchProductMetadata("https://example.com/p?ref=abc&pd_rd_x=1", {
      fetchImpl,
    });
    const second = await fetchProductMetadata(
      "https://example.com/p?ref=xyz&pd_rd_w=2",
      { fetchImpl },
    );
    assert.equal(fetchCalls, 1, "tracking-param variants should share cache slot");
    assert.equal(second?.source, "cache");
  });
});

test("fetchProductMetadata: skipCache forces re-fetch", async () => {
  await quiet(async () => {
    _resetProductMetadataCacheForTests();
    let fetchCalls = 0;
    const fetchImpl = (async () => {
      fetchCalls += 1;
      return new Response(`<meta property="og:title" content="Valid Title" />`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;
    await fetchProductMetadata("https://example.com/p", { fetchImpl });
    await fetchProductMetadata("https://example.com/p", { fetchImpl, skipCache: true });
    assert.equal(fetchCalls, 2);
  });
});

test("fetchProductMetadata: non-HTML content-type falls through to puppeteer", async () => {
  await quiet(async () => {
    _resetProductMetadataCacheForTests();
    const fetchImpl = (async () =>
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    let puppeteerCalls = 0;
    await fetchProductMetadata("https://example.com/api", {
      fetchImpl,
      puppeteerImpl: async () => {
        puppeteerCalls += 1;
        return { title: "From Fallback", description: null, imageUrl: null };
      },
    });
    assert.equal(puppeteerCalls, 1);
  });
});

test("fetchProductMetadata: HTTP 404 falls through to puppeteer", async () => {
  await quiet(async () => {
    _resetProductMetadataCacheForTests();
    const fetchImpl = (async () =>
      new Response("", { status: 404 })) as typeof fetch;
    const result = await fetchProductMetadata("https://example.com/gone", {
      fetchImpl,
      puppeteerImpl: async () => ({ title: "Found It", description: null, imageUrl: null }),
    });
    assert.equal(result?.title, "Found It");
  });
});

test("fetchProductMetadata: ignores title shorter than 3 chars (noise, not a real product name)", async () => {
  await quiet(async () => {
    _resetProductMetadataCacheForTests();
    const fetchImpl = (async () =>
      new Response(`<meta property="og:title" content="X" />`, {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof fetch;
    let puppeteerCalls = 0;
    const result = await fetchProductMetadata("https://example.com/p", {
      fetchImpl,
      puppeteerImpl: async () => {
        puppeteerCalls += 1;
        return { title: "Proper Title", description: null, imageUrl: null };
      },
    });
    assert.equal(puppeteerCalls, 1, "1-char title should fall through");
    assert.equal(result?.title, "Proper Title");
  });
});
