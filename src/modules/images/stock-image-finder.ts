/**
 * Stock product image finder.
 *
 * For INVENTORY items (raw ingredients, packaging — the real
 * physical products with specific brands), we want the actual
 * manufacturer/supplier product photo, not AI art. The barista
 * receiving a delivery needs to match the screen to the real
 * carton on the shelf.
 *
 * Cascade per item:
 *   1. Manual upload (wins)
 *   2. Invoice-OCR hint — when a PO delivery scan identifies the
 *      product, feed that name + supplier to Brave Image Search.
 *   3. Brave Image Search with "{supplier name} {product name} product"
 *   4. Fallback: placeholder
 *
 * Never AI-generated. For AI imagery, see menu-image (drinks/foods
 * the café builds itself).
 */

import { db } from "@/lib/db";

const BRAVE_IMAGE_URL = "https://api.search.brave.com/res/v1/images/search";
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024; // 2 MB — bigger = resized or skipped
const SUPPORTED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export type StockImageResult = {
  bytes: Buffer;
  contentType: string;
  sourceUrl: string;
  provider: "brave";
};

/**
 * Find + download a product image for an inventory item. Returns
 * null when Brave isn't configured or no match fits. Callers persist
 * the bytes; this module just fetches.
 */
export async function findStockProductImage(input: {
  itemName: string;
  supplierName?: string | null;
  sku?: string | null;
  category?: string | null;
}): Promise<StockImageResult | null> {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!braveKey) {
    console.warn("[stock-image] BRAVE_SEARCH_API_KEY not set");
    return null;
  }

  // Try progressively broader queries. Starts with supplier-scoped,
  // falls back to name-only if no hits — works whether your supplier
  // name is a real brand (Costco) or a generic placeholder.
  const queries = buildQueryLadder(input);

  for (const query of queries) {
    const hits = await searchBraveImages(query, braveKey).catch((err) => {
      console.error("[stock-image] Brave search error", err);
      return [] as Array<{ url: string }>;
    });
    console.log(
      `[stock-image] query="${query}" → ${hits.length} hits`
    );
    if (hits.length === 0) continue;

    for (const hit of hits.slice(0, 6)) {
      const dl = await tryDownload(hit.url).catch(() => null);
      if (dl) {
        console.log(
          `[stock-image] downloaded ${dl.bytes.length}B ${dl.contentType} from ${hit.url.slice(0, 100)}`
        );
        return { ...dl, sourceUrl: hit.url, provider: "brave" };
      }
    }
    console.warn(
      `[stock-image] all ${hits.length} hits failed to download for query "${query}"`
    );
  }

  return null;
}

/**
 * End-to-end: find image, persist it on InventoryItem. Returns what
 * happened so callers can decide whether to surface a toast / error.
 */
export async function findAndPersistStockImage(input: {
  inventoryItemId: string;
  locationId: string;
}): Promise<
  | { ok: true; sourceUrl: string; provider: string }
  | { ok: false; reason: string }
> {
  const item = await db.inventoryItem.findFirst({
    where: { id: input.inventoryItemId, locationId: input.locationId },
    select: {
      id: true,
      name: true,
      sku: true,
      category: true,
      primarySupplier: { select: { name: true } },
    },
  });
  if (!item) return { ok: false, reason: "Item not found." };

  const result = await findStockProductImage({
    itemName: item.name,
    supplierName: item.primarySupplier?.name ?? null,
    sku: item.sku,
    category: String(item.category),
  });
  if (!result) {
    return {
      ok: false,
      reason:
        "No matching product image found on the web. Try uploading manually or check the supplier's website.",
    };
  }

  await db.inventoryItem.update({
    where: { id: item.id },
    data: {
      imageBytes: new Uint8Array(result.bytes),
      imageContentType: result.contentType,
      imageSource: "web",
      imageGeneratedAt: new Date(),
    },
  });

  return { ok: true, sourceUrl: result.sourceUrl, provider: result.provider };
}

// ── Internals ───────────────────────────────────────────────────────

/**
 * Build a ladder of queries to try in order. First pass uses the
 * supplier brand for specificity; if that returns nothing, subsequent
 * passes loosen the terms until we're down to just the item name +
 * generic category hint. This matters because supplier names in the
 * DB can range from real brands ("Costco") to vague distributor names
 * ("DairyFlow Wholesale") that don't search well.
 */
function buildQueryLadder(input: {
  itemName: string;
  supplierName?: string | null;
  category?: string | null;
}): string[] {
  const name = input.itemName.trim();
  const categoryHint = categoryToSearchWord(input.category);
  const supplier = (input.supplierName ?? "").trim();
  // Skip supplier if it's clearly a generic distributor name — these
  // pollute image results with logos rather than products.
  const skipSupplier =
    !supplier ||
    /wholesale|supply|distribution|distributors|warehouse/i.test(supplier);

  const ladder: string[] = [];
  if (!skipSupplier) ladder.push(`${supplier} ${name} ${categoryHint}`);
  if (!skipSupplier) ladder.push(`${supplier} ${name}`);
  ladder.push(`${name} ${categoryHint}`);
  ladder.push(name);
  // De-dupe while preserving order.
  return [...new Set(ladder.map((q) => q.replace(/\s+/g, " ").trim()))];
}

function categoryToSearchWord(category?: string | null): string {
  switch (category) {
    case "DAIRY":
    case "ALT_DAIRY":
      return "carton";
    case "COFFEE":
      return "bag";
    case "SYRUP":
      return "bottle";
    case "PACKAGING":
    case "PAPER_GOODS":
      return "product";
    case "BAKERY_INGREDIENT":
      return "package";
    default:
      return "product";
  }
}

async function searchBraveImages(
  query: string,
  apiKey: string
): Promise<Array<{ url: string }>> {
  const url = `${BRAVE_IMAGE_URL}?q=${encodeURIComponent(query)}&count=10&safesearch=strict`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "X-Subscription-Token": apiKey,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    console.warn(
      `[stock-image] Brave search returned ${response.status} for query "${query}"`
    );
    return [];
  }
  const body = (await response.json().catch(() => null)) as {
    results?: Array<Record<string, unknown>>;
  } | null;
  const results = body?.results ?? [];
  // Brave's image API field shape varies by version. Try a few paths
  // in priority order so we're robust to shape drift.
  const urls = results
    .map((r) => {
      const props = (r.properties ?? {}) as Record<string, unknown>;
      const thumb = (r.thumbnail ?? {}) as Record<string, unknown>;
      const direct = typeof r.image === "string" ? r.image : null;
      const imageObj = (r.image ?? {}) as Record<string, unknown>;
      return (
        (typeof props.url === "string" && props.url) ||
        (typeof imageObj.url === "string" && imageObj.url) ||
        (typeof thumb.src === "string" && thumb.src) ||
        (typeof r.url === "string" && (r.url as string)) ||
        direct ||
        ""
      );
    })
    .filter((u) => typeof u === "string" && u.startsWith("http"));
  return urls.map((u) => ({ url: u as string }));
}

async function tryDownload(
  url: string
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
        Accept: "image/jpeg,image/png,image/webp,image/*",
      },
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    return null;
  }
  clearTimeout(timeout);
  if (!response.ok) return null;
  const contentType =
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ??
    "";
  if (!SUPPORTED_MIME.has(contentType)) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_DOWNLOAD_BYTES) return null;
  return { bytes: buffer, contentType };
}
