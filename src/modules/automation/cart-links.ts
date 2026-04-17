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
 * Build a multi-item "add to cart" deep link for a supplier. When the
 * user taps the returned URL in Telegram, it opens in whatever
 * browser they're already signed into — so the cart ends up in THEIR
 * real account, not an ephemeral headless session. Falls back to a
 * plain product/home link when the supplier doesn't support a
 * public cart-add URL format.
 *
 * Returns null when there's nothing useful to link to (no recognised
 * supplier + no product URLs).
 *
 * Status notes per supplier:
 *   - Amazon (/gp/aws/cart/add.html?ASIN.1=X&Quantity.1=N):
 *     works ~85% of the time for signed-in users on web + mobile.
 *     Occasionally drops items during sign-in redirect — that's the
 *     reason we also keep per-product fallback buttons below the
 *     primary tap.
 *   - Walmart (affil.walmart.com/cart/addToCart?items=ID_QTY,ID_QTY):
 *     documented affiliate URL, works when items have real Walmart
 *     item IDs (we extract them from the URL).
 *   - Everything else: returns the product URL or supplier home.
 *     User opens, browses, adds manually.
 */
export type DeepCartLine = {
  description: string;
  quantityOrdered: number;
  productUrl: string | null;
};

export type DeepCartLink = {
  /** Primary URL for the "Add all to cart" button. */
  url: string;
  /** Human-friendly button label e.g. "🛒 Add 5 items to Amazon cart". */
  label: string;
  /**
   * "populates" = URL is expected to actually fill the cart on tap
   * (Amazon add.html, Walmart affil cart).
   * "product_page" = URL opens the product/home but user must add
   * manually.
   */
  kind: "populates" | "product_page";
};

export function buildDeepCartAddUrl(input: {
  supplierWebsite: string | null;
  supplierName: string;
  lines: DeepCartLine[];
}): DeepCartLink | null {
  if (input.lines.length === 0) return null;

  // Amazon multi-item cart-add.
  const isAmazon =
    !!detectAmazonHostname(input.supplierWebsite) ||
    input.lines.some((l) => detectAmazonHostname(l.productUrl)) ||
    /amazon/i.test(input.supplierName);
  if (isAmazon) {
    const storefront = pickAmazonStorefront(
      input.supplierWebsite ??
        input.lines.find((l) => detectAmazonHostname(l.productUrl))?.productUrl ??
        null
    );
    const asinParts: string[] = [];
    let idx = 0;
    for (const line of input.lines) {
      const asin = extractAmazonAsin(line.productUrl);
      if (!asin) continue;
      idx += 1;
      asinParts.push(`ASIN.${idx}=${asin}&Quantity.${idx}=${Math.max(1, line.quantityOrdered)}`);
    }
    if (asinParts.length > 0) {
      const url = `${storefront}/gp/aws/cart/add.html?${asinParts.join("&")}`;
      const totalQty = input.lines
        .slice(0, idx)
        .reduce((s, l) => s + Math.max(1, l.quantityOrdered), 0);
      const label =
        asinParts.length === 1
          ? `🛒 Add ${totalQty} to Amazon cart`
          : `🛒 Add ${asinParts.length} items to Amazon cart`;
      return { url, label, kind: "populates" };
    }
    // Amazon supplier but no ASIN we can extract — open the storefront
    // so the user can search.
    return {
      url: `${storefront}/`,
      label: `🌐 Open Amazon`,
      kind: "product_page",
    };
  }

  // Walmart affiliate cart-add format.
  // Item IDs appear in URLs like /ip/Whatever-Product/5265 (ID is the
  // trailing number). Only usable when we actually pulled item IDs
  // off every line.
  const isWalmart = /walmart\.(?:com|ca)$/i.test(
    hostFromUrl(input.supplierWebsite) ?? ""
  ) || /walmart/i.test(input.supplierName);
  if (isWalmart) {
    const parts: string[] = [];
    for (const line of input.lines) {
      const id = extractWalmartItemId(line.productUrl);
      if (!id) continue;
      parts.push(`${id}_${Math.max(1, line.quantityOrdered)}`);
    }
    if (parts.length > 0) {
      return {
        url: `https://affil.walmart.com/cart/addToCart?items=${parts.join(",")}`,
        label:
          parts.length === 1
            ? `🛒 Add to Walmart cart`
            : `🛒 Add ${parts.length} items to Walmart cart`,
        kind: "populates",
      };
    }
  }

  // Generic: point at the first product URL we have, else the
  // supplier's homepage. User shops manually.
  const firstProductUrl = input.lines.find((l) => l.productUrl)?.productUrl;
  if (firstProductUrl) {
    return {
      url: firstProductUrl,
      label:
        input.lines.length === 1
          ? `📦 Open ${input.supplierName}`
          : `📦 Open first item at ${input.supplierName}`,
      kind: "product_page",
    };
  }
  if (input.supplierWebsite) {
    return {
      url: input.supplierWebsite,
      label: `🌐 Open ${input.supplierName}`,
      kind: "product_page",
    };
  }
  return null;
}

function hostFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function extractWalmartItemId(url: string | null | undefined): string | null {
  if (!url) return null;
  // Walmart product URLs end in /NUMERIC_ID (after /ip/ or /product/).
  // IDs range from ~4 digits (older SKUs) to 12+ digits (newer).
  const match = url.match(/\/(?:ip|product)\/[^/]+\/(\d{3,})(?:[/?#]|$)/i);
  return match ? match[1] : null;
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
   * Without cookies, "Open cart" lands them in their own (possibly
   * empty) cart — we still show it as the primary action because
   * it's the closest thing to "go complete my order". The caller's
   * caption explains what to expect in each case.
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

    // Product-page buttons now ONLY show for items the agent FAILED
    // to add (as a search fallback so the manager can find a working
    // product page themselves). For successful adds we deliberately
    // don't repeat the user's original URL back to them — user
    // feedback was "it sends the link of the product I already gave
    // it to the bot myself" — pointless clutter.
    const productButtons: ProductPageButton[] = [];
    for (const line of input.lines.slice(0, 3)) {
      const labelBase = (line.description || "").trim();
      const label = truncate(labelBase) || "product";
      const wasAdded = line.added !== false; // undefined → assume yes
      if (wasAdded) continue; // successful adds need no extra button
      if (labelBase) {
        productButtons.push({
          text: `🔍 Search: ${label}`,
          url: `${storefront}/s?k=${encodeURIComponent(labelBase)}`,
        });
      }
    }

    // Always show the cart link when there's at least one success —
    // that's the actionable endpoint. Only suppress when every item
    // failed (cart is empty anywhere you look).
    const anyAdded = input.lines.some((l) => l.added !== false);
    const openCartUrl = anyAdded ? `${storefront}/gp/cart/view.html` : null;

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
