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
  if (!braveKey) return null;

  const query = buildSearchQuery(input);
  const hits = await searchBraveImages(query, braveKey).catch(() => []);
  if (hits.length === 0) return null;

  // Try each hit until we get a usable image. Brave ranks by
  // relevance so the first one is usually fine; we just need to
  // survive the occasional HEAD 403 / HTML-instead-of-image.
  for (const hit of hits.slice(0, 4)) {
    const dl = await tryDownload(hit.url).catch(() => null);
    if (dl) {
      return { ...dl, sourceUrl: hit.url, provider: "brave" };
    }
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

function buildSearchQuery(input: {
  itemName: string;
  supplierName?: string | null;
  sku?: string | null;
  category?: string | null;
}): string {
  const parts: string[] = [];
  if (input.supplierName) {
    // Supplier name (e.g. "Kirkland Signature") pins the brand.
    parts.push(input.supplierName);
  }
  parts.push(input.itemName);
  // Category word helps disambiguate generic names — a bare "Oat Milk"
  // returns a sea of recipes; "Oat Milk dairy product" surfaces cartons.
  if (input.category === "DAIRY" || input.category === "ALT_DAIRY") {
    parts.push("product carton");
  } else if (input.category === "PACKAGING" || input.category === "PAPER_GOODS") {
    parts.push("product");
  } else {
    parts.push("product packaging");
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

async function searchBraveImages(
  query: string,
  apiKey: string
): Promise<Array<{ url: string }>> {
  const url = `${BRAVE_IMAGE_URL}?q=${encodeURIComponent(query)}&count=10&safesearch=strict`;
  const response = await fetch(url, {
    headers: {
      "X-Subscription-Token": apiKey,
      Accept: "application/json",
    },
  });
  if (!response.ok) return [];
  const body = (await response.json().catch(() => null)) as {
    results?: Array<{
      properties?: { url?: string };
      thumbnail?: { src?: string };
    }>;
  } | null;
  const results = body?.results ?? [];
  return results
    .map((r) => ({
      url:
        r.properties?.url ??
        r.thumbnail?.src ??
        "",
    }))
    .filter((r) => r.url.startsWith("http"));
}

async function tryDownload(
  url: string
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
      Accept: "image/jpeg,image/png,image/webp,image/*",
    },
  });
  if (!response.ok) return null;
  const contentType =
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ??
    "";
  if (!SUPPORTED_MIME.has(contentType)) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_DOWNLOAD_BYTES) return null;
  return { bytes: buffer, contentType };
}
