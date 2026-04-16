/**
 * Builds tap-to-open buttons for the cart-ready Telegram message.
 *
 * Two kinds of links are produced when applicable:
 *
 *   1. **Open-cart link** — `https://www.amazon.com/gp/cart/view.html`
 *      (or just the supplier home page for non-Amazon sites). Useful
 *      when the user has saved cookies for the supplier — the agent's
 *      cart IS their cart, so opening this link in their browser shows
 *      everything ready for checkout.
 *
 *   2. **Add-to-MY-cart deep link** — for Amazon, the
 *      `/gp/aws/cart/add.html?ASIN.1=...&Quantity.1=...` pattern lets
 *      the user one-tap-add the items to their OWN logged-in cart.
 *      Critical for users who DON'T have saved cookies — the agent's
 *      anonymous cart vanishes when its headless browser closes, so
 *      this is the only way they can finish the order without
 *      re-typing the product names.
 *
 * Returns an empty result when no useful link can be built (e.g.
 * unknown site, no ASINs detectable). Caller decides which buttons
 * to render.
 */

export type CartLine = {
  /** Item name shown to the user. */
  description: string;
  /** Quantity to order. */
  quantityOrdered: number;
  /** Pasted product URL — we extract ASINs from here. May be null. */
  productUrl: string | null;
};

export type CartLinks = {
  /** Opens the supplier's cart page (or homepage). Always present when supplierUrl is. */
  openCartUrl: string | null;
  /** Amazon-only: pre-filled cart-add URL for user's own session. */
  addToMyCartUrl: string | null;
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
}): CartLinks {
  const isAmazon =
    !!detectAmazonHostname(input.supplierWebsite) ||
    input.lines.some((l) => detectAmazonHostname(l.productUrl)) ||
    /amazon/i.test(input.supplierName);

  if (isAmazon) {
    const storefront = pickAmazonStorefront(input.supplierWebsite);
    const openCartUrl = `${storefront}/gp/cart/view.html`;

    // Build add-to-cart URL from any ASINs we can recover. Amazon
    // accepts up to 30 line items in this URL, plenty for our use.
    const params = new URLSearchParams();
    let lineNumber = 1;
    for (const line of input.lines) {
      const asin = extractAmazonAsin(line.productUrl);
      if (!asin) continue;
      params.append(`ASIN.${lineNumber}`, asin);
      params.append(`Quantity.${lineNumber}`, String(Math.max(1, line.quantityOrdered)));
      lineNumber += 1;
    }
    const addToMyCartUrl =
      lineNumber > 1
        ? `${storefront}/gp/aws/cart/add.html?${params.toString()}`
        : null;

    return {
      openCartUrl,
      addToMyCartUrl,
      openCartLabel: "🛒 Open Amazon cart",
      isAmazon: true,
    };
  }

  // Generic site — best we can do is link to the home page and
  // hope the user can navigate to their cart from there.
  return {
    openCartUrl: input.supplierWebsite || null,
    addToMyCartUrl: null,
    openCartLabel: `🌐 Open ${input.supplierName}`,
    isAmazon: false,
  };
}

/**
 * Convenience: builds the inline keyboard rows for the cart-ready
 * Telegram message. Returns an array of rows ready to drop into
 * `replyMarkup`. Always includes the approve/cancel callback row;
 * URL buttons are added when the helper produces them.
 */
export function buildCartReadyKeyboard(input: {
  agentTaskId: string;
  links: CartLinks;
}): Array<Array<{ text: string; callback_data: string } | { text: string; url: string }>> {
  const rows: Array<Array<{ text: string; callback_data: string } | { text: string; url: string }>> = [];

  // URL row(s) on top — most affordant tap target.
  const urlRow: Array<{ text: string; url: string }> = [];
  if (input.links.addToMyCartUrl) {
    urlRow.push({
      text: "🛍 Add to MY cart",
      url: input.links.addToMyCartUrl,
    });
  }
  if (input.links.openCartUrl) {
    urlRow.push({
      text: input.links.openCartLabel,
      url: input.links.openCartUrl,
    });
  }
  if (urlRow.length > 0) rows.push(urlRow);

  // Callback row underneath.
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
