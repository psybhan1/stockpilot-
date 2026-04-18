/**
 * Pure helpers extracted from agent.ts so the node --test build can
 * exercise them without loading Prisma / env / `db`. Everything in
 * here must be side-effect-free and safe to import from a test.
 */

// ─── Fuzzy item matching ───────────────────────────────────────────────────
// Exact match wins alone. Otherwise every substring hit comes back, ranked
// shortest-name-first so "oat milk" beats "oat milk latte premium" when
// the user said "oat milk".

type FuzzyNamed = { name: string };

export function findFuzzyMatches<T extends FuzzyNamed>(items: T[], query: string): T[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const exact = items.filter((c) => c.name.toLowerCase() === q);
  if (exact.length > 0) return exact;
  const contains = items.filter(
    (c) => c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase()),
  );
  return contains.sort((a, b) => a.name.length - b.name.length);
}

// ─── Urgency ranking ───────────────────────────────────────────────────────
// CRITICAL > WARNING > anything else. Alphabetical tiebreak inside each
// bucket so truncation is deterministic.

type UrgencyRanked = { name: string; snapshot: { urgency: string | null } | null };

export function rankItemsByUrgency<T extends UrgencyRanked>(items: T[]): T[] {
  const rank = (urgency: string | null | undefined) => {
    if (urgency === "CRITICAL") return 0;
    if (urgency === "WARNING") return 1;
    return 2;
  };
  return [...items].sort((a, b) => {
    const ar = rank(a.snapshot?.urgency);
    const br = rank(b.snapshot?.urgency);
    if (ar !== br) return ar - br;
    return a.name.localeCompare(b.name);
  });
}

// ─── Reply sanitiser ───────────────────────────────────────────────────────
// Every tool name must be listed here — if a new tool's name bleeds into
// the user-visible reply, this swaps it for a neutral verb. New entries
// go in both the regex AND the lookup table.

const TOOL_NAME_PATTERN = /\b(place_restock_order|update_stock_count|list_inventory|list_low_stock|list_suppliers|link_supplier_to_item|adjust_par_level|approve_recent_order|cancel_recent_order|start_add_item_flow|start_add_supplier_flow|check_item_stock|check_margins|check_variance|check_pricing_trends|item_price_history|analytics_overview|forecast_runout|list_pending_orders|mark_order_delivered|quick_add_and_order)\b/gi;

const TOOL_NAME_REWRITES: Record<string, string> = {
  place_restock_order: "draft an order",
  update_stock_count: "update the stock",
  list_inventory: "check your items",
  list_low_stock: "check what's low",
  list_suppliers: "check your suppliers",
  link_supplier_to_item: "link the supplier",
  adjust_par_level: "change the par",
  approve_recent_order: "approve the order",
  cancel_recent_order: "cancel the order",
  start_add_item_flow: "add an item",
  start_add_supplier_flow: "add a supplier",
  check_item_stock: "check the item",
  check_margins: "check your margins",
  check_variance: "check variance",
  check_pricing_trends: "check price trends",
  item_price_history: "pull price history",
  analytics_overview: "pull analytics",
  forecast_runout: "forecast the runout",
  list_pending_orders: "list pending orders",
  mark_order_delivered: "mark it delivered",
  quick_add_and_order: "add and order",
};

export function sanitiseReply(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  let text = raw;

  // Empty inline-code placeholders ("the order is ``", "PO-PO-XXXX").
  text = text.replace(/``/g, "");
  text = text.replace(/PO-PO-\w+/g, "");
  text = text.replace(/\bPO-\d{4}-XXXX\b/gi, "");

  // Strip narration BEFORE tool-name rewrites — otherwise "list_inventory"
  // becomes "check your items" and the single-identifier regex stops matching.
  text = text.replace(/I'll (call |use |run )(the |a )?[a-z_]+ (tool|function)(\.|,)?/gi, "");
  text = text.replace(/Let me (call |use |run )(the |a )?[a-z_]+ (tool|function)(\.|,)?/gi, "");

  if (TOOL_NAME_PATTERN.test(text)) {
    text = text.replace(TOOL_NAME_PATTERN, (match) => TOOL_NAME_REWRITES[match.toLowerCase()] ?? match);
  }

  text = text.replace(/ {2,}/g, " ").trim();

  if (text.length < 2) return fallback;
  return text;
}
