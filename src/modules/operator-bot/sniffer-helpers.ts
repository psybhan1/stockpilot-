/**
 * Pure helpers for the deterministic order-intent sniffer.
 *
 * Extracted from order-sniffer.ts so they can be unit-tested without
 * pulling in the agent's DB / env / service imports. order-sniffer.ts
 * re-imports everything from here.
 */

// ── URL detection ──────────────────────────────────────────────────────────

/**
 * Normalise a raw URL fragment a manager pasted into chat:
 *   - strips markdown ` ' " < > wrappers + trailing punctuation
 *   - prepends https:// when scheme missing
 *   - rejects non-http(s) schemes (javascript:, data:, file:, …)
 *
 * Returns the canonicalised URL via `new URL()`, or "" when
 * unparseable. (Empty string — not null — for back-compat with the
 * previous implementation in agent.ts.)
 */
export function normalizeProductUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return "";
  url = url.replace(/^[<`'"]+|[>`'".,;!?)\]]+$/g, "");
  if (!/^[a-z]+:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

/**
 * Detect a URL anywhere in the text. Returns the first match, normalised.
 */
export function findUrl(text: string): string | null {
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

/** Map a URL hostname to a friendly supplier label. */
export function hostnameToSupplierLabel(url: string): string | null {
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
    const first = host.split(".")[0];
    if (first) return first.charAt(0).toUpperCase() + first.slice(1);
    return null;
  } catch {
    return null;
  }
}

/** Best-effort product-name extraction from a URL slug. */
export function itemNameFromUrl(url: string): string | null {
  // Amazon: /Urnex-Cafiza-Espresso/dp/B005... → "Urnex Cafiza Espresso"
  const amzn = url.match(/\/([A-Za-z0-9-]+(?:-[A-Za-z0-9]+){1,})\/(?:dp|gp\/product)\//);
  if (amzn) {
    return amzn[1].replace(/-/g, " ").trim();
  }
  return null;
}

// ── Quantity parsing ───────────────────────────────────────────────────────

const WORD_DIGITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, a: 1, an: 1,
};

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
export function parseQuantityFromText(text: string): number {
  const withoutUrls = text
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\S+\.(?:com|ca|net|org|io)\/\S*/gi, " ");

  const digit = withoutUrls.match(/(?:^|[\s,.!?])(\d{1,4})(?=\s|$|[.,!?])/);
  if (digit) {
    const n = Number(digit[1]);
    if (n > 0 && n < 1000) return n;
  }
  // Word digits. The lookbehind `(?<![-\d])` skips matches glued to
  // digits/hyphens — so "Eleven" inside "7-Eleven" doesn't read as
  // 11. Globally collect all hits, then prefer the first REAL number
  // word over a bare "a"/"an" — fixes "a dozen" returning 1 instead
  // of 12 (because "a" appears first positionally).
  const wordRegex =
    /(?<![-\d])\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|dozen|a|an)\b/gi;
  const matches = [...withoutUrls.matchAll(wordRegex)];
  if (matches.length > 0) {
    for (const m of matches) {
      const word = m[1].toLowerCase();
      if (word !== "a" && word !== "an") {
        const n = WORD_DIGITS[word];
        if (n) return n;
      }
    }
    // Nothing but "a"/"an" → return that 1.
    const first = WORD_DIGITS[matches[0][1].toLowerCase()];
    if (first) return first;
  }
  return 1;
}

// ── Display helpers ────────────────────────────────────────────────────────

export function capitaliseItem(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function normaliseSupplierName(s: string): string {
  return s
    .replace(/^(?:my\s+|the\s+)/i, "")
    .replace(/\s+(cart|website|shop|store)$/i, "")
    .replace(/[.,!?]+$/, "")
    .trim();
}

/**
 * Is this message phrased like an order? Used as the gate for the
 * bulk-URL case — we only want to fire it when the user clearly
 * meant "add these items", not when they're just sharing links.
 */
export function looksLikeOrderIntent(text: string): boolean {
  return /\b(add|order|buy|get|we\s+need|put|please\s+order)\b/i.test(text);
}

// ── Approve/cancel sniffer ─────────────────────────────────────────────────

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

  const hasApproveEmoji = /[👍✅✔✓🆗]/u.test(raw);
  const hasCancelEmoji = /[❌✖✗🚫🛑]/u.test(raw);

  const stripped = raw
    .replace(/['`]/g, "")
    .replace(/[.,!?;:"—–-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const CANCEL_WORDS =
    /\b(cancel|nvm|never\s*mind|scrap(?:\s*that)?|dont\s*send(?:\s*it)?|stop|abort|nope|nah|no(?:pe)?)\b/i;
  const APPROVE_WORDS =
    /\b(approve(?:\s*(?:it|and\s*send))?|send\s*it|go\s*ahead|do\s*it|looks\s*good|lgtm|sure|yes|yep|yup|yeah|ok(?:ay)?)\b/i;

  const NEGATION = /\b(dont|do\s*not|no|not|nope|nah|nvm|never\s*mind|cancel|scrap|stop|abort)\b/i;
  const hasNegation = NEGATION.test(stripped);

  const hasCancel = hasCancelEmoji || CANCEL_WORDS.test(stripped) || hasNegation;
  const hasApprove = hasApproveEmoji || APPROVE_WORDS.test(stripped);

  if (hasNegation) return "cancel";
  if (hasCancel) return "cancel";
  if (hasApprove) return "approve";
  return null;
}
