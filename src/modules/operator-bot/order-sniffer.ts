/**
 * Pre-LLM deterministic sniffer for unambiguous order intents.
 *
 * Motivation: Llama 4 Scout sometimes refuses "order from website"
 * tasks with "I can't access external websites" — a safety-training
 * artifact that no amount of prompt engineering fully suppresses.
 * For messages that clearly ARE order intents (URL + verb, or named
 * supplier), we bypass the LLM entirely and construct the tool call
 * ourselves.
 *
 * Only matches high-confidence patterns. Ambiguous messages fall
 * through to the agent as normal.
 */

import { lookupKnownSupplierWebsite, normalizeProductUrl } from "@/modules/operator-bot/agent";

export type SniffedOrder = {
  itemName: string;
  quantity: number;
  supplierName: string;
  websiteUrl: string;
};

export type SniffResult = { orders: SniffedOrder[] } | null;

// Words that indicate "the manager wants to order something".
const ORDER_VERBS =
  "(?:add(?:\\s+\\w+)?|order|buy|get\\s+me|we\\s+need|put)";
// Unit nouns we accept between quantity and item name (optional).
const UNITS =
  "(?:bottles?|cans?|boxes?|bags?|cases?|packs?|lbs?|kg|oz|ml|l|liters?|litres?|gallons?|pieces?|units?|items?|cups?|sheets?|rolls?|pairs?)";
// Supplier/site prepositions ("from LCBO", "at Costco", "in my Walmart cart").
// "in"/"to" can optionally be followed by "my"/"the"; all alternatives
// are match-as-atom so they work at end-of-string (no trailing \s+
// required, otherwise "...cart in" at end of message fails to match).
const SUPPLIER_PREP = "(?:from|at|on|in(?:\\s+(?:my|the))?|to(?:\\s+(?:my|the))?)";

/**
 * Detect a URL anywhere in the text. Returns the first match normalised
 * via the agent's URL normaliser.
 */
export function findUrl(text: string): string | null {
  // Permissive: anything that looks like a URL (with or without scheme).
  const match = text.match(
    /\b(?:https?:\/\/|(?:www\.)|(?:amzn\.to|a\.co)\/)\S+/i
  );
  if (!match) return null;
  return normalizeProductUrl(match[0]) || null;
}

/**
 * Try to split a user message into separate order chunks sharing a
 * supplier clause. Real-world bug case:
 *
 *   "add 5 bottles of jp wisers and 3 box of bella terra in my cart in lcbo website"
 *
 * This has TWO "in" clauses; we want to identify the supplier by
 * scanning from the end of the message and finding a known brand,
 * then split the remaining head on "and" / "," to get the items.
 *
 * Returns null if the message doesn't obviously contain multiple
 * orders (falls through to single-order matcher).
 */
function splitMultipart(
  text: string
): { orderChunks: string[]; sharedSuffix: string } | null {
  // Find a known supplier anywhere in the trailing third of the text
  // (most commonly after a "from/at/in/on" preposition). We scan by
  // trying progressively longer tail slices and looking up each as
  // a supplier name.
  const tokens = text.split(/\s+/);
  let supplierClause = "";
  let headText = text;

  // Scan from the end — for each possible trailing slice (1 to 5
  // tokens), check if it lookup-matches a known supplier.
  for (let trail = 1; trail <= 5 && trail <= tokens.length; trail += 1) {
    const slice = tokens.slice(-trail).join(" ");
    if (lookupKnownSupplierWebsite(slice)) {
      // Grab everything from the preposition preceding this slice
      // to the end. This is the "shared supplier clause".
      const sliceStart = text.lastIndexOf(slice);
      // Walk backward through whitespace + the preposition.
      let before = text.slice(0, sliceStart).replace(/\s+$/, "");
      const prepMatch = before.match(
        new RegExp(`\\s+${SUPPLIER_PREP}$`, "i")
      );
      if (prepMatch) {
        before = before.slice(0, before.length - prepMatch[0].length);
      }
      // Strip "in my cart" / "in my shop" ahead of the preposition
      // we just stripped — happens when the message has both
      // "in my cart" and "in lcbo".
      const doublePrep = before.match(
        new RegExp(
          `(\\s+${SUPPLIER_PREP}\\s+(?:my\\s+)?(?:cart|website|shop|store))\\s*$`,
          "i"
        )
      );
      if (doublePrep) {
        before = before.slice(0, before.length - doublePrep[0].length);
      }
      supplierClause = ` from ${slice}`;
      headText = before;
      break;
    }
  }

  if (!supplierClause) return null;

  const chunks = headText
    .split(/\s*(?:,|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);

  if (chunks.length < 2) return null;
  const allLookLikeOrders = chunks.every((c) => /\d/.test(c));
  if (!allLookLikeOrders) return null;
  return { orderChunks: chunks, sharedSuffix: supplierClause };
}

/**
 * Core single-chunk matcher. Recognises patterns like:
 *   "add 5 bottles of jp wisers from lcbo"
 *   "order 3 cans of oat milk at costco"
 *   "buy 12 oz of coffee from amazon"
 *   "5 boxes of tea from wholesale depot"
 */
function matchSingleOrder(
  chunk: string,
  sharedSuffix = ""
): SniffedOrder | null {
  const fullText = `${chunk} ${sharedSuffix}`.trim();

  // Pattern 1: URL in chunk — URL path takes priority, use agent's
  // URL-handling via the sniffer caller.
  const url = findUrl(fullText);
  // Try to extract quantity + item + supplier from text.
  const pattern = new RegExp(
    `^\\s*(?:${ORDER_VERBS}\\s+(?:some\\s+|a\\s+few\\s+)?)?` + // optional verb
      `(\\d+)\\s+` + // quantity
      `(?:${UNITS}\\s+(?:of\\s+)?)?` + // optional unit + optional "of"
      `([A-Za-z0-9][\\w'\\s&-]+?)` + // item name
      `(?:\\s+${SUPPLIER_PREP}\\s+([\\w'\\s-]+?)(?:\\s+(?:cart|website|shop|store))?)?` + // optional "from <supplier>"
      `\\s*[.!?]?\\s*$`,
    "i"
  );
  const m = fullText.match(pattern);
  if (!m) {
    // If it's ONLY a URL + short imperative ("add this https://..."),
    // treat as an order with qty=1 and derive the supplier from the URL.
    if (url) {
      const supplier = hostnameToSupplierLabel(url);
      if (supplier) {
        const name = itemNameFromUrl(url) || "Item from " + supplier;
        return {
          itemName: name,
          quantity: 1,
          supplierName: supplier,
          websiteUrl: url,
        };
      }
    }
    return null;
  }

  const qty = Math.max(1, Number(m[1]));
  const rawItem = (m[2] || "").trim();
  const rawSupplier = (m[3] || "").trim();

  if (!rawItem) return null;

  // Clean up item name ("of jp wisers" → "jp wisers"; "the foo" → "foo").
  const itemName = rawItem.replace(/^(?:of\s+|the\s+)/i, "").trim();
  if (!itemName) return null;

  // Determine supplier: explicit text wins; else derive from URL.
  let supplier = rawSupplier;
  if (!supplier && url) {
    supplier = hostnameToSupplierLabel(url) ?? "";
  }

  // Only fire for KNOWN suppliers OR a URL-based order. Ambiguous
  // "3 cartons of milk" with no supplier is left for the LLM.
  if (!supplier) return null;
  const normalised = normaliseSupplierName(supplier);
  const isKnownBrand = !!lookupKnownSupplierWebsite(normalised);
  if (!isKnownBrand && !url) return null;

  return {
    itemName: capitaliseItem(itemName),
    quantity: qty,
    supplierName: isKnownBrand ? normalised : capitaliseItem(normalised),
    websiteUrl: url ?? "",
  };
}

function hostnameToSupplierLabel(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (/amazon\.|amzn\.to|a\.co/.test(host)) return "Amazon";
    if (host.includes("costco")) return "Costco";
    if (host.includes("walmart")) return "Walmart";
    if (host.includes("target.com")) return "Target";
    if (host.includes("lcbo")) return "LCBO";
    if (host.includes("sysco")) return "Sysco";
    if (host.includes("webstaurant")) return "WebstaurantStore";
    if (host.includes("homedepot")) return "Home Depot";
    if (host.includes("staples")) return "Staples";
    // Fall back to the first hostname segment titled-cased.
    const first = host.split(".")[0];
    if (first) return first.charAt(0).toUpperCase() + first.slice(1);
    return null;
  } catch {
    return null;
  }
}

function itemNameFromUrl(url: string): string | null {
  // Amazon: /Urnex-Cafiza-Espresso/dp/B005... → "Urnex Cafiza Espresso"
  const amzn = url.match(/\/([A-Za-z0-9-]+(?:-[A-Za-z0-9]+){1,})\/(?:dp|gp\/product)\//);
  if (amzn) {
    return amzn[1].replace(/-/g, " ").trim();
  }
  return null;
}

function capitaliseItem(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function normaliseSupplierName(s: string): string {
  return s
    .replace(/^(?:my\s+|the\s+)/i, "")
    .replace(/\s+(cart|website|shop|store)$/i, "")
    .replace(/[.,!?]+$/, "")
    .trim();
}

/**
 * Public entry: sniff a manager's message. Returns an array of orders
 * when the message is unambiguous, or null to fall through to the LLM.
 */
export function sniffOrderIntent(text: string): SniffResult {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Multi-item case first: "add 5 X and 3 Y from LCBO"
  const split = splitMultipart(trimmed);
  if (split) {
    const orders: SniffedOrder[] = [];
    for (const chunk of split.orderChunks) {
      const order = matchSingleOrder(chunk, split.sharedSuffix);
      if (!order) return null; // partial match — bail, let LLM handle
      orders.push(order);
    }
    if (orders.length > 0) return { orders };
  }

  // Single-chunk match.
  const single = matchSingleOrder(trimmed);
  if (single) return { orders: [single] };

  return null;
}
