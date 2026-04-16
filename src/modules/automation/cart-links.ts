/**
 * Builds tap-to-open buttons for the cart-ready Telegram message.
 *
 * The hard truth about transferring an Amazon cart in 2026: the old
 * `/gp/aws/cart/add.html?ASIN.1=...` Associates URL is unreliable —
 * Amazon either drops the items at the sign-in redirect or silently
 * shows an empty cart. The ONLY reliable way to put items into the
 * manager's real Amazon cart is to use saved cookies (the agent runs
 * in the manager's logged-in session, so the cart it builds IS the
 * manager's cart). Without cookies, the agent's cart lives in its
 * own ephemeral session and the manager has to re-add the items in
 * their own browser.
 *
 * So the buttons we render depend on `hasCredentials`:
 *
 *   WITH cookies:
 *     - "🛒 Open my cart on Amazon" — works, cart is populated
 *
 *   WITHOUT cookies (or non-Amazon supplier):
 *     - One "📦 <name>" button per line item, opening the product
 *       page directly so the manager can tap "Add to Cart" themselves
 *     - "🌐 Open <supplier>" as a fallback
 *
 * No more broken `add.html` URL. We learned the hard way (real user
 * tapped "Add to MY cart", logged in, found an empty cart).
 */

export type CartLine = {
  /** Item name shown to the user. */
  description: string;
  /** Quantity to order. */
  quantityOrdered: number;
  /** Pasted product URL — we extract ASINs from here. May be null. */
  productUrl: string | null;
  /**
   * Whether the agent successfully added this line to the cart. When
   * false, we suppress the per-product link (it almost certainly
   * points at the same broken page that just failed) and prefer a
   * search-by-name URL instead so the manager can find the product
   * themselves.
   */
  added?: boolean;
};

export type ProductPageButton = {
  text: string;
  url: string;
};

export type CartLinks = {
  /**
   * Opens the supplier's cart page when the agent has saved
   * credentials (cart was built in the manager's real session).
   * Null otherwise — opening the cart in a fresh session shows
   * nothing useful.
   */
  openCartUrl: string | null;
  /**
   * Direct links to the product pages — used when no credentials
   * are saved, so the manager can tap straight to each product and
   * add it to their own cart manually. Empty array for generic
   * sites (no per-product URL available) or when credentials make
   * them unnecessary.
   */
  productButtons: ProductPageButton[];
  /** Human-friendly label for the open-cart button (varies by site). */
  openCartLabel: string;
  /** Whether this is an Amazon-style supplier — controls which buttons to show. */
  isAmazon: boolean;
};

const AMAZON_HOSTS = /(?:^|\.)amazon\.(?:com|ca|co\.uk|de|fr|es|it|co\.jp|com\.au|com\.mx|com\.br)$/i;
const AMAZON_SHORTLINKS = /^(?:amzn\.to|a\.co)$/i;

function detectAmazonHostname(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (AMAZON_HOSTS.test(host) || AMAZON_SHORTLINKS.test(host)) return host;
    return null;
  } catch {
    return null;
  }
}

/**
 * Pull the 10-character ASIN out of an Amazon product URL.
 * Returns null for shortlinks (a.co, amzn.to) — those need to be
 * resolved via HTTP first, which we don't do at PO time.
 */
export function extractAmazonAsin(url: string | null | undefined): string | null {
  if (!url) return null;
  // Standard format: /dp/B005YJZE2I or /gp/product/B005YJZE2I
  const dpMatch = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  if (dpMatch) return dpMatch[1].toUpperCase();
  return null;
}

/**
 * Pick the canonical Amazon storefront for cart links. We prefer
 * the supplier.website if it's an Amazon root (e.g. https://www.amazon.ca)
 * because the user's account is locale-specific. Falls back to .com.
 */
function pickAmazonStorefront(supplierWebsite: string | null | undefined): string {
  if (!supplierWebsite) return "https://www.amazon.com";
  try {
    const parsed = new URL(supplierWebsite);
    if (AMAZON_HOSTS.test(parsed.hostname)) {
      return `${parsed.protocol}//${parsed.hostname}`;
    }
  } catch {
    /* fall through */
  }
  return "https://www.amazon.com";
}

export function buildCartLinks(input: {
  supplierWebsite: string | null;
  supplierName: string;
  lines: CartLine[];
  /**
   * True when the agent ran with the manager's saved cookies, so
   * the cart it built is in the manager's REAL Amazon account.
   * Without cookies, "open cart" lands them in their own empty
   * cart — so we suppress that button and offer per-product links
   * instead.
   */
  hasCredentials: boolean;
}): CartLinks {
  const isAmazon =
    !!detectAmazonHostname(input.supplierWebsite) ||
    input.lines.some((l) => detectAmazonHostname(l.productUrl)) ||
    /amazon/i.test(input.supplierName);

  if (isAmazon) {
    const storefront = pickAmazonStorefront(input.supplierWebsite);
    const truncate = (s: string) => (s.length > 24 ? s.slice(0, 22) + "…" : s);

    // Build buttons line-by-line. For each line:
    //   - If added=true (or unset, meaning unknown — assume ok) AND
    //     we have an ASIN → /dp/<ASIN> direct link
    //   - If added=false (the agent failed on this line, usually
    //     because the URL was broken) → search-by-name URL instead,
    //     so the manager can find a working product page
    //   - Cap at 3 to keep the keyboard tidy
    const productButtons: ProductPageButton[] = [];
    for (const line of input.lines.slice(0, 3)) {
      const labelBase = (line.description || "").trim();
      const label = truncate(labelBase) || "product";
      const asin = extractAmazonAsin(line.productUrl);
      const wasAdded = line.added !== false; // undefined → assume yes
      if (asin && wasAdded) {
        productButtons.push({
          text: `📦 ${label}`,
          url: `${storefront}/dp/${asin}`,
        });
      } else if (labelBase) {
        // Search fallback. Strip emoji from the search query but
        // leave it on the button label so it's distinguishable from
        // the success-case button.
        productButtons.push({
          text: `🔍 Search: ${label}`,
          url: `${storefront}/s?k=${encodeURIComponent(labelBase)}`,
        });
      }
    }

    // Heuristic: if no line was successfully added, we had a total
    // failure. In that case the open-cart link would point at an
    // empty cart even with cookies (because nothing was added to
    // the user's session either). Show search-only.
    const anyAdded = input.lines.some((l) => l.added !== false);
    const openCartUrl =
      input.hasCredentials && anyAdded ? `${storefront}/gp/cart/view.html` : null;

    return {
      openCartUrl,
      productButtons,
      openCartLabel: "🛒 Open my Amazon cart",
      isAmazon: true,
    };
  }

  // Generic non-Amazon supplier. We don't know the cart-page URL
  // structure, so we link to the home page. With cookies, opening
  // the home page lets them click their cart icon. Without, they
  // can at least navigate to the products.
  return {
    openCartUrl: input.supplierWebsite || null,
    productButtons: [],
    openCartLabel: `🌐 Open ${input.supplierName}`,
    isAmazon: false,
  };
}

/**
 * Convenience: builds the inline keyboard rows for the cart-ready
 * Telegram message. Returns an array of rows ready to drop into
 * `replyMarkup`. Always includes the approve/cancel callback row;
 * URL buttons are added when the helper produces them.
 *
 * Layout:
 *   - Row 1: "🛒 Open my Amazon cart" (only when hasCredentials)
 *   - Rows 2..N: one product-page button per line (max 3, no
 *     cookies case only)
 *   - Last row: ✅ Looks good / ✖ Cancel callbacks
 */
export function buildCartReadyKeyboard(input: {
  agentTaskId: string;
  links: CartLinks;
}): Array<Array<{ text: string; callback_data: string } | { text: string; url: string }>> {
  const rows: Array<Array<{ text: string; callback_data: string } | { text: string; url: string }>> = [];

  if (input.links.openCartUrl) {
    rows.push([{ text: input.links.openCartLabel, url: input.links.openCartUrl }]);
  }

  // Product-page links — one per row so the labels (which include
  // truncated product names) don't get squashed.
  for (const btn of input.links.productButtons) {
    rows.push([btn]);
  }

  // Always-present approve/cancel row.
  rows.push([
    {
      text: "✅ Looks good, I'll checkout myself",
      callback_data: `website_cart_approve:${input.agentTaskId}`,
    },
    {
      text: "✖ Cancel order",
      callback_data: `website_cart_cancel:${input.agentTaskId}`,
    },
  ]);

  return rows;
}
