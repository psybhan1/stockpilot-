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
import { fetchProductMetadata } from "@/modules/automation/product-metadata";

export type SniffedOrder = {
  itemName: string;
  quantity: number;
  supplierName: string;
  websiteUrl: string;
};

export type SniffResult = { orders: SniffedOrder[] } | null;

// Optional politeness/softener words a real manager might start a
// message with. Stripped before the order verb so "please order 3"
// matches the same way "order 3" does. "can you" / "can u" are
// common in Telegram shortcuts.
const POLITENESS_PREFIX =
  "(?:please|pls|plz|can\\s+(?:you|u)|could\\s+(?:you|u)|hey\\s*[,]?)";
// Words that indicate "the manager wants to order something". Added
// bare "need" (users frequently drop the "we"), "grab" (common
// casual phrasing for picking up stock), "pick up", and "restock".
const ORDER_VERBS =
  "(?:add(?:\\s+\\w+)?|order|buy|get\\s+me|we\\s+need|need|grab|pick\\s+up|restock|put)";
// Unit nouns we accept between quantity and item name (optional).
// Expanded with common abbreviations (cs, ea, gal), pounds, tablets,
// bars, packets — anything a supplier's packing slip might say.
const UNITS =
  "(?:bottles?|cans?|boxes?|bags?|cases?|cs|packs?|packets?|lbs?|pounds?|kg|kilos?|oz|ounces?|ml|l|liters?|litres?|gallons?|gal|pieces?|units?|items?|cups?|sheets?|rolls?|pairs?|tablets?|bars?|each|ea)";
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
 * Find EVERY URL in a message. Deduplicates and normalises. Used for
 * the bulk-paste case: "add these to my cart: <url1> <url2> <url3>".
 */
export function findAllUrls(text: string): string[] {
  const regex = /\b(?:https?:\/\/|(?:www\.)|(?:amzn\.to|a\.co)\/)\S+/gi;
  const urls: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const normalised = normalizeProductUrl(match[0]);
    if (normalised && !seen.has(normalised)) {
      urls.push(normalised);
      seen.add(normalised);
    }
  }
  return urls;
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
 *
 * Async because URL-only messages trigger a product-metadata HTTP
 * fetch so we can lift the real product name from the page's
 * og:title instead of using a useless "Item from Amazon" placeholder.
 */
async function matchSingleOrder(
  chunk: string,
  sharedSuffix = ""
): Promise<SniffedOrder | null> {
  const fullText = `${chunk} ${sharedSuffix}`.trim();

  // Pattern 1: URL in chunk — URL path takes priority, use agent's
  // URL-handling via the sniffer caller. Parse quantity from the
  // imperative text ("add three in the cart https://..."). Then
  // try to enrich the item name from the page's og:title.
  const url = findUrl(fullText);
  // Try to extract quantity + item + supplier from text. Item-name
  // character class includes Unicode letters via \p{L} so "café",
  // "résumé", "日本茶" survive without falling through to the LLM.
  //
  // The end anchor used to be `\s*[.!?]?\s*$` — zero-or-one punct
  // char. Real messages have "!!!" and trailing emoji ("🙏 😭 ✨").
  // New end accepts any run of non-alphanumeric-non-currency trail
  // chars (punctuation + emoji + spaces) so the match doesn't fail
  // on shouting or hearts.
  const pattern = new RegExp(
    `^\\s*(?:${POLITENESS_PREFIX}\\s+)?` + // optional "please"/"can u" prefix
      `(?:${ORDER_VERBS}\\s+(?:some\\s+|a\\s+few\\s+)?)?` + // optional verb
      `(\\d+)\\s+` + // quantity
      `(?:${UNITS}\\s+(?:of\\s+)?)?` + // optional unit + optional "of"
      `([\\p{L}\\p{N}][\\p{L}\\p{N}'\\s&-]+?)` + // item name (Unicode-aware)
      `(?:\\s+${SUPPLIER_PREP}\\s+([\\p{L}\\p{N}'\\s-]+?)(?:\\s+(?:cart|website|shop|store))?)?` + // optional "from <supplier>"
      // Trailing whitespace + punctuation + symbols + marks. `\p{M}`
      // catches combining characters like the variation selector in
      // ❤️ (U+2764 + U+FE0F). Without it, heart-emoji-ending
      // messages fail to match because U+FE0F is "Mark,Nonspacing"
      // which isn't in P or S.
      `[\\s\\p{P}\\p{S}\\p{M}]*$`,
    "iu"
  );
  const m = fullText.match(pattern);
  if (!m) {
    // URL fallback: only fire when the message ALSO looks like an
    // order. Without that gate, "check out this link https://..."
    // would create a PO, which is terrible UX.
    if (url && looksLikeOrderIntent(fullText)) {
      const supplier = hostnameToSupplierLabel(url);
      if (supplier) {
        // Quantity from free-text imperative: "add three in the cart",
        // "get me 2 of these", "order 5", etc. Word-digits fall back
        // to 1 when nothing's parseable.
        const qty = parseQuantityFromText(fullText);
        // Name: URL slug first (fast), then live fetch of og:title.
        let name = itemNameFromUrl(url);
        if (!name || name.length < 4) {
          const meta = await fetchProductMetadata(url, { timeoutMs: 5000 });
          if (meta?.title && meta.title.length >= 3) {
            name = meta.title;
          }
        }
        const finalName = name || `Item from ${supplier}`;
        return {
          itemName: finalName,
          quantity: qty,
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

/**
 * Pull a quantity out of free-text imperatives like "add three in
 * the cart", "get me 5", "order 2 of these". Returns 1 if nothing
 * parseable — that's the sensible default for "add this".
 *
 * Carefully avoids false positives:
 *   - Rejects digits glued to letters by hyphens or letters
 *     ("7-Eleven", "B000FDL68W" ASIN, "M-2")
 *   - Rejects digits inside URLs (skips the URL substring first)
 *   - Accepts "a dozen" / "a couple of"
 */
const WORD_DIGITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, a: 1, an: 1,
};
function parseQuantityFromText(text: string): number {
  // Strip URLs first — ASINs like B000FDL68W contain digits we
  // don't want captured. Also strip anything URL-ish that dangled
  // without http:// prefix.
  const withoutUrls = text
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\S+\.(?:com|ca|net|org|io)\/\S*/gi, " ");

  // Digit must be surrounded by whitespace/start/end — NOT by a
  // letter or hyphen. Rejects "7-Eleven", "M-2", "Route66".
  const digit = withoutUrls.match(/(?:^|[\s,.!?])(\d{1,4})(?=\s|$|[.,!?])/);
  if (digit) {
    const n = Number(digit[1]);
    if (n > 0 && n < 1000) return n;
  }
  const word = withoutUrls.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|dozen|a|an)\b/i
  );
  if (word) {
    const n = WORD_DIGITS[word[1].toLowerCase()];
    if (n) return n;
  }
  return 1;
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
 *
 * Async because URL-only messages enrich the item name from the
 * product page's og:title (a one-shot HTTP GET with 5s timeout).
 */
export async function sniffOrderIntent(text: string): Promise<SniffResult> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Bulk-URL case: "add these to my cart: <url1> <url2> <url3>".
  // Each URL becomes its own order, each enriched independently.
  const allUrls = findAllUrls(trimmed);
  if (allUrls.length >= 2 && looksLikeOrderIntent(trimmed)) {
    const orders: SniffedOrder[] = [];
    for (const url of allUrls) {
      const supplier = hostnameToSupplierLabel(url);
      if (!supplier) continue;
      let name = itemNameFromUrl(url);
      if (!name || name.length < 4) {
        const meta = await fetchProductMetadata(url, { timeoutMs: 5000 });
        if (meta?.title && meta.title.length >= 3) name = meta.title;
      }
      orders.push({
        itemName: name || `Item from ${supplier}`,
        quantity: 1, // bulk paste: can't assign qty per URL, default 1
        supplierName: supplier,
        websiteUrl: url,
      });
    }
    if (orders.length > 0) return { orders };
  }

  // Multi-item case: "add 5 X and 3 Y from LCBO"
  const split = splitMultipart(trimmed);
  if (split) {
    const orders: SniffedOrder[] = [];
    for (const chunk of split.orderChunks) {
      const order = await matchSingleOrder(chunk, split.sharedSuffix);
      if (!order) return null; // partial match — bail, let LLM handle
      orders.push(order);
    }
    if (orders.length > 0) return { orders };
  }

  // Single-chunk match.
  const single = await matchSingleOrder(trimmed);
  if (single) return { orders: [single] };

  return null;
}

/**
 * Is this message phrased like an order? Used as the gate for the
 * bulk-URL case — we only want to fire it when the user clearly
 * meant "add these items", not when they're just sharing links.
 */
function looksLikeOrderIntent(text: string): boolean {
  return /\b(add|order|buy|get|we\s+need|put|please\s+order)\b/i.test(text);
}

/**
 * Deterministic approve/cancel sniffer. Llama-4-Scout sometimes replies
 * "Cancelled." or "Approved." without actually calling the cancel/
 * approve tool — a classic small-model failure mode. So when the
 * user's whole message is clearly a yes-or-no to a pending PO, we
 * route around the LLM entirely and call the tool ourselves.
 *
 * Returns null when the message isn't a clean approve/cancel signal
 * (too long, mentions digits, or doesn't contain one of the trigger
 * words) — those cases fall through to the LLM as normal.
 */
export function sniffApproveOrCancel(text: string): "approve" | "cancel" | null {
  const raw = (text ?? "").trim().toLowerCase();
  if (raw.length === 0 || raw.length > 40) return null;
  // If the message has digits it's probably a new order ("order 5…"),
  // not a yes/no to an existing one.
  if (/\d/.test(raw)) return null;

  // Emoji signals first — they don't live inside \b word boundaries
  // and trying to regex them is messier than a direct contains check.
  const hasApproveEmoji = /[👍✅✔✓🆗]/u.test(raw);
  const hasCancelEmoji = /[❌✖✗🚫🛑]/u.test(raw);

  // Normalise text for word-boundary regex: strip punctuation (incl.
  // apostrophe → collapse so "don't" becomes "dont"), collapse spaces.
  const stripped = raw
    .replace(/['`]/g, "") // apostrophe → nothing (keeps "dont" one token)
    .replace(/[.,!?;:"—–-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Cancel patterns.
  const CANCEL_WORDS =
    /\b(cancel|nvm|never\s*mind|scrap(?:\s*that)?|dont\s*send(?:\s*it)?|stop|abort|nope|nah|no(?:pe)?)\b/i;
  const APPROVE_WORDS =
    /\b(approve(?:\s*(?:it|and\s*send))?|send\s*it|go\s*ahead|do\s*it|looks\s*good|lgtm|sure|yes|yep|yup|yeah|ok(?:ay)?)\b/i;

  // Negation markers — if any appear, the whole message is a
  // cancel regardless of what "approve" words sit inside it.
  // "dont send it" contains "send it" (approve-ish), but the "dont"
  // flips it; same for "no go ahead" → still a no.
  const NEGATION = /\b(dont|do\s*not|no|not|nope|nah|nvm|never\s*mind|cancel|scrap|stop|abort)\b/i;
  const hasNegation = NEGATION.test(stripped);

  const hasCancel = hasCancelEmoji || CANCEL_WORDS.test(stripped) || hasNegation;
  const hasApprove = hasApproveEmoji || APPROVE_WORDS.test(stripped);

  // Negation wins over any approve hit inside the same short message.
  // Genuine ambiguity ("no wait yes") is handled below: hasNegation
  // is true AND the approve word is after a clause break. We keep
  // the simpler rule here — "no wait, yes" in practice is rare and
  // the user can just retype.
  if (hasNegation) return "cancel";
  if (hasCancel) return "cancel";
  if (hasApprove) return "approve";
  return null;
}
