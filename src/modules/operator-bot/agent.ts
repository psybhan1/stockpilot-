/**
 * Tool-calling agent for the StockPilot manager bot.
 *
 * Replaces the old "intent classifier → scenario switch → paraphrased reply"
 * pipeline with a single Groq agent that has real tools. The agent sees the
 * conversation, decides what to do, calls tools that actually mutate the DB,
 * and responds with whatever makes sense. No canned phrases, no rotation, no
 * fake paraphrasing on top of pre-computed facts.
 */

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { formatQuantityBase } from "@/modules/inventory/units";

import { InventoryCategory, PurchaseOrderStatus } from "@/lib/prisma";
import type { Prisma } from "@/lib/prisma";

import {
  approveAndDispatchPurchaseOrder,
  createRestockOrderFromBotMessage,
  updateStockCountFromBotMessage,
  toBotChannel,
  type BotHandlingResult,
  type ManagerBotChannel,
} from "./service";
import { startAddItem } from "./workflows/add-item";
import { startAddSupplier } from "./workflows/add-supplier";
import { saveWorkflowState } from "./workflows/engine";
import { nextOrderNumber } from "@/modules/purchasing/service";

export type AgentContext = {
  locationId: string;
  userId: string;
  channel: ManagerBotChannel;
  senderId: string;
  sourceMessageId: string | null;
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
};

// ── URL helpers ──────────────────────────────────────────────────────────
// `normalizeProductUrl` lives in sniffer-helpers.ts so the unit-test
// build can import it without pulling in the agent's DB/env imports.
// Re-exported here for the existing call sites + scripts.
import { normalizeProductUrl } from "./sniffer-helpers";
export { normalizeProductUrl };

export function toHostnameRoot(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

// Common supplier names → known website roots. Used when a manager
// says "add 5 of X from LCBO" with no URL — we set the supplier up
// in WEBSITE mode pointing at the home page so the browser agent
// has somewhere to start. The agent will search-by-name from there.
const KNOWN_SUPPLIER_WEBSITES: Record<string, string> = {
  // ── Big-box retail ────────────────────────────────────────────
  amazon: "https://www.amazon.com",
  "amazon.com": "https://www.amazon.com",
  "amazon.ca": "https://www.amazon.ca",
  "amazon.co.uk": "https://www.amazon.co.uk",
  costco: "https://www.costco.com",
  "costco.com": "https://www.costco.com",
  "costco.ca": "https://www.costco.ca",
  "costco business": "https://www.costcobusinessdelivery.com",
  walmart: "https://www.walmart.com",
  "walmart.ca": "https://www.walmart.ca",
  target: "https://www.target.com",
  sams: "https://www.samsclub.com",
  "sam's club": "https://www.samsclub.com",
  samsclub: "https://www.samsclub.com",
  bjs: "https://www.bjs.com",
  "bj's": "https://www.bjs.com",
  kroger: "https://www.kroger.com",
  safeway: "https://www.safeway.com",
  meijer: "https://www.meijer.com",
  aldi: "https://shop.aldi.us",

  // ── B2B foodservice ───────────────────────────────────────────
  sysco: "https://shop.sysco.com",
  "us foods": "https://www.usfoods.com",
  usfoods: "https://www.usfoods.com",
  "gordon food service": "https://gfs.com",
  "gordon foods": "https://gfs.com",
  gfs: "https://gfs.com",
  "restaurant depot": "https://www.restaurantdepot.com",
  shamrock: "https://shamrockfoods.com",
  "shamrock foods": "https://shamrockfoods.com",
  "cash and carry": "https://www.smartfoodservice.com",
  "smart foodservice": "https://www.smartfoodservice.com",
  webstaurant: "https://www.webstaurantstore.com",
  webstaurantstore: "https://www.webstaurantstore.com",
  "restaurant supply": "https://www.webstaurantstore.com",
  wasserstrom: "https://www.wasserstrom.com",

  // ── Alcohol & beverage ────────────────────────────────────────
  lcbo: "https://www.lcbo.com",
  saq: "https://www.saq.com",
  "bc liquor": "https://www.bcliquorstores.com",
  bevmo: "https://www.bevmo.com",
  "total wine": "https://www.totalwine.com",
  totalwine: "https://www.totalwine.com",
  "drizly": "https://drizly.com",
  "wine.com": "https://www.wine.com",

  // ── Office / industrial / general ─────────────────────────────
  staples: "https://www.staples.com",
  "staples.ca": "https://www.staples.ca",
  "office depot": "https://www.officedepot.com",
  "home depot": "https://www.homedepot.com",
  homedepot: "https://www.homedepot.com",
  lowes: "https://www.lowes.com",
  "lowe's": "https://www.lowes.com",
  ikea: "https://www.ikea.com",
  uline: "https://www.uline.com",
  grainger: "https://www.grainger.com",
  mcmaster: "https://www.mcmaster.com",
  "mcmaster-carr": "https://www.mcmaster.com",

  // ── Coffee / specialty ────────────────────────────────────────
  peets: "https://www.peets.com",
  "peet's": "https://www.peets.com",
  "peet's coffee": "https://www.peets.com",
  starbucks: "https://athome.starbucks.com",
  "whole foods": "https://www.wholefoodsmarket.com",
  wholefoods: "https://www.wholefoodsmarket.com",
  "trader joe's": "https://www.traderjoes.com",

  // ── Delivery platforms ────────────────────────────────────────
  instacart: "https://www.instacart.com",
  doordash: "https://www.doordash.com",
  ubereats: "https://www.ubereats.com",
  "uber eats": "https://www.ubereats.com",
};

/**
 * Look up a supplier by name. Handles common variants:
 *   - case-insensitive
 *   - strip "the ", "store", "market", etc.
 *   - strip trailing punctuation
 *   - match partial names (e.g. "Amazon Prime" → amazon)
 */
/**
 * Heuristic: does this `itemName` look like a placeholder we should
 * replace with a real product title fetched from the URL?
 *
 *   "Item from Amazon"         → yes
 *   "Amazon item"              → yes
 *   "product"                  → yes
 *   "thing"                    → yes (too short)
 *   "Urnex Cafiza"             → no (specific product)
 *
 * The checks are intentionally broad — a false positive just means
 * we do an extra HTTP fetch we could've skipped. False negatives
 * (keeping a generic name when we could have fetched) are worse
 * because they propagate into the search-fallback URL.
 */
export function looksLikeGenericItemName(itemName: string, supplierName: string): boolean {
  const trimmed = itemName.trim();
  if (!trimmed) return true;
  if (trimmed.length < 6) return true;
  const lowered = trimmed.toLowerCase();
  if (/^(?:item|product|thing|something)\b/i.test(lowered)) return true;
  if (/^(?:an?\s+)?(?:amazon|costco|walmart|target|lcbo)\s+(?:item|product|thing|order)$/i.test(lowered)) {
    return true;
  }
  if (/^item from /i.test(lowered)) return true;
  if (/^product from /i.test(lowered)) return true;
  // Name is literally the supplier name ("Amazon", "Costco").
  if (supplierName && lowered === supplierName.toLowerCase()) return true;
  return false;
}

export function lookupKnownSupplierWebsite(supplierName: string): string | null {
  const raw = supplierName.trim().toLowerCase();
  if (!raw) return null;

  // 1. Exact match.
  if (KNOWN_SUPPLIER_WEBSITES[raw]) return KNOWN_SUPPLIER_WEBSITES[raw];

  // 2. Strip leading possessives / articles + trailing noise words.
  const stripped = raw
    .replace(/^(?:the|my|our)\s+/, "")
    .replace(/\s+(store|market|website|shop|cart|online|delivery)$/g, "")
    .replace(/[.,!?]+$/g, "")
    .trim();
  if (stripped !== raw && KNOWN_SUPPLIER_WEBSITES[stripped]) {
    return KNOWN_SUPPLIER_WEBSITES[stripped];
  }

  // 3. First-token match — "Amazon Prime" → amazon, "Costco Business" → costco business.
  // Try the two-word prefix first (for "sam's club", "whole foods", etc.),
  // then the one-word prefix.
  const tokens = stripped.split(/\s+/);
  if (tokens.length >= 2) {
    const twoToken = `${tokens[0]} ${tokens[1]}`;
    if (KNOWN_SUPPLIER_WEBSITES[twoToken]) return KNOWN_SUPPLIER_WEBSITES[twoToken];
  }
  if (tokens.length >= 1 && KNOWN_SUPPLIER_WEBSITES[tokens[0]]) {
    return KNOWN_SUPPLIER_WEBSITES[tokens[0]];
  }

  return null;
}

// ── Tool schemas (OpenAI-compatible, Groq understands this format) ───────────
type ToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required?: string[];
    };
  };
};

const TOOLS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "list_inventory",
      description:
        "List every inventory item at this location with stock, par, low-stock threshold, and whether a supplier is linked. Use this whenever you need to know what items exist or check specific stock levels. Prefer this over asking the user.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_suppliers",
      description:
        "List every supplier at this location with ordering mode and email. Use before adding a new supplier to avoid duplicates.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "place_restock_order",
      description:
        "Create a purchase order (PO) for an item. Use when the user asks to order/reorder/restock something AND a supplier is linked. If no supplier is linked, tell the user and offer to link one — do NOT call this tool.\n\nQUANTITY RULES (read carefully):\n- If the user says how much to ORDER ('order 12 oz of ground coffee', 'get me 5 bags', '2 cases of milk'), pass that number+unit in requested_quantity + requested_unit.\n- If the user only reports REMAINING stock ('only 2 left', 'we have 5'), pass that in current_quantity and leave requested_quantity null — the system will compute order size from par.\n- If both: pass both. requested_quantity wins for the order amount; current_quantity updates the stock count.",
      parameters: {
        type: "object",
        properties: {
          item_id: { type: "string", description: "Inventory item id from LIVE DATA. FUZZY-MATCH the user's wording against item names there: 'grinded coffee' → ground coffee, 'oat mlk' → oat milk, 'espresso' → espresso beans. NEVER ask the user to confirm an obvious match." },
          current_quantity: {
            type: "string",
            description:
              "Current on-hand quantity the user reported (e.g. '2' if they said '2 left'). ALWAYS pass '0' if unknown or not mentioned. Never pass null.",
          },
          requested_quantity: {
            type: "string",
            description:
              "The exact amount to ORDER. Pass '0' or omit if user didn't specify. E.g. '12' for 'order 12 oz', '5' for '5 bags'. Never pass null.",
          },
          requested_unit: {
            type: "string",
            description:
              "The unit for requested_quantity. E.g. 'oz', 'bag', 'kg'. Pass '' (empty string) if not applicable. Never pass null.",
          },
        },
        required: ["item_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_stock_count",
      description:
        "Set an item's on-hand stock to a specific number. Use when the user corrects stock ('we actually have 30 bananas'). Be cautious — the user's current stock is shown in list_inventory; massive drops will be rejected for safety unless they confirmed.",
      parameters: {
        type: "object",
        properties: {
          item_id: { type: "string", description: "Inventory item id." },
          new_count: { type: "string", description: "New on-hand count in the item's base unit." },
          user_confirmed: {
            type: "boolean",
            description:
              "Set true only if the user explicitly confirmed a large drop (word like 'confirm', 'yes apply'). Otherwise false.",
          },
        },
        required: ["item_id", "new_count"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "link_supplier_to_item",
      description:
        "Link an existing supplier to an existing inventory item so future orders go to that supplier. Use when the user says things like 'psybhan supplies coconut syrup' or 'coconut syrup comes from psybhan'.",
      parameters: {
        type: "object",
        properties: {
          item_id: { type: "string", description: "Inventory item id." },
          supplier_id: { type: "string", description: "Supplier id." },
        },
        required: ["item_id", "supplier_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_add_item_flow",
      description:
        "Start the DETAILED add-item workflow (7 questions). ONLY use this when the user EXPLICITLY says they want to set up a new item with full details ('set up oat milk properly', 'configure a new item step by step'). Do NOT use this when the user wants to ORDER something — use quick_add_and_order instead. If the user says 'add to cart', 'order this', 'we need this', 'get this' — that's quick_add_and_order, NOT this tool.",
      parameters: {
        type: "object",
        properties: {
          item_name: { type: "string", description: "Name of the new item (e.g. 'coconut syrup')." },
        },
        required: ["item_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_add_supplier_flow",
      description:
        "Start the structured add-supplier workflow. Use when the user wants to add a new supplier.",
      parameters: {
        type: "object",
        properties: {
          supplier_name: { type: "string", description: "Name of the supplier." },
        },
        required: ["supplier_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_low_stock",
      description:
        "List ONLY the items that are low on stock right now — critical and warning items, in order of urgency. Cheaper than list_inventory when the user asks 'what's low?' / 'what do I need to order?' / 'anything running out?'. Shows stock on hand, days left, and linked supplier.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "check_item_stock",
      description:
        "Return current stock + par + days-left + supplier for a specific item, matched by (fuzzy) name. Use when the user asks 'how much oat milk do we have?' / 'what's our banana situation?'.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "User's phrasing of the item name — can be partial (e.g. 'oat', 'coconut syrup').",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "adjust_par_level",
      description:
        "Change an item's target stock level (par). Use when the user says things like 'bump oat milk par to 10000 ml' or 'we need less espresso beans, set par to 2kg'.",
      parameters: {
        type: "object",
        properties: {
          item_id: { type: "string", description: "Inventory item id." },
          new_par_base: {
            type: "string",
            description: "New par level in the item's base unit.",
          },
        },
        required: ["item_id", "new_par_base"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "approve_recent_order",
      description:
        "Approve the user's most recent AWAITING_APPROVAL purchase order at this location and send it to the supplier. Use when the user replies with 'approve', 'yes send it', 'go ahead', 'confirm', 'send the order' etc. — the universal YES path when a PO is waiting. Works on both Telegram and WhatsApp.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_recent_order",
      description:
        "Cancel the user's most recent AWAITING_APPROVAL (or DRAFT / APPROVED) purchase order at this location. Use when the user replies with 'cancel', 'no don't send it', 'scrap that order', 'nevermind', etc. — the universal NO path when a PO is waiting.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "quick_add_and_order",
      description:
        "FAST PATH for ordering from a website URL: creates/reuses the inventory item, creates/reuses the supplier (and *updates* its website + WEBSITE ordering mode if a URL is given), then drafts a purchase order — all in one call, no questionnaire.\n\nUSE THIS for ANY message that contains a product URL (amazon.com, costco.com, amzn.to, a.co, etc.) AND an order intent ('order this', 'add this to my cart', 'we need this', 'get me this', 'buy this'). This is true *whether or not* the item already exists in LIVE DATA — the tool is idempotent and will reuse existing rows. Do NOT call place_restock_order for URL messages, because it has no website_url field and the URL would be lost. Do NOT call start_add_item_flow for URL messages either.",
      parameters: {
        type: "object",
        properties: {
          item_name: {
            type: "string",
            description: "Product name (e.g. 'Espresso Machine Cleaner', 'Urnex Cafiza'). Extract from the URL path (Amazon URLs usually contain the product name as dash-separated words like '/Urnex-Cafiza-Espresso-Machine-Cleaning-Tablets/dp/...') or from what the user typed. If the URL is a shortlink (amzn.to, a.co) and the user didn't name the product, use a short generic label from context (e.g. 'Amazon item' or 'Espresso cleaner from Amazon').",
          },
          category: {
            type: "string",
            description: "Best guess: CLEANING, PACKAGING, COFFEE, DAIRY, ALT_DAIRY, SYRUP, BAKERY_INGREDIENT, PAPER_GOODS, SUPPLY, RETAIL. Default to SUPPLY if unsure.",
          },
          quantity: {
            type: "string",
            description: "How many to order. Default '1' if user didn't specify.",
          },
          supplier_name: {
            type: "string",
            description: "Supplier name. If user pasted a URL, derive it from the hostname: amazon.com/amzn.to/a.co → 'Amazon', costco.com → 'Costco', walmart.com → 'Walmart', etc. NEVER pass an empty string when website_url is set — the URL implies a supplier.",
          },
          website_url: {
            type: "string",
            description: "Product URL exactly as the user pasted it (full https://... including any query string). Empty string only if the user didn't paste a URL.",
          },
        },
        required: ["item_name", "category", "quantity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_pending_orders",
      description:
        "List every purchase order that's currently AWAITING_APPROVAL, APPROVED, or SENT (not yet delivered) for this location. Use when the user asks 'what's on order', 'anything in flight', 'show me pending orders'.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_order_delivered",
      description:
        "Mark the most recent SENT purchase order as DELIVERED. Use when the user says 'the milk order arrived', 'FreshCo just delivered', 'got the package', etc. Increments stock for every line in the PO.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

// ── Tool executor ─────────────────────────────────────────────────────────────
type ToolResult = {
  content: string;
  /** If present, the agent should short-circuit and return this as the bot reply. */
  finalReply?: string;
  /** Set when the tool kicked off a workflow — stops the agent loop. */
  workflowStarted?: boolean;
  /** Passed through to the caller so Telegram can attach approval buttons. */
  purchaseOrderId?: string | null;
  orderNumber?: string | null;
};

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentContext
): Promise<ToolResult> {
  switch (name) {
    case "list_inventory": {
      const items = await db.inventoryItem.findMany({
        where: { locationId: ctx.locationId },
        select: {
          id: true,
          name: true,
          stockOnHandBase: true,
          parLevelBase: true,
          lowStockThresholdBase: true,
          displayUnit: true,
          packSizeBase: true,
          baseUnit: true,
          primarySupplier: { select: { id: true, name: true } },
          supplierItems: {
            select: { supplier: { select: { id: true, name: true } } },
            take: 3,
          },
        },
        orderBy: { name: "asc" },
      });
      const content = items
        .map((i) => {
          const suppliers = [
            i.primarySupplier?.name,
            ...i.supplierItems.map((si) => si.supplier.name),
          ]
            .filter((value, idx, arr) => value && arr.indexOf(value) === idx);
          const supplierStr = suppliers.length > 0 ? suppliers.join(", ") : "NONE";
          const stock = formatQuantityBase(i.stockOnHandBase, i.displayUnit, i.packSizeBase);
          const par = formatQuantityBase(i.parLevelBase, i.displayUnit, i.packSizeBase);
          const low = i.stockOnHandBase <= i.lowStockThresholdBase ? " [LOW]" : "";
          return `- id=${i.id} name="${i.name}" stock=${stock} par=${par} supplier=${supplierStr}${low}`;
        })
        .join("\n");
      return {
        content: items.length > 0 ? content : "(no inventory items yet)",
      };
    }

    case "list_suppliers": {
      const suppliers = await db.supplier.findMany({
        where: { locationId: ctx.locationId },
        select: { id: true, name: true, email: true, orderingMode: true, leadTimeDays: true },
        orderBy: { name: "asc" },
      });
      const content = suppliers
        .map(
          (s) =>
            `- id=${s.id} name="${s.name}" email=${s.email ?? "none"} mode=${s.orderingMode} lead=${s.leadTimeDays}d`
        )
        .join("\n");
      return {
        content: suppliers.length > 0 ? content : "(no suppliers yet)",
      };
    }

    case "place_restock_order": {
      const itemId = String(args.item_id ?? "");
      const current = Number(args.current_quantity ?? 0);
      const requestedQty =
        args.requested_quantity == null
          ? null
          : Number(args.requested_quantity);
      const requestedUnit =
        typeof args.requested_unit === "string" && args.requested_unit.trim()
          ? args.requested_unit.trim()
          : null;
      if (!itemId) return { content: "ERROR: item_id required." };
      const result = await createRestockOrderFromBotMessage({
        locationId: ctx.locationId,
        userId: ctx.userId,
        channel: ctx.channel,
        inventoryItemId: itemId,
        reportedOnHandDisplay: current,
        requestedQuantity:
          requestedQty != null && Number.isFinite(requestedQty) && requestedQty > 0
            ? { value: requestedQty, unit: requestedUnit ?? "each" }
            : null,
        sourceMessageId: ctx.sourceMessageId,
        originalText: ctx.conversation[ctx.conversation.length - 1]?.content ?? "",
      });
      // Surface the service's reply verbatim + expose the PO id/number so
      // Telegram can attach inline approve/cancel buttons to the reply.
      return {
        content: result.reply,
        finalReply: result.reply,
        purchaseOrderId: result.purchaseOrderId ?? null,
        orderNumber: result.orderNumber ?? null,
      };
    }

    case "update_stock_count": {
      const itemId = String(args.item_id ?? "");
      const newCount = Number(args.new_count ?? 0);
      const confirmed = Boolean(args.user_confirmed);
      if (!itemId) return { content: "ERROR: item_id required." };
      const result = await updateStockCountFromBotMessage({
        locationId: ctx.locationId,
        userId: ctx.userId,
        inventoryItemId: itemId,
        correctedOnHand: newCount,
        requireConfirmationForLargeDrop: !confirmed,
        itemNameInMessage: confirmed,
      });
      return { content: result.reply, finalReply: result.reply };
    }

    case "link_supplier_to_item": {
      const itemId = String(args.item_id ?? "");
      const supplierId = String(args.supplier_id ?? "");
      if (!itemId || !supplierId) return { content: "ERROR: item_id and supplier_id required." };
      const [item, supplier] = await Promise.all([
        db.inventoryItem.findFirst({
          where: { id: itemId, locationId: ctx.locationId },
          select: { id: true, name: true, packSizeBase: true },
        }),
        db.supplier.findFirst({
          where: { id: supplierId, locationId: ctx.locationId },
          select: { id: true, name: true },
        }),
      ]);
      if (!item || !supplier) {
        return { content: "ERROR: item or supplier not found at this location." };
      }
      await db.supplierItem.upsert({
        where: {
          supplierId_inventoryItemId: { supplierId: supplier.id, inventoryItemId: item.id },
        },
        create: {
          supplierId: supplier.id,
          inventoryItemId: item.id,
          packSizeBase: item.packSizeBase,
          minimumOrderQuantity: 1,
          preferred: true,
        },
        update: { preferred: true },
      });
      await db.inventoryItem.update({
        where: { id: item.id },
        data: { primarySupplierId: supplier.id },
      });
      return {
        content: `Linked supplier "${supplier.name}" to item "${item.name}". Future orders for ${item.name} will go to ${supplier.name}.`,
      };
    }

    case "quick_add_and_order": {
      let itemName = String(args.item_name ?? "").trim();
      const category = String(args.category ?? "SUPPLY").toUpperCase();
      const quantity = Math.max(1, Number(args.quantity ?? 1));
      const supplierName = String(args.supplier_name ?? "").trim();
      const websiteUrl = normalizeProductUrl(String(args.website_url ?? ""));
      // Supplier.website holds the bare hostname root so the browser
      // adapter can build search URLs like `${website}/s?k=...` without
      // tacking the search path onto a deep product URL. The full
      // pasted URL is preserved on the PO line so the agent can
      // navigate directly to that product page when present.
      //
      // Two ways to end up with a website:
      //   - User pasted a URL → derive root from it
      //   - No URL, but supplier_name matches a well-known brand
      //     (LCBO, Costco, Amazon, ...) → use the canonical root so
      //     the browser agent has somewhere to search
      const supplierWebsiteRoot =
        (websiteUrl ? toHostnameRoot(websiteUrl) : "") ||
        lookupKnownSupplierWebsite(supplierName) ||
        "";

      // Safety net: if the model called us with a generic placeholder
      // like "Item from Amazon" or a suspiciously short name AND we
      // have a URL, fetch the page's og:title and use the real name.
      // Prevents the bug where the search fallback ends up looking
      // for "Item from Amazon" instead of the actual product.
      if (websiteUrl && looksLikeGenericItemName(itemName, supplierName)) {
        const { fetchProductMetadata } = await import(
          "@/modules/automation/product-metadata"
        );
        const meta = await fetchProductMetadata(websiteUrl, { timeoutMs: 5000 });
        if (meta?.title && meta.title.length >= 3) {
          itemName = meta.title;
        }
      }
      if (!itemName) return { content: "ERROR: item_name required." };

      try {
        // 1. Find existing item by fuzzy name match, or create new.
        // Prevents duplicates when the user orders the same product
        // multiple times via quick_add_and_order.
        let newItem = await db.inventoryItem.findFirst({
          where: {
            locationId: ctx.locationId,
            name: { equals: itemName, mode: "insensitive" },
          },
          select: { id: true, name: true },
        });
        if (!newItem) {
          const sku = `QA-${Date.now().toString(36).toUpperCase()}`;
          // Attach the pasted URL to notes so the /inventory page's
          // image resolver can extract og:image from it on first
          // render. Keeps bot path fast (no synchronous HTTP fetch).
          const seedNotes = websiteUrl ? `Product URL: ${websiteUrl}` : null;
          newItem = await db.inventoryItem.create({
            data: {
              locationId: ctx.locationId,
              name: itemName,
              sku,
              category: (category in InventoryCategory ? category : "SUPPLY") as Prisma.InventoryItemCreateInput["category"],
              baseUnit: "COUNT",
              displayUnit: "COUNT",
              countUnit: "COUNT",
              purchaseUnit: "COUNT",
              packSizeBase: 1,
              stockOnHandBase: 0,
              parLevelBase: Math.max(1, quantity * 2),
              safetyStockBase: quantity,
              lowStockThresholdBase: quantity,
              notes: seedNotes,
            },
          });
        }

        // 2. Create/find supplier. Idempotent: re-pasting the same URL
        // for the same item must NOT crash — it's how users iterate.
        let supplierId: string | null = null;
        if (supplierName) {
          const existing = await db.supplier.findFirst({
            where: {
              locationId: ctx.locationId,
              name: { equals: supplierName, mode: "insensitive" },
            },
            select: { id: true, website: true, orderingMode: true },
          });
          if (existing) {
            supplierId = existing.id;
            // Backfill website + flip to WEBSITE mode whenever we
            // can determine a hostname (either from a fresh URL or
            // from the known-supplier lookup). Without this, the
            // second paste of the same Amazon link silently keeps
            // the supplier in MANUAL mode and the browser-agent
            // dispatch bails out with "Supplier has no website URL
            // configured".
            const existingWebsiteIsRoot =
              !!existing.website && /^https?:\/\/[^/]+\/?$/i.test(existing.website);
            if (
              supplierWebsiteRoot &&
              (!existing.website ||
                !existingWebsiteIsRoot ||
                existing.orderingMode !== "WEBSITE")
            ) {
              await db.supplier.update({
                where: { id: existing.id },
                data: {
                  website: supplierWebsiteRoot,
                  orderingMode: "WEBSITE",
                },
              });
            }
          } else {
            const created = await db.supplier.create({
              data: {
                locationId: ctx.locationId,
                name: supplierName,
                orderingMode: supplierWebsiteRoot ? "WEBSITE" : "MANUAL",
                website: supplierWebsiteRoot || null,
                leadTimeDays: 3,
              },
            });
            supplierId = created.id;
          }
          // Link supplier ↔ item via the unique (supplierId, inventoryItemId)
          // pair. upsert = idempotent: second call is a no-op instead of
          // a P2002 unique-constraint crash that aborts the whole flow.
          await db.supplierItem.upsert({
            where: {
              supplierId_inventoryItemId: {
                supplierId,
                inventoryItemId: newItem.id,
              },
            },
            create: {
              supplierId,
              inventoryItemId: newItem.id,
              packSizeBase: 1,
              minimumOrderQuantity: 1,
              preferred: true,
            },
            update: { preferred: true },
          });
          await db.inventoryItem.update({
            where: { id: newItem.id },
            data: { primarySupplierId: supplierId },
          });
        }

        // 3. Create the PO. PurchaseOrder.supplierId is non-nullable
        // in the schema, so the no-supplier branch can't draft an
        // order — we add the item to inventory only and ask the user
        // who supplies it. The full pasted URL lives on the line
        // (not the PO header) so the browser agent can navigate
        // straight to that product page when fulfilling the order
        // — see browser-agent.ts:extractLineProductUrl.
        if (!supplierId) {
          const reply = `✅ Added *${itemName}* to inventory. I can't draft a PO yet — tell me who supplies it (e.g. "Amazon supplies it") and I'll set the rest up.`;
          return {
            content: reply,
            finalReply: reply,
          };
        }

        const orderNumber = nextOrderNumber();
        const po = await db.purchaseOrder.create({
          data: {
            locationId: ctx.locationId,
            supplierId,
            orderNumber,
            status: "AWAITING_APPROVAL",
            totalLines: 1,
            placedById: ctx.userId,
          },
        });
        await db.purchaseOrderLine.create({
          data: {
            purchaseOrderId: po.id,
            inventoryItemId: newItem.id,
            description: itemName,
            quantityOrdered: quantity,
            expectedQuantityBase: quantity,
            purchaseUnit: "COUNT",
            packSizeBase: 1,
            notes: websiteUrl ? `Product URL: ${websiteUrl}` : undefined,
          },
        });

        // Auto-approve: if location has a threshold + supplier is
        // EMAIL-mode + total is under threshold → send immediately.
        // quick_add rarely has latestCostCents stamped (the supplier
        // is often fresh), so for most cases this falls through and
        // the manager still sees "tap Approve". When it fires, the
        // manager gets "✅ Auto-sent, under your $X rule" instead.
        const { maybeAutoApprovePurchaseOrder, formatMoney } = await import(
          "@/modules/purchasing/auto-approve"
        );
        const auto = await maybeAutoApprovePurchaseOrder({
          purchaseOrderId: po.id,
          userId: ctx.userId,
        });
        if (auto.autoApproved && auto.status === PurchaseOrderStatus.SENT) {
          const reply = `✅ Auto-sent *${orderNumber}* — ${quantity} of *${itemName}* from *${supplierName}* (${formatMoney(auto.totalCents)}, under your ${formatMoney(auto.thresholdCents)} rule).`;
          return {
            content: reply,
            finalReply: reply,
            purchaseOrderId: po.id,
            orderNumber,
          };
        }

        const websiteNote = websiteUrl ? " I'll head to their website to add it to the cart once you approve." : "";
        const reply = `✅ Added *${itemName}* to inventory + drafted *${orderNumber}* for ${quantity} from *${supplierName}*.${websiteNote} Tap Approve to send.`;

        return {
          content: reply,
          finalReply: reply,
          purchaseOrderId: po.id,
          orderNumber,
        };
      } catch (err) {
        return {
          content: `Failed to quick-add: ${err instanceof Error ? err.message : "unknown error"}`,
        };
      }
    }

    case "start_add_item_flow": {
      const itemName = String(args.item_name ?? "").trim();
      if (!itemName) return { content: "ERROR: item_name required." };
      const { reply, initialData } = startAddItem(itemName);
      await saveWorkflowState({
        locationId: ctx.locationId,
        userId: ctx.userId,
        senderId: ctx.senderId,
        channel: toBotChannel(ctx.channel),
        workflow: "ADD_ITEM",
        step: "init",
        data: initialData,
      });
      return { content: reply, finalReply: reply, workflowStarted: true };
    }

    case "start_add_supplier_flow": {
      const supplierName = String(args.supplier_name ?? "").trim();
      if (!supplierName) return { content: "ERROR: supplier_name required." };
      const { reply, initialData } = startAddSupplier(supplierName);
      await saveWorkflowState({
        locationId: ctx.locationId,
        userId: ctx.userId,
        senderId: ctx.senderId,
        channel: toBotChannel(ctx.channel),
        workflow: "ADD_SUPPLIER",
        step: "init",
        data: initialData,
      });
      return { content: reply, finalReply: reply, workflowStarted: true };
    }

    case "list_low_stock": {
      const items = await db.inventoryItem.findMany({
        where: {
          locationId: ctx.locationId,
          snapshot: { urgency: { in: ["CRITICAL", "WARNING"] } },
        },
        select: {
          id: true,
          name: true,
          stockOnHandBase: true,
          parLevelBase: true,
          displayUnit: true,
          packSizeBase: true,
          primarySupplier: { select: { name: true } },
          snapshot: { select: { urgency: true, daysLeft: true } },
        },
        orderBy: [{ snapshot: { urgency: "desc" } }, { name: "asc" }],
        take: 30,
      });
      if (items.length === 0) {
        return { content: "All stocked — nothing is running low right now." };
      }
      const content = items
        .map((i) => {
          const stock = formatQuantityBase(i.stockOnHandBase, i.displayUnit, i.packSizeBase);
          const par = formatQuantityBase(i.parLevelBase, i.displayUnit, i.packSizeBase);
          const days = i.snapshot?.daysLeft != null ? `${Math.round(i.snapshot.daysLeft)}d left` : "—";
          const urg = i.snapshot?.urgency === "CRITICAL" ? "[URGENT]" : "[WATCH]";
          return `- id=${i.id} ${urg} ${i.name}: ${stock} / par ${par} (${days}) · supplier=${i.primarySupplier?.name ?? "NONE"}`;
        })
        .join("\n");
      return { content };
    }

    case "check_item_stock": {
      const query = String(args.query ?? "").toLowerCase().trim();
      if (!query) return { content: "ERROR: query required." };
      const candidates = await db.inventoryItem.findMany({
        where: { locationId: ctx.locationId },
        select: {
          id: true,
          name: true,
          stockOnHandBase: true,
          parLevelBase: true,
          displayUnit: true,
          packSizeBase: true,
          primarySupplier: { select: { name: true } },
          snapshot: { select: { urgency: true, daysLeft: true } },
        },
      });
      const match =
        candidates.find((c) => c.name.toLowerCase() === query) ??
        candidates.find((c) => c.name.toLowerCase().includes(query)) ??
        candidates.find((c) => query.includes(c.name.toLowerCase())) ??
        null;
      if (!match) {
        return { content: `No item matching "${query}".` };
      }
      const stock = formatQuantityBase(match.stockOnHandBase, match.displayUnit, match.packSizeBase);
      const par = formatQuantityBase(match.parLevelBase, match.displayUnit, match.packSizeBase);
      const days = match.snapshot?.daysLeft != null ? `${Math.round(match.snapshot.daysLeft)} days left` : "no forecast";
      return {
        content:
          `${match.name}: ${stock} on hand · par ${par} · ${days} · ` +
          `supplier=${match.primarySupplier?.name ?? "NONE"} · ` +
          `status=${match.snapshot?.urgency ?? "INFO"} · id=${match.id}`,
      };
    }

    case "approve_recent_order": {
      const recent = await db.purchaseOrder.findFirst({
        where: {
          locationId: ctx.locationId,
          status: { in: [PurchaseOrderStatus.AWAITING_APPROVAL, PurchaseOrderStatus.DRAFT] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, orderNumber: true },
      });
      if (!recent) {
        return {
          content: "No pending order to approve — nothing is currently waiting for your decision.",
          finalReply: "👀 Nothing waiting for approval right now.",
        };
      }
      const result = await approveAndDispatchPurchaseOrder({
        purchaseOrderId: recent.id,
        userId: ctx.userId,
      });
      if (result.status === PurchaseOrderStatus.SENT) {
        return {
          content: `Approved and dispatched ${result.orderNumber} to ${result.supplierName}.`,
          finalReply: `✅ *${result.orderNumber}* approved and sent to *${result.supplierName}*.`,
          purchaseOrderId: recent.id,
          orderNumber: result.orderNumber,
        };
      }
      if (result.status === PurchaseOrderStatus.FAILED) {
        return {
          content: `Approval succeeded but dispatch failed: ${result.reason ?? "unknown reason"}.`,
          finalReply: `⚠ *${result.orderNumber}* approved, but the dispatch to *${result.supplierName}* failed.\n${result.reason ? `Reason: ${result.reason}\n` : ""}Reply *retry* to try again.`,
          purchaseOrderId: recent.id,
          orderNumber: result.orderNumber,
        };
      }
      return {
        content: `Approved ${result.orderNumber}; current status ${result.status}.`,
        finalReply: `✅ *${result.orderNumber}* approved — ${result.supplierName} has a manual / website ordering mode, task created.`,
        purchaseOrderId: recent.id,
        orderNumber: result.orderNumber,
      };
    }

    case "list_pending_orders": {
      const pos = await db.purchaseOrder.findMany({
        where: {
          locationId: ctx.locationId,
          status: {
            in: [
              PurchaseOrderStatus.AWAITING_APPROVAL,
              PurchaseOrderStatus.DRAFT,
              PurchaseOrderStatus.APPROVED,
              PurchaseOrderStatus.SENT,
              PurchaseOrderStatus.ACKNOWLEDGED,
            ],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          supplier: { select: { name: true } },
          lines: {
            select: {
              inventoryItem: { select: { name: true } },
              quantityOrdered: true,
              purchaseUnit: true,
            },
          },
        },
      });
      if (pos.length === 0) {
        return {
          content: "No pending orders.",
          finalReply: "No orders in flight.",
        };
      }
      const lines = pos.map((po) => {
        const items = po.lines
          .map((l) => `${l.inventoryItem.name} ×${l.quantityOrdered}`)
          .join(", ");
        return `- ${po.orderNumber} · ${po.status.toLowerCase()} · ${po.supplier.name} · ${items}`;
      });
      return { content: lines.join("\n") };
    }

    case "mark_order_delivered": {
      const po = await db.purchaseOrder.findFirst({
        where: {
          locationId: ctx.locationId,
          status: { in: [PurchaseOrderStatus.SENT, PurchaseOrderStatus.ACKNOWLEDGED] },
        },
        orderBy: { sentAt: "desc" },
        include: {
          supplier: { select: { name: true } },
          lines: { include: { inventoryItem: true } },
        },
      });
      if (!po) {
        return {
          content: "No sent orders awaiting delivery.",
          finalReply: "👀 Nothing's waiting to be delivered right now.",
        };
      }

      // Transition PO + increment stock for each line in one transaction.
      const summary = await db.$transaction(async (tx) => {
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: PurchaseOrderStatus.DELIVERED, deliveredAt: new Date() },
        });
        const stockUpdates: string[] = [];
        for (const line of po.lines) {
          const newStock = line.inventoryItem.stockOnHandBase + line.expectedQuantityBase;
          await tx.inventoryItem.update({
            where: { id: line.inventoryItem.id },
            data: { stockOnHandBase: newStock },
          });
          stockUpdates.push(
            `${line.inventoryItem.name}: ${line.inventoryItem.stockOnHandBase} → ${newStock}`
          );
        }
        return stockUpdates;
      });

      return {
        content: `Marked ${po.orderNumber} delivered; stock updated: ${summary.join("; ")}`,
        finalReply: `📦 *${po.orderNumber}* delivered from *${po.supplier.name}*.\nStock updated: ${summary.join(", ")}.`,
        purchaseOrderId: po.id,
        orderNumber: po.orderNumber,
      };
    }

    case "cancel_recent_order": {
      const recent = await db.purchaseOrder.findFirst({
        where: {
          locationId: ctx.locationId,
          status: {
            in: [
              PurchaseOrderStatus.AWAITING_APPROVAL,
              PurchaseOrderStatus.DRAFT,
              PurchaseOrderStatus.APPROVED,
            ],
          },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, orderNumber: true, supplier: { select: { name: true } } },
      });
      if (!recent) {
        return {
          content: "No pending order to cancel.",
          finalReply: "👀 Nothing to cancel — no pending orders.",
        };
      }
      await db.purchaseOrder.update({
        where: { id: recent.id },
        data: { status: PurchaseOrderStatus.CANCELLED },
      });
      await db.auditLog.create({
        data: {
          locationId: ctx.locationId,
          userId: ctx.userId,
          action: "purchase_order.cancelled_via_bot_text",
          entityType: "purchaseOrder",
          entityId: recent.id,
          details: {
            channel: ctx.channel,
            orderNumber: recent.orderNumber,
          },
        },
      });
      return {
        content: `Cancelled ${recent.orderNumber}.`,
        finalReply: `✖ *${recent.orderNumber}* cancelled.\nNothing was sent to ${recent.supplier?.name ?? "the supplier"}.`,
        purchaseOrderId: recent.id,
        orderNumber: recent.orderNumber,
      };
    }

    case "adjust_par_level": {
      const itemId = String(args.item_id ?? "");
      const newPar = Number(args.new_par_base ?? 0);
      if (!itemId || !(newPar > 0)) {
        return { content: "ERROR: item_id + positive new_par_base required." };
      }
      const item = await db.inventoryItem.findFirst({
        where: { id: itemId, locationId: ctx.locationId },
        select: { id: true, name: true, displayUnit: true, packSizeBase: true, parLevelBase: true },
      });
      if (!item) return { content: "ERROR: item not found at this location." };
      const lowStockThresholdBase = Math.max(1, Math.floor(newPar * 0.3));
      const safetyStockBase = Math.max(1, Math.floor(newPar * 0.15));
      await db.inventoryItem.update({
        where: { id: item.id },
        data: {
          parLevelBase: Math.round(newPar),
          lowStockThresholdBase,
          safetyStockBase,
        },
      });
      const oldLabel = formatQuantityBase(item.parLevelBase, item.displayUnit, item.packSizeBase);
      const newLabel = formatQuantityBase(Math.round(newPar), item.displayUnit, item.packSizeBase);
      return {
        content: `Par for "${item.name}" is now ${newLabel} (was ${oldLabel}). Low-stock alert at ${lowStockThresholdBase}.`,
        finalReply: `✅ Par updated for *${item.name}*: ${oldLabel} → ${newLabel}`,
      };
    }

    default:
      return { content: `ERROR: unknown tool ${name}` };
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT_BASE = `You are StockBuddy — a sharp, concise inventory assistant for a café. You talk via Telegram/WhatsApp.

## CORE RULES
1. LIVE DATA below = truth. Every number/unit/name MUST come from there or a tool response.
2. Fuzzy-match items: "grinded coffee"=Ground Coffee, "oat mlk"=Oat Milk, "the syrup"=only syrup in LIVE DATA. When EXACTLY ONE item matches, use it silently.
3. Honor user's quantity verbatim. "12 oz" → pass 12 oz. Don't round or override.
4. yes/approve/ok/👍 → approve_recent_order. no/cancel/nvm/❌ → cancel_recent_order.
5. ANY message containing a URL (https://, http://, amzn.to, a.co, costco.com, etc.) + ANY order intent ("add to cart", "order this", "we need this", "get me", "buy this", "order this for me") → ALWAYS call quick_add_and_order with website_url set. NEVER call place_restock_order for URL messages (it has no website_url field — the URL would be lost). NEVER call start_add_item_flow for URL messages. quick_add_and_order is idempotent — call it even when the item already exists in LIVE DATA. Derive supplier_name from the hostname (amazon.com/amzn.to/a.co → "Amazon", costco.com → "Costco"). Never ask "what's it for?" on cleaning/packaging supplies.
5b. ORDER INTENT + SUPPLIER NAME but NO URL ("add 5 bottles of X to my LCBO cart", "order Y from Costco", "buy Z at Walmart") → call quick_add_and_order ONCE PER ITEM with item_name + quantity + supplier_name set and website_url="". Each call drafts a separate PO. After all calls, summarise: "📋 Drafted 2 POs — 5 bottles of X + 3 boxes of Y from LCBO. Approve them to send."
6. NEVER claim "I can't access websites" or "I can only draft purchase orders" — when an order intent comes in, call quick_add_and_order. The browser ordering agent runs after PO approval and handles the website. Refusing to act is the wrong answer.
7. NEVER say tool names, empty placeholders, or "How can I help?". Sound like a colleague.
8. 1-3 sentences max per call. Don't repeat yourself.
9. NEVER claim an action you didn't take. "Cancelled.", "Sent.", "Approved.", "Done.", "Drafted.", "Added." require you to have ACTUALLY called the matching tool in this turn (cancel_recent_order / approve_recent_order / place_restock_order / quick_add_and_order / update_stock_count). If you didn't call the tool, say what you'll do, not that it's done.

## AMBIGUITY RESOLUTION — READ CAREFULLY

Before calling any order-creating tool (place_restock_order, quick_add_and_order, update_stock_count), check for ambiguity. If ANY of the following is true, ASK a single clarifying question instead of committing:

A. MULTIPLE ITEM MATCHES. User's phrasing matches >1 item in LIVE DATA.
   Example: "we need milk" when LIVE DATA has "Milk 2%", "Oat Milk", "Whole Milk".
   Wrong: pick one and draft. Right: "Which one — Milk 2%, Oat Milk, or Whole Milk?"

B. NO ITEM MATCH AT ALL. Nothing in LIVE DATA resembles what the user said.
   Example: "order 5 of the new lavender syrup" when no syrup-like item exists.
   Wrong: draft against a guess. Right: "I don't see a lavender syrup yet — want to add it first (name, supplier, par level)?"

C. UNIT MISMATCH. User's unit doesn't fit the item's tracked_in field.
   Example: item tracked_in=g, user says "order 3 liters of espresso beans".
   NEVER silently drop the user's unit and draft with a bare number. If the units don't match, ASK.
   Wrong: quick_add_and_order(quantity="3") with no unit.
   Right: "Beans are tracked by the gram — did you mean 3 kg or 3 bags?"

D. MISSING SUPPLIER when item has [MULTI_SUPPLIER]. LIVE DATA flags items with >1 supplier with the literal tag [MULTI_SUPPLIER]. If the user hasn't named a supplier on such an item, ASK.
   Example: "order more oat milk" and the Oat Milk line shows suppliers=["Costco","FreshCo"] [MULTI_SUPPLIER].
   Wrong: pick one or call place_restock_order without supplier_id. Right: "From Costco or FreshCo?"

E. MISSING QUANTITY when the intent is an order (not a count/approve/cancel).
   Wrong: default to 1 silently. Right: "How many cases? The last order was 4."

DEFAULT BIAS: when in doubt, ask. One good clarifying question beats five wrong commits.

## BAD EXAMPLES — DO NOT DO THESE

User: "we need more milk"  (LIVE DATA has Milk 2%, Oat Milk, Whole Milk)
❌ "📋 Drafted PO — 4L Milk 2% from FreshCo. Approve?"   — picked without asking
✅ "Which milk — Milk 2%, Oat Milk, or Whole Milk?"

User: "is my milk order ready?"   (MOST_RECENT_PURCHASE_ORDER is for tomatoes, not milk)
❌ "Yes, it arrives tomorrow."   — confused the tomato PO for milk
✅ "No active milk order — the open one is for tomatoes from FreshCo. Want to draft milk too?"

User: "the supplier isn't responding"
❌ "I'll follow up with them."   — vague, didn't look at any data
✅ (check SUPPLIERS + recent comms) "FreshCo hasn't replied to PO-2026-x. Draft a follow-up email?"

User: "order 5 coffees"   (LIVE DATA has Espresso Beans, Ground Coffee, Coffee Cups)
❌ place_restock_order with "Coffee"   — invented a name that isn't in LIVE DATA
✅ "5 of what — Espresso Beans, Ground Coffee, or Coffee Cups?"

User: "add 3 of these https://example.com/something"   (hostname matches NO known supplier in LIVE DATA)
❌ call quick_add_and_order with supplier_name="example.com"
✅ "example.com isn't one of your suppliers yet. Add it first, or should I fall back to a known supplier?"

## GOOD EXAMPLES

User: "oat milk 2 left" → call place_restock_order, reply: "📋 Drafted PO — 10 L oat milk from FreshCo. Approve?"
User: "order 12 oz grinded coffee" → fuzzy→Ground Coffee (exactly one match), reply: "📋 12 oz Ground Coffee from BeanCo. Approve?"
User: "approve" → call approve_recent_order, reply: "✅ Sent to FreshCo."
User: "add this to my cart https://a.co/abc123" → quick_add_and_order(item_name="Amazon item", category="SUPPLY", quantity="1", supplier_name="Amazon", website_url="https://a.co/abc123"). Reply: "✅ Added + drafted PO. Approve?"
User: "order this https://www.amazon.com/Urnex-Cafiza-Espresso-Cleaning-Tablets/dp/B005YJZE2I" → quick_add_and_order(item_name="Urnex Cafiza Espresso Cleaning Tablets", category="CLEANING", quantity="1", supplier_name="Amazon", website_url="https://www.amazon.com/Urnex-Cafiza-Espresso-Cleaning-Tablets/dp/B005YJZE2I"). Reply: "✅ Added + drafted PO. Approve?"
User: "get me 3 of these https://www.costco.com/oat-milk.html" (item already exists) → STILL quick_add_and_order(item_name="Oat Milk", category="ALT_DAIRY", quantity="3", supplier_name="Costco", website_url="..."). Reply: "✅ Drafted PO for 3. Approve?"
User: "add 5 bottles of jp wisers and 3 box of bella terra in my cart in lcbo website" → call quick_add_and_order TWICE: (1) item_name="JP Wisers", category="SUPPLY", quantity="5", supplier_name="LCBO", website_url=""  (2) item_name="Bella Terra", category="SUPPLY", quantity="3", supplier_name="LCBO", website_url="". Reply: "📋 Drafted 2 POs from LCBO — 5 JP Wisers + 3 Bella Terra. Approve to send."
User: "order from amazon: 2 cans of cleaner" → quick_add_and_order(item_name="Cleaner", category="CLEANING", quantity="2", supplier_name="Amazon", website_url=""). NEVER refuse with "I can't access websites".
User: "what do I need" → list below-par items from LIVE DATA, offer to draft all.
User: "nvm" → cancel_recent_order, reply: "Cancelled."`;

// ── Groq client ───────────────────────────────────────────────────────────────
type GroqToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type GroqMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: GroqToolCall[];
  tool_call_id?: string;
  name?: string;
};

// Default model — override with GROQ_BOT_MODEL env var.
// Llama 4 Scout: native tool calling, separate TPD quota from 70b
// (which we burned out), and the newest Llama 4 model on Groq.
const DEFAULT_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

async function callGroq(messages: GroqMessage[]): Promise<{
  content: string | null;
  tool_calls: GroqToolCall[];
}> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");

  const model = process.env.GROQ_BOT_MODEL ?? DEFAULT_MODEL;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      top_p: 0.95,
      max_tokens: 512,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Groq ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: { content?: string | null; tool_calls?: GroqToolCall[] };
    }>;
  };
  const msg = data.choices?.[0]?.message;
  return {
    content: msg?.content ?? null,
    tool_calls: msg?.tool_calls ?? [],
  };
}

// ── Live-data snapshot: grounds every turn in real numbers ──────────────────
// Compact authoritative inventory + suppliers + most-recent PO. Used to
// stop the model hallucinating units, stock levels, item names.
//
// The snapshot is hard-capped to keep us under Groq's TPM ceiling. When
// a location has more than INVENTORY_LIMIT items we rank by URGENCY
// (CRITICAL > WARNING > everything else) so the bot still sees the
// items the user is most likely to ask about, instead of an arbitrary
// alphabetical slice. A truncation marker tells the model how many
// items are hidden so it can tell the user "I don't have that one in
// my view, ask me to look it up" instead of confidently denying.

const INVENTORY_LIMIT = 30;
const SUPPLIER_LIMIT = 30;

export type LiveDataItem = {
  id: string;
  name: string;
  stockOnHandBase: number;
  parLevelBase: number;
  baseUnit: string;
  primarySupplier: { id: string; name: string } | null;
  supplierItems: Array<{ supplier: { id: string; name: string } }>;
  snapshot: { urgency: string | null } | null;
};

/**
 * Pure function — exported for testing. Sorts items so urgent ones
 * surface first when truncating, then falls back to alphabetical so
 * runs are deterministic. CRITICAL > WARNING > anything else.
 */
export function rankItemsByUrgency<T extends LiveDataItem>(items: T[]): T[] {
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

async function buildLiveDataBlock(ctx: AgentContext): Promise<string> {
  // Pull more than the limit so we have room to rank-then-truncate.
  // Pulling 200 covers typical café locations (50–150 SKUs) without
  // round-trip pain; locations bigger than that get truncated to
  // CRITICAL+WARNING items only.
  const [items, recentOrder, totalItems] = await Promise.all([
    db.inventoryItem.findMany({
      where: { locationId: ctx.locationId },
      select: {
        id: true,
        name: true,
        baseUnit: true,
        displayUnit: true,
        packSizeBase: true,
        stockOnHandBase: true,
        parLevelBase: true,
        primarySupplier: { select: { id: true, name: true } },
        supplierItems: {
          select: { supplier: { select: { id: true, name: true } } },
          take: 8,
        },
        snapshot: { select: { urgency: true } },
      },
      orderBy: { name: "asc" },
      take: 200,
    }),
    db.purchaseOrder.findFirst({
      where: {
        locationId: ctx.locationId,
        status: { in: ["AWAITING_APPROVAL", "DRAFT", "SENT", "FAILED"] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        supplier: { select: { name: true } },
        lines: {
          select: {
            inventoryItem: { select: { name: true } },
            quantityOrdered: true,
            purchaseUnit: true,
          },
          take: 3,
        },
      },
    }),
    db.inventoryItem.count({ where: { locationId: ctx.locationId } }),
  ]);

  const suppliers = await db.supplier.findMany({
    where: { locationId: ctx.locationId },
    select: { id: true, name: true, email: true, orderingMode: true },
    orderBy: { name: "asc" },
    take: SUPPLIER_LIMIT,
  });

  const ranked = rankItemsByUrgency(items as LiveDataItem[]);
  const visible = ranked.slice(0, INVENTORY_LIMIT);
  const hidden = totalItems - visible.length;

  const itemLines = visible.map((i) => {
    // Dedupe + list ALL suppliers. Rule D (multi-supplier → ask) only
    // works if the model can see there IS a second supplier.
    const supplierNames = Array.from(
      new Set(
        [
          i.primarySupplier?.name,
          ...i.supplierItems.map((si) => si.supplier.name),
        ].filter((n): n is string => Boolean(n))
      )
    );
    const suppliersField =
      supplierNames.length === 0
        ? 'suppliers=[] [NO_SUPPLIER]'
        : supplierNames.length === 1
          ? `suppliers=["${supplierNames[0]}"]`
          : `suppliers=[${supplierNames.map((n) => `"${n}"`).join(", ")}] [MULTI_SUPPLIER]`;
    const unit = i.baseUnit === "GRAM" ? "g" : i.baseUnit === "MILLILITER" ? "ml" : "count";
    const urg = i.snapshot?.urgency === "CRITICAL"
      ? " [CRITICAL]"
      : i.snapshot?.urgency === "WARNING"
        ? " [LOW]"
        : "";
    return `- id=${i.id} name="${i.name}" tracked_in=${unit} on_hand=${i.stockOnHandBase}${unit} par=${i.parLevelBase}${unit} ${suppliersField}${urg}`;
  });

  if (hidden > 0) {
    itemLines.push(
      `- (...${hidden} more items not shown — call check_item_stock or list_inventory to look up specifics)`
    );
  }

  const supplierLines = suppliers.map(
    (s) => `- id=${s.id} name="${s.name}" mode=${s.orderingMode}`
  );

  const orderBlock = recentOrder
    ? [
        `MOST_RECENT_PURCHASE_ORDER:`,
        `  number: ${recentOrder.orderNumber}`,
        `  status: ${recentOrder.status}`,
        `  supplier: ${recentOrder.supplier.name}`,
        `  lines:`,
        ...recentOrder.lines.map(
          (l) =>
            `    - ${l.inventoryItem.name}: ${l.quantityOrdered} ${l.purchaseUnit.toLowerCase()}`
        ),
      ].join("\n")
    : "MOST_RECENT_PURCHASE_ORDER: (none)";

  return [
    "LIVE DATA (authoritative — trust this over the user's claims):",
    "",
    "INVENTORY (low-stock items first):",
    itemLines.length ? itemLines.join("\n") : "  (no items yet)",
    "",
    "SUPPLIERS:",
    supplierLines.length ? supplierLines.join("\n") : "  (no suppliers yet)",
    "",
    orderBlock,
  ].join("\n");
}

// ── Output sanitiser ───────────────────────────────────────────────────────
// Last-line-of-defence: even with the strongest prompt the model sometimes
// slips and mentions tool names, leaves empty placeholders, or narrates
// "I'll now call list_inventory for you". Strip those before the user
// sees them.

const TOOL_NAME_PATTERN = /\b(place_restock_order|update_stock_count|list_inventory|list_low_stock|list_suppliers|link_supplier_to_item|adjust_par_level|approve_recent_order|cancel_recent_order|start_add_item_flow|start_add_supplier_flow|check_item_stock)\b/gi;

export function sanitiseReply(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  let text = raw;

  // Empty inline-code placeholders ("the order is ``", "PO-PO-XXXX").
  text = text.replace(/``/g, "");
  text = text.replace(/PO-PO-\w+/g, "");
  text = text.replace(/\bPO-\d{4}-XXXX\b/gi, "");

  // Tool names bleeding into user text.
  if (TOOL_NAME_PATTERN.test(text)) {
    // Rewrite the phrase rather than delete it — readers should still get
    // SOME signal. Replace the tool name with a neutral verb.
    text = text.replace(TOOL_NAME_PATTERN, (match) => {
      const lookup: Record<string, string> = {
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
      };
      return lookup[match.toLowerCase()] ?? match;
    });
  }

  // Narration patterns: "I'll call X to...", "Let me check X for you"
  text = text.replace(/I'll (call |use |run )(the |a )?[a-z_]+ (tool|function)(\.|,)?/gi, "");
  text = text.replace(/Let me (call |use |run )(the |a )?[a-z_]+ (tool|function)(\.|,)?/gi, "");

  // Collapse double spaces and trim.
  text = text.replace(/ {2,}/g, " ").trim();

  // If after sanitisation we have nothing useful, fall back.
  if (text.length < 2) return fallback;
  return text;
}

// ── Public entry point ────────────────────────────────────────────────────────
export async function runBotAgent(ctx: AgentContext): Promise<BotHandlingResult> {
  const liveData = await buildLiveDataBlock(ctx);
  const systemPrompt = `${SYSTEM_PROMPT_BASE}\n\n${liveData}`;

  const messages: GroqMessage[] = [
    { role: "system", content: systemPrompt },
    ...ctx.conversation.map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
  ];

  let finalReply: string | null = null;
  let purchaseOrderId: string | null = null;
  let orderNumber: string | null = null;

  // Telemetry capture — writes one `bot.llm_turn` audit row at the
  // end of this function so ops can debug bot misbehaviour with
  // exactly what the model saw and what it decided. Cheap + keyed
  // on the message id so one telemetry row ↔ one user message.
  const turnStartedAt = Date.now();
  const lastUserMsg = ctx.conversation
    .filter((t) => t.role === "user")
    .at(-1)?.content ?? "";
  const loggedToolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    ok: boolean;
    errorPreview: string | null;
  }> = [];
  let llmRoundtrips = 0;

  // Tool call loop — up to 3 turns. Most interactions need 1-2.
  for (let i = 0; i < 3; i++) {
    const response = await callGroq(messages);
    llmRoundtrips += 1;

    // If the model gave us a final text reply (no tool calls), we're done.
    if (!response.tool_calls.length) {
      finalReply = response.content ?? "";
      break;
    }

    messages.push({
      role: "assistant",
      content: response.content ?? "",
      tool_calls: response.tool_calls,
    });

    for (const call of response.tool_calls) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(call.function.arguments || "{}");
      } catch {
        parsedArgs = {};
      }

      // Tool execution can throw (Prisma findFirstOrThrow, Groq sub-call,
      // etc.). Catch and feed the error back to the model as the tool
      // result so it can recover with another tool call or a graceful
      // explanation — without the catch, one bad model hallucination
      // (wrong item_id, etc.) would crash the entire bot turn and
      // leave the user staring at a silent chat.
      let result: ToolResult;
      let toolError: string | null = null;
      try {
        result = await executeTool(call.function.name, parsedArgs, ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toolError = message.slice(0, 200);
        result = {
          content: `ERROR running ${call.function.name}: ${message.slice(0, 200)}. Try a different approach or ask the user for clarification.`,
        };
      }
      loggedToolCalls.push({
        name: call.function.name,
        args: redactSensitiveArgs(parsedArgs),
        ok: toolError == null,
        errorPreview: toolError,
      });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: result.content,
      });

      // Capture PO identity from tools that create orders so the outer
      // channel can attach inline approve / cancel buttons on the reply.
      if (result.purchaseOrderId) purchaseOrderId = result.purchaseOrderId;
      if (result.orderNumber) orderNumber = result.orderNumber;

      // If the tool kicked off a workflow (ADD_ITEM, ADD_SUPPLIER), return its
      // reply immediately — the workflow engine will handle subsequent turns.
      if (result.workflowStarted && result.finalReply) {
        return {
          ok: true,
          reply: result.finalReply,
          replyScenario: "agent_workflow_started",
          purchaseOrderId,
          orderNumber,
        };
      }
    }
  }

  if (!finalReply) {
    finalReply =
      "I tried a few things but couldn't work out what to do next. Can you rephrase?";
  }

  // Final safety pass: strip tool names, empty placeholders, narration.
  finalReply = sanitiseReply(
    finalReply,
    "Let me know what you want to do — check stock, reorder something, or change a par."
  );

  // Telemetry: one row per LLM turn with the specifics needed to
  // debug misbehaviour ("why did the bot draft the wrong milk?").
  // Best-effort — never let a logging failure break the bot.
  const telemetryDetails: Prisma.InputJsonValue = {
    channel: ctx.channel,
    senderId: ctx.senderId,
    userMessage: lastUserMsg.slice(0, 500),
    toolCalls: loggedToolCalls.slice(0, 10) as unknown as Prisma.InputJsonValue,
    roundtrips: llmRoundtrips,
    latencyMs: Date.now() - turnStartedAt,
    finalReplyPreview: finalReply.slice(0, 200),
    purchaseOrderId: purchaseOrderId ?? null,
    orderNumber: orderNumber ?? null,
  };
  void db.auditLog
    .create({
      data: {
        locationId: ctx.locationId,
        userId: ctx.userId,
        action: "bot.llm_turn",
        entityType: "botChannel",
        entityId: ctx.sourceMessageId ?? `${ctx.channel.toLowerCase()}-turn`,
        details: telemetryDetails,
      },
    })
    .catch(() => null);

  return {
    ok: true,
    purchaseOrderId,
    orderNumber,
    reply: finalReply,
    replyScenario: "agent",
  };
}

/**
 * Strip anything from tool-call args that shouldn't end up in a
 * telemetry row. Passwords, tokens, long text pastes — we keep the
 * shape for debuggability but blank out the bytes.
 */
function redactSensitiveArgs(
  args: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    const key = k.toLowerCase();
    if (/password|token|secret|cookie|credential/.test(key)) {
      out[k] = "***redacted***";
      continue;
    }
    if (typeof v === "string" && v.length > 300) {
      out[k] = v.slice(0, 300) + "…";
      continue;
    }
    out[k] = v;
  }
  return out;
}
