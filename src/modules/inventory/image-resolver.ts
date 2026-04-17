/**
 * Resolve a representative image for an inventory item.
 *
 * Previous version generated AI images via Pollinations. Real users
 * hated them — "very random images" (direct quote), no brand
 * identity, Coke cans showing up for oat milk prompts. We now use a
 * strict preference chain of REAL, verifiable sources:
 *
 *   1. Pasted product URL (Amazon /dp/X, LCBO /product/X, etc.):
 *      fetchProductMetadata resolves og:image → the retailer's own
 *      product shot. Perfect brand identity, matches what the user
 *      saw when they pasted the link.
 *
 *   2. Direct image URL (ends in .jpg/.png/.webp/etc.):
 *      use it verbatim.
 *
 *   3. Supplier website logo (Clearbit):
 *      https://logo.clearbit.com/<hostname> returns the supplier's
 *      brand logo on transparent background — a "branded chip" when
 *      no product shot is available.
 *
 *   4. Letter avatar (data URL SVG):
 *      first letter of the item name on a category-colored square.
 *      Honest, never random, zero network.
 *
 * Returns a URL string. Callers can persist it on InventoryItem.
 */

export type ResolveImageInput = {
  name: string;
  /** Free-text brand hint or supplier name, for avatar fallback. */
  brand?: string | null;
  category?: string | null;
  /**
   * URL the user pasted — product page (og:image) OR a direct image
   * URL (used verbatim). When set, this is the preferred source.
   */
  productUrl?: string | null;
  /**
   * Supplier's primary website (e.g. https://shop.sysco.com). Used
   * for the Clearbit logo fallback.
   */
  supplierWebsite?: string | null;
};

const IMAGE_EXTENSION_RE = /\.(?:jpe?g|png|webp|gif|avif|svg)(?:\?|#|$)/i;

const CATEGORY_COLORS: Record<string, string> = {
  COFFEE: "#5b3a1f",
  DAIRY: "#f3f4f6",
  ALT_DAIRY: "#e8dcc2",
  SYRUP: "#8a2f2f",
  BAKERY_INGREDIENT: "#c78341",
  PACKAGING: "#d4d4d4",
  CLEANING: "#3b82f6",
  PAPER_GOODS: "#f5deb3",
  RETAIL: "#6366f1",
  SEASONAL: "#f59e0b",
  SUPPLY: "#64748b",
};

/**
 * Synchronous resolver — returns a URL immediately without any
 * network fetches. Uses whatever's already on-hand:
 *   - a productUrl that's a direct image → use it
 *   - a supplierWebsite → Clearbit logo
 *   - otherwise: letter avatar data URL
 *
 * For the og:image extraction path (requires an HTTP fetch), see
 * resolveProductImage below.
 */
export function buildInventoryImageUrl(input: ResolveImageInput): string {
  // Direct image URL → use it. Most common when a manager pastes a
  // link that already points at a .jpg (rare) or when we've cached
  // a resolved og:image.
  if (input.productUrl && IMAGE_EXTENSION_RE.test(input.productUrl)) {
    return input.productUrl;
  }

  // Clearbit logo for the supplier. Free, no key, returns the
  // company's real logo. Works for amazon.com, costco.com, sysco
  // subdomains, and most sites with any web presence.
  if (input.supplierWebsite) {
    const host = hostnameOf(input.supplierWebsite);
    if (host) {
      return `https://logo.clearbit.com/${host}?size=256`;
    }
  }

  // Fallback: letter avatar. Honest, never wrong, never random.
  return buildLetterAvatarDataUrl(input);
}

/**
 * Async resolver — does the og:image fetch for product pages.
 * Use this when you're creating or updating an item and want the
 * highest-quality image cached on the row. Falls back to the
 * synchronous buildInventoryImageUrl if the fetch fails or times
 * out.
 */
export async function resolveProductImage(
  input: ResolveImageInput,
  options?: { timeoutMs?: number }
): Promise<string> {
  // If productUrl is a product page (not a direct image), try og:image.
  if (input.productUrl && !IMAGE_EXTENSION_RE.test(input.productUrl)) {
    try {
      const { fetchProductMetadata } = await import(
        "@/modules/automation/product-metadata"
      );
      const meta = await fetchProductMetadata(input.productUrl, {
        timeoutMs: options?.timeoutMs ?? 5000,
        skipPuppeteer: true, // keep this fast; puppeteer is too heavy here
      });
      if (meta?.imageUrl) {
        return meta.imageUrl;
      }
    } catch {
      /* fall through */
    }
  }
  return buildInventoryImageUrl(input);
}

function hostnameOf(url: string): string | null {
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function buildLetterAvatarDataUrl(input: ResolveImageInput): string {
  const letter = (input.name.trim().charAt(0) || "?").toUpperCase();
  const bg =
    CATEGORY_COLORS[(input.category ?? "SUPPLY").toUpperCase()] ??
    CATEGORY_COLORS.SUPPLY;
  const fg = contrastColor(bg);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="16" fill="${bg}"/><text x="50%" y="52%" font-family="system-ui,-apple-system,sans-serif" font-size="64" font-weight="700" fill="${fg}" text-anchor="middle" dominant-baseline="middle">${escapeXml(letter)}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function contrastColor(hex: string): string {
  // Dark-on-light / light-on-dark via luminance threshold.
  const h = hex.replace("#", "");
  if (h.length !== 6) return "#111827";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#111827" : "#ffffff";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
