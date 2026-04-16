/**
 * Fetches a product URL and extracts title / description / image.
 * Used by the order sniffer + `quick_add_and_order` tool so the bot
 * knows the real product name even when the URL has no slug (e.g.
 * Amazon's `/dp/B000FDL68W?ref=...` format), instead of falling back
 * to a useless placeholder like "Item from Amazon".
 *
 * Pure HTTP GET + HTML-regex parsing. No headless browser here —
 * that's reserved for the cart-filling agent that runs later. A 5s
 * timeout caps the worst case; failure returns null so callers can
 * fall back to whatever name they had.
 *
 * Amazon sometimes serves a captcha to non-browser clients. A
 * realistic User-Agent and Accept-Language header side-step the
 * simplest checks; if we still get blocked, the browser agent's
 * post-navigation title-read (in browser-agent.ts) is the safety net.
 */

const DEFAULT_TIMEOUT_MS = 5000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type ProductMetadata = {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
};

export async function fetchProductMetadata(
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
