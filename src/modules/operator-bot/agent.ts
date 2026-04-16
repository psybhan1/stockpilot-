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

export type AgentContext = {
  locationId: string;
  userId: string;
  channel: ManagerBotChannel;
  senderId: string;
  sourceMessageId: string | null;
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
};

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
            type: "number",
            description:
              "Current on-hand quantity the user reported, in display units (e.g. '2' if they said '2 left'). 0 if unknown / not mentioned.",
          },
          requested_quantity: {
            type: "number",
            description:
              "OPTIONAL. The exact amount the user wants to ORDER (not what's left). Use the number they spoke, e.g. 12 for 'order 12 oz', 5 for '5 bags'. Omit if the user didn't specify an order quantity.",
          },
          requested_unit: {
            type: "string",
            description:
              "OPTIONAL. The unit the user used for requested_quantity. Free text — 'oz', 'lb', 'kg', 'g', 'ml', 'l', 'bag', 'case', 'each', etc. Pass exactly what they said. Required if requested_quantity is set.",
          },
        },
        required: ["item_id", "current_quantity"],
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
          new_count: { type: "number", description: "New on-hand count in the item's base unit." },
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
            type: "number",
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
        "FAST PATH: Create a new inventory item with sensible defaults AND immediately draft a purchase order for it — all in one call, no questionnaire. Use when the user says 'order this', 'add this to my cart', 'we need this' + a product name/link, and the item does NOT already exist in LIVE DATA. This skips the multi-step add-item wizard entirely.\n\nDo NOT use start_add_item_flow when the user's intent is to ORDER something — use this instead.",
      parameters: {
        type: "object",
        properties: {
          item_name: {
            type: "string",
            description: "Product name (e.g. 'Espresso Machine Cleaner', 'Urnex Cafiza'). Extract from the URL preview or user's message.",
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
            description: "Supplier name (e.g. 'Amazon', 'Costco'). If user pasted a URL, use the site name. If no supplier mentioned, pass empty string.",
          },
          website_url: {
            type: "string",
            description: "Product URL if the user pasted one. Empty string if not.",
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

async function executeTool(
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
      const itemName = String(args.item_name ?? "").trim();
      const category = String(args.category ?? "SUPPLY").toUpperCase();
      const quantity = Math.max(1, Number(args.quantity ?? 1));
      const supplierName = String(args.supplier_name ?? "").trim();
      const websiteUrl = String(args.website_url ?? "").trim();
      if (!itemName) return { content: "ERROR: item_name required." };

      try {
        // 1. Create the item with sensible defaults.
        const sku = `QA-${Date.now().toString(36).toUpperCase()}`;
        const newItem = await db.inventoryItem.create({
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
          },
        });

        // 2. Create/find supplier if provided.
        let supplierId: string | null = null;
        if (supplierName) {
          const existing = await db.supplier.findFirst({
            where: {
              locationId: ctx.locationId,
              name: { equals: supplierName, mode: "insensitive" },
            },
            select: { id: true },
          });
          if (existing) {
            supplierId = existing.id;
          } else {
            const created = await db.supplier.create({
              data: {
                locationId: ctx.locationId,
                name: supplierName,
                orderingMode: websiteUrl ? "WEBSITE" : "MANUAL",
                website: websiteUrl || null,
                leadTimeDays: 3,
              },
            });
            supplierId = created.id;
          }
          // Link supplier to item.
          await db.supplierItem.create({
            data: {
              supplierId,
              inventoryItemId: newItem.id,
              packSizeBase: 1,
              minimumOrderQuantity: 1,
              preferred: true,
            },
          });
          await db.inventoryItem.update({
            where: { id: newItem.id },
            data: { primarySupplierId: supplierId },
          });
        }

        // 3. Create the PO.
        const orderNumber = `PO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
        const po = await db.purchaseOrder.create({
          data: {
            locationId: ctx.locationId,
            supplierId: supplierId ?? undefined!,
            orderNumber,
            status: supplierId ? "AWAITING_APPROVAL" : "DRAFT",
            totalLines: 1,
            placedById: ctx.userId,
            notes: websiteUrl ? `Product URL: ${websiteUrl}` : undefined,
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
          },
        });

        const supplierLabel = supplierName || "no supplier yet";
        const websiteNote = websiteUrl ? " I'll head to their website to add it to the cart once you approve." : "";
        const reply = supplierId
          ? `✅ Added *${itemName}* to inventory + drafted *${orderNumber}* for ${quantity} from *${supplierLabel}*.${websiteNote} Tap Approve to send.`
          : `✅ Added *${itemName}* to inventory + created draft *${orderNumber}* for ${quantity}. No supplier linked yet — add one in Settings or tell me who supplies it.`;

        return {
          content: reply,
          finalReply: reply,
          purchaseOrderId: supplierId ? po.id : null,
          orderNumber: supplierId ? orderNumber : null,
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

## RULES
1. LIVE DATA below = truth. Every number/unit/name MUST come from there or a tool response.
2. Fuzzy-match items: "grinded coffee"=Ground Coffee, "oat mlk"=Oat Milk, "the syrup"=only syrup in LIVE DATA. If 1 match, use it silently.
3. Honor user's quantity verbatim. "12 oz" → pass 12 oz. Don't round or override.
4. yes/approve/ok/👍 → approve_recent_order. no/cancel/nvm/❌ → cancel_recent_order.
5. URL + "add to cart"/"order this" → call quick_add_and_order (NOT start_add_item_flow). Never ask "what's it for?" on cleaning/packaging supplies.
6. NEVER say tool names, empty placeholders, or "How can I help?". Sound like a colleague.
7. 1-3 sentences max. Don't repeat yourself.

## EXAMPLES
User: "oat milk 2 left" → call place_restock_order, reply: "📋 Drafted PO — 10 L oat milk from FreshCo. Approve?"
User: "order 12 oz grinded coffee" → fuzzy→Ground Coffee, reply: "📋 12 oz Ground Coffee from BeanCo. Approve?"
User: "approve" → call approve_recent_order, reply: "✅ Sent to FreshCo."
User: "add this to my cart https://a.co/..." → call quick_add_and_order with product name from context, reply: "✅ Added + drafted PO. Approve?"
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
// Model: must be on Groq free tier + support tool calling + handle
// our ~4K token system prompt within the TPM limit.
// llama-3.3-70b is the ONLY one that checks all three boxes:
//   - 131K context window (our prompt fits easily)
//   - 6000 RPM free tier (vs 6000 TPM on Qwen3/Scout)
//   - Native tool calling (no text-parsing hacks)
//   - Proven reliable (was the original model before we experimented)
// The improved system prompt is what makes it smarter now, not the model.
// Scout supports tool calling, has its own TPD quota (separate from
// 70b which is burned out), and is the newest Llama 4 model on Groq.
const DEFAULT_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

function isR1Model(model: string): boolean {
  return /deepseek.*r1|r1.*distill/i.test(model);
}

/**
 * Build a text description of all tools for R1 (which doesn't
 * support the native tools API). Injected into the system prompt
 * so R1 knows what tools exist and how to call them.
 */
function buildToolDescriptionText(): string {
  const lines = [
    "## AVAILABLE TOOLS",
    "",
    "When you need to take an action, output a tool call block like this:",
    "```",
    '<tool_call>{"name":"tool_name","arguments":{"arg1":"value"}}</tool_call>',
    "```",
    "I will execute it and give you the result. Then continue your reply.",
    "If you don't need any tool, just reply normally with text.",
    "You can call MULTIPLE tools in one reply if needed — just put each in its own <tool_call> block.",
    "",
  ];
  for (const tool of TOOLS) {
    const fn = tool.function;
    lines.push(`### ${fn.name}`);
    lines.push(fn.description);
    if (fn.parameters && "properties" in fn.parameters) {
      const props = fn.parameters.properties as Record<
        string,
        { type?: string; description?: string }
      >;
      const required = (fn.parameters as { required?: string[] }).required ?? [];
      for (const [key, val] of Object.entries(props)) {
        const req = required.includes(key) ? " (required)" : " (optional)";
        lines.push(`  - ${key}: ${val.type ?? "string"}${req} — ${val.description ?? ""}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Parse <tool_call>...</tool_call> blocks from R1's text output.
 */
function parseTextToolCalls(
  text: string
): GroqToolCall[] {
  const calls: GroqToolCall[] = [];
  const regex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      if (parsed.name) {
        calls.push({
          id: `r1-${Date.now()}-${calls.length}`,
          type: "function",
          function: {
            name: parsed.name,
            arguments: JSON.stringify(parsed.arguments ?? {}),
          },
        });
      }
    } catch {
      // Malformed JSON — skip this call.
    }
  }
  return calls;
}

/**
 * Strip <tool_call> blocks from R1's output to get the user-facing
 * reply text.
 */
function stripToolCallBlocks(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
    .replace(/```[\s\S]*?```/g, "") // also strip code blocks that might wrap tool calls
    .trim();
}

async function callGroq(
  messages: GroqMessage[],
  opts?: { injectToolsAsText?: boolean }
): Promise<{
  content: string | null;
  tool_calls: GroqToolCall[];
}> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");

  const model = process.env.GROQ_BOT_MODEL ?? DEFAULT_MODEL;
  const useR1 = isR1Model(model) || opts?.injectToolsAsText;

  // For R1: no native tools API, higher token limit for reasoning.
  // For Maverick/others: native tools API.
  const bodyPayload: Record<string, unknown> = {
    model,
    temperature: useR1 ? 0.6 : 0.3,
    top_p: 0.95,
    max_tokens: useR1 ? 2048 : 512, // trimmed from 1024→512 to save TPM
    messages,
  };
  if (!useR1) {
    bodyPayload.tools = TOOLS;
    bodyPayload.tool_choice = "auto";
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(bodyPayload),
    signal: AbortSignal.timeout(useR1 ? 45000 : 30000),
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

  if (useR1) {
    // Parse tool calls from R1's text output.
    const rawContent = msg?.content ?? "";
    const textCalls = parseTextToolCalls(rawContent);
    const cleanContent = stripToolCallBlocks(rawContent);
    return {
      content: cleanContent || null,
      tool_calls: textCalls,
    };
  }

  return {
    content: msg?.content ?? null,
    tool_calls: msg?.tool_calls ?? [],
  };
}

// ── Live-data snapshot: grounds every turn in real numbers ──────────────────
// The model used to hallucinate units and stock levels because it had nothing
// authoritative in its prompt. We now inject a compact snapshot of (a) all
// inventory with stock/par/supplier, (b) the most recent AWAITING_APPROVAL
// or recently-sent PO so "approve" / "cancel" questions have a target.
async function buildLiveDataBlock(ctx: AgentContext): Promise<string> {
  const [items, recentOrder] = await Promise.all([
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
          take: 1,
        },
      },
      orderBy: { name: "asc" },
      take: 30, // reduced from 60 to save Groq tokens
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
  ]);

  const suppliers = await db.supplier.findMany({
    where: { locationId: ctx.locationId },
    select: { id: true, name: true, email: true, orderingMode: true },
    orderBy: { name: "asc" },
    take: 30,
  });

  const itemLines = items.map((i) => {
    const supplier =
      i.primarySupplier?.name ??
      i.supplierItems[0]?.supplier.name ??
      "NO_SUPPLIER";
    const unit = i.baseUnit === "GRAM" ? "g" : i.baseUnit === "MILLILITER" ? "ml" : "count";
    return `- id=${i.id} name="${i.name}" on_hand=${i.stockOnHandBase}${unit} par=${i.parLevelBase}${unit} supplier="${supplier}"`;
  });

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
    "INVENTORY:",
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

function sanitiseReply(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  let text = raw;

  // DeepSeek R1 wraps its internal reasoning in <think>…</think> tags.
  // Strip those so the user only sees the final answer.
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // Sometimes the closing tag is missing; strip from <think> to the
  // first blank line or end of text as a fallback.
  if (/<think>/i.test(text)) {
    text = text.replace(/<think>[\s\S]*/i, "").trim();
  }

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
  const model = process.env.GROQ_BOT_MODEL ?? DEFAULT_MODEL;
  const useR1 = isR1Model(model);

  // For R1: inject tool definitions as text in the system prompt
  // (since R1 doesn't support the native tools API).
  const toolBlock = useR1 ? `\n\n${buildToolDescriptionText()}` : "";
  const systemPrompt = `${SYSTEM_PROMPT_BASE}\n\n${liveData}${toolBlock}`;

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

  // Tool call loop — up to 3 turns (reduced from 5 to save Groq
  // tokens; most interactions need 1-2 tool calls).
  for (let i = 0; i < 3; i++) {
    const response = await callGroq(messages, { injectToolsAsText: useR1 });

    // If the model gave us a final text reply (no tool calls), we're done.
    if (!response.tool_calls.length) {
      finalReply = response.content ?? "";
      break;
    }

    // Otherwise append the assistant turn and execute each tool.
    messages.push({
      role: "assistant",
      content: response.content ?? "",
      ...(useR1 ? {} : { tool_calls: response.tool_calls }),
    });

    const toolResults: string[] = [];
    for (const call of response.tool_calls) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(call.function.arguments || "{}");
      } catch {
        parsedArgs = {};
      }
      const result = await executeTool(call.function.name, parsedArgs, ctx);

      if (useR1) {
        // For R1: feed tool results back as a user message (R1
        // doesn't understand the "tool" role).
        toolResults.push(
          `Tool ${call.function.name} returned: ${result.content}`
        );
      } else {
        // For Maverick: use the native tool response format.
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: result.content,
        });
      }

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

    // For R1: batch all tool results into one user message.
    if (useR1 && toolResults.length > 0) {
      messages.push({
        role: "user",
        content: `[Tool results]\n${toolResults.join("\n")}\n\nNow give your final reply to the user. Do NOT output any more <tool_call> blocks unless you need another tool.`,
      });
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

  return {
    ok: true,
    purchaseOrderId,
    orderNumber,
    reply: finalReply,
    replyScenario: "agent",
  };
}
