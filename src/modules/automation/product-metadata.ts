/**
 * Fetches a product URL and extracts title / description / image.
 * Used by the order sniffer + `quick_add_and_order` tool so the bot
 * knows the real product name even when the URL has no slug (e.g.
 * Amazon's `/dp/B000FDL68W?ref=...` format), instead of falling back
 * to a useless placeholder like "Item from Amazon".
 *
 * Three-tier strategy with an in-memory cache on top:
 *
 *   0. CACHE — same URL within an hour → instant return. Doubles
 *      as a rate-limit shield for microlink.
 *
 *   1. DIRECT HTTP — plain fetch with a browser UA. Fast (<1s), free.
 *      Works on most sites. Skipped for known bot-blocking hostnames
 *      (Amazon, Costco, Walmart, etc.) so we don't waste 5s on a
 *      guaranteed captcha page.
 *
 *   2. PUPPETEER (our own Chrome) — primary for bot-blocked sites,
 *      fallback for everything else. Completely free, no rate limit,
 *      no third-party dependency, reuses the Chrome binary the
 *      ordering agent already downloaded to /tmp/.chrome-cache.
 *      Slower (~3-5s) but reliable — real browser TLS fingerprint.
 *      Browser instance is process-shared + idle-closes after 5min
 *      so back-to-back fetches only pay launch cost once.
 *
 *   3. MICROLINK.IO — last-resort emergency fallback. Free public
 *      API (50 req/day/IP, no key required). Only fires if both
 *      direct AND puppeteer failed. In practice puppeteer always
 *      wins on Railway, so we rarely if ever hit this.
 *
 * Failures return null. All decisions log to console so production
 * issues are debuggable from Railway logs alone.
 */

const DEFAULT_TIMEOUT_MS = 5000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MICROLINK_ENDPOINT = "https://api.microlink.io/";

export type ProductMetadata = {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  /** Which path produced the metadata — for logging + debug. */
  source?: "direct" | "puppeteer" | "microlink" | "cache" | "none";
};

// ── In-memory URL → metadata cache ──────────────────────────────────
// Same URL pasted twice (by the same or different managers) → second
// hit is instant, doesn't spend Chrome / microlink budget.
type CacheEntry = { at: number; value: ProductMetadata };
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, CacheEntry>();

function cacheKey(url: string): string {
  // Normalise URL for caching — strip tracking query params that
  // don't affect the product identity (ref, pd_rd_*, psc, etc.).
  try {
    const parsed = new URL(url);
    const keep = new URLSearchParams();
    for (const [k, v] of parsed.searchParams.entries()) {
      if (/^(?:tag|asin|k|q)$/i.test(k)) keep.set(k, v);
    }
    parsed.search = keep.toString();
    return parsed.toString();
  } catch {
    return url;
  }
}

function cacheGet(url: string): ProductMetadata | null {
  const key = cacheKey(url);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(url: string, value: ProductMetadata): void {
  const key = cacheKey(url);
  cache.set(key, { at: Date.now(), value });
  // Simple FIFO eviction when we exceed the cap.
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

/** Test helper: reset the cache so scenarios don't bleed into each other. */
export function _resetProductMetadataCacheForTests(): void {
  cache.clear();
}

/**
 * Hostnames where we've empirically confirmed direct fetch is
 * blocked / returns no metadata. Short-circuit those straight to
 * microlink — saves 5s wasted on a guaranteed-to-fail direct fetch.
 */
const DIRECT_FETCH_BLOCKED = [
  /(^|\.)amazon\./i,
  /(^|\.)amzn\.to$/i,
  /(^|\.)a\.co$/i,
  /(^|\.)costco\./i,
  /(^|\.)walmart\./i,
  /(^|\.)target\.com$/i,
  /(^|\.)samsclub\.com$/i,
];

function isKnownToBlockDirect(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return DIRECT_FETCH_BLOCKED.some((rx) => rx.test(host));
  } catch {
    return false;
  }
}

/**
 * Primary public API. Order of attempts (first title wins):
 *   0. In-memory cache (1h TTL)
 *   1. Direct HTTP fetch — skipped for known-blocked hostnames
 *   2. Puppeteer (our own Chrome) — unlimited, free, reliable
 *   3. Microlink.io — 50/day free emergency fallback
 *
 * Tests inject `fetchImpl` + `puppeteerImpl` to stub network calls.
 */
export async function fetchProductMetadata(
  url: string,
  options?: {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    /** Skip direct fetch entirely (force service/puppeteer path). */
    preferService?: boolean;
    /** Test-only: inject a stub for the puppeteer path. */
    puppeteerImpl?: (url: string) => Promise<ProductMetadata | null>;
    /** Test-only: disable puppeteer fallback (e.g. when Chrome isn't available). */
    skipPuppeteer?: boolean;
    /** Test-only: bypass the in-memory cache. */
    skipCache?: boolean;
  }
): Promise<ProductMetadata | null> {
  const label = truncateForLog(url, 80);

  // Cache hit → instant return.
  if (!options?.skipCache) {
    const cached = cacheGet(url);
    if (cached) {
      console.log(`[product-metadata] cache hit for ${label}: "${truncateForLog(cached.title ?? "", 60)}"`);
      return { ...cached, source: "cache" };
    }
  }

  const skipDirect = options?.preferService || isKnownToBlockDirect(url);

  // Tier 1: direct HTTP (skipped for known-blocked hostnames).
  if (!skipDirect) {
    const direct = await fetchDirect(url, options);
    if (direct?.title && direct.title.length >= 3) {
      console.log(`[product-metadata] direct hit for ${label}: "${truncateForLog(direct.title, 60)}"`);
      const result = { ...direct, source: "direct" as const };
      cacheSet(url, result);
      return result;
    }
    console.log(`[product-metadata] direct missed for ${label}; trying puppeteer`);
  } else {
    console.log(`[product-metadata] skipping direct for ${label} (known to block); using puppeteer`);
  }

  // Tier 2: puppeteer (our own Chrome — free, unlimited).
  if (!options?.skipPuppeteer) {
    const fetcher =
      options?.puppeteerImpl ??
      (async (u: string) => {
        try {
          const mod = await import("@/modules/automation/product-metadata-puppeteer");
          return await mod.fetchViaPuppeteer(u);
        } catch (err) {
          console.log(
            "[product-metadata] puppeteer module unavailable:",
            err instanceof Error ? err.message : String(err)
          );
          return null;
        }
      });
    const viaPuppeteer = await fetcher(url);
    if (viaPuppeteer?.title && viaPuppeteer.title.length >= 3) {
      console.log(
        `[product-metadata] puppeteer hit for ${label}: "${truncateForLog(viaPuppeteer.title, 60)}"`
      );
      const result = { ...viaPuppeteer, source: "puppeteer" as const };
      cacheSet(url, result);
      return result;
    }
    console.log(`[product-metadata] puppeteer missed for ${label}; trying microlink`);
  }

  // Tier 3: microlink.io emergency fallback.
  const viaService = await fetchViaMicrolink(url, options);
  if (viaService?.title) {
    console.log(
      `[product-metadata] microlink hit for ${label}: "${truncateForLog(viaService.title, 60)}"`
    );
    const result = { ...viaService, source: "microlink" as const };
    cacheSet(url, result);
    return result;
  }
  console.log(`[product-metadata] all paths failed for ${label}`);
  return null;
}

function truncateForLog(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + "…";
}

/**
 * Plain HTTP GET + HTML regex parse. First-line-of-defence.
 */
async function fetchDirect(
  url: string,
  options?: { timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<ProductMetadata | null> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          "Accept-Language": "en-US,en;q=0.9",
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        },
        signal: controller.signal,
        redirect: "follow",
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!/html/i.test(contentType)) return null;
    // Cap the body we parse at 512KB — titles live in the <head>
    // section which is always within the first few KB. Spares us
    // memory + time on giant product pages.
    const body = await readFirstBytes(res, 512 * 1024);
    return parseProductMetadata(body);
  } catch {
    return null;
  }
}

/**
 * Microlink.io fallback. Free tier: 50 req/day per IP (no API key).
 * Handles Amazon, Costco, Walmart captchas because they run requests
 * through residential proxies. Slightly slower (2-4s typical) but
 * reliable for sites that block cloud IPs.
 *
 * Response shape (simplified):
 *   {
 *     status: "success",
 *     data: {
 *       title: "Urnex Rinza...",
 *       description: "...",
 *       image: { url: "https://..." },
 *       ...
 *     }
 *   }
 */
async function fetchViaMicrolink(
  url: string,
  options?: { timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<ProductMetadata | null> {
  const timeoutMs = options?.timeoutMs ?? 8000;
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const apiUrl = `${MICROLINK_ENDPOINT}?url=${encodeURIComponent(url)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(apiUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      console.log(`[product-metadata] microlink HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json().catch(() => null)) as {
      status?: string;
      data?: {
        title?: string | null;
        description?: string | null;
        image?: { url?: string | null } | null;
      };
      message?: string;
    } | null;
    if (!json) return null;
    if (json.status !== "success") {
      console.log(`[product-metadata] microlink status=${json.status} msg=${json.message ?? ""}`);
      return null;
    }
    const data = json.data ?? {};
    return {
      title: cleanText(data.title ?? "") || null,
      description: cleanText(data.description ?? "") || null,
      imageUrl: data.image?.url ?? null,
    };
  } catch (err) {
    console.log(
      `[product-metadata] microlink error:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

async function readFirstBytes(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    reader.releaseLock();
  } catch {
    /* ignore — return what we have */
  }
  const merged = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const c of chunks) {
    if (offset + c.byteLength > maxBytes) {
      merged.set(c.subarray(0, maxBytes - offset), offset);
      offset = maxBytes;
      break;
    }
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

/**
 * Pure HTML → metadata parser. Exported for tests. Tolerates
 * missing / partial head sections, out-of-order attributes, both
 * quote styles.
 */
export function parseProductMetadata(html: string): ProductMetadata {
  return {
    title: extractTitle(html),
    description: extractDescription(html),
    imageUrl: extractImageUrl(html),
  };
}

function extractTitle(html: string): string | null {
  // Preference order:
  //   1. og:title meta tag (purpose-built for sharing)
  //   2. Amazon's #productTitle span (most accurate for Amazon)
  //   3. <title> tag (least reliable — often has "- Amazon.com" noise)
  const ogTitle = matchMeta(html, "og:title") ?? matchMeta(html, "twitter:title");
  if (ogTitle) return cleanTitle(ogTitle);

  const amazonProductTitle = html.match(
    /<span[^>]*\bid\s*=\s*["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i
  );
  if (amazonProductTitle) return cleanTitle(amazonProductTitle[1]);

  // Many sites wrap the product name in <h1>. Grab the first one.
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const cleaned = cleanTitle(h1[1]);
    if (cleaned && cleaned.length >= 3 && cleaned.length < 200) return cleaned;
  }

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTag) return cleanTitle(titleTag[1]);

  return null;
}

function extractDescription(html: string): string | null {
  const og =
    matchMeta(html, "og:description") ??
    matchMeta(html, "twitter:description") ??
    matchMeta(html, "description");
  return og ? cleanText(og).slice(0, 300) : null;
}

function extractImageUrl(html: string): string | null {
  const og = matchMeta(html, "og:image") ?? matchMeta(html, "twitter:image");
  if (og) return og;
  return null;
}

/**
 * Grab the `content` attribute of a meta tag matching the given
 * `property` or `name`. Handles both attribute orderings.
 */
function matchMeta(html: string, key: string): string | null {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // property="X" content="Y"
  const a = html.match(
    new RegExp(
      `<meta[^>]*\\b(?:property|name)\\s*=\\s*["']${esc}["'][^>]*\\bcontent\\s*=\\s*["']([^"']+)["']`,
      "i"
    )
  );
  if (a) return a[1];
  // content="Y" property="X"
  const b = html.match(
    new RegExp(
      `<meta[^>]*\\bcontent\\s*=\\s*["']([^"']+)["'][^>]*\\b(?:property|name)\\s*=\\s*["']${esc}["']`,
      "i"
    )
  );
  if (b) return b[1];
  return null;
}

function cleanTitle(raw: string): string | null {
  const cleaned = cleanText(raw);
  if (!cleaned) return null;
  // Strip common "... - SiteName" suffixes.
  const stripped = cleaned
    .replace(/\s[-|·:]\s+(?:Amazon(?:\.[a-z.]+)?|Walmart|Costco|Target|eBay).*$/i, "")
    .replace(/^Amazon(?:\.[a-z.]+)?\s*:\s*/i, "")
    .trim();
  if (stripped.length === 0) return cleaned;
  return stripped;
}

function cleanText(raw: string): string {
  return decodeHtmlEntities(stripTags(raw).replace(/\s+/g, " ").trim());
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
