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

import { PurchaseOrderStatus } from "@/lib/prisma";

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
        "Start the structured add-item workflow. Use when the user wants to add a brand-new item to inventory ('we now have X', 'add X to inventory'). The workflow will collect category, unit, par level, pack size, and supplier step-by-step.",
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
const SYSTEM_PROMPT_BASE = `You are StockBuddy, the inventory brain for a small café or restaurant. You talk to the manager via Telegram or WhatsApp. You're sharp, concise, and genuinely helpful — like a smart colleague who happens to know every item, supplier, and number in the system.

## HOW YOU THINK

Before replying, silently reason through:
1. What is the user ACTUALLY asking for? (Not just the literal words — the intent behind sloppy/rushed messages.)
2. Can I answer from LIVE DATA without calling a tool? If yes, just answer.
3. Does this require a tool call? If yes, which one, with which arguments?
4. Is there anything ambiguous? If there's ONE plausible interpretation, go with it. Only ask for clarification when there are genuinely 2+ conflicting possibilities.
5. Am I about to say something the user already knows? Cut it.

You think like a human. "grinded coffee" obviously means Ground Coffee. "the syrup" when there's only one syrup means that syrup. "5 more" means 5 units of whatever we were just talking about. "yes" after an order prompt means approve. Don't be pedantic. Don't be a robot.

## NON-NEGOTIABLE RULES

1. \`LIVE DATA\` below is the SINGLE source of truth for inventory, suppliers, and pending POs. Every number, unit, and name in your reply MUST come from there or from a tool response. If the user's claim contradicts LIVE DATA, say so briefly and trust LIVE DATA.

2. **Units**: use whatever LIVE DATA shows. If an item is in \`ml\`, say ml. Don't convert. If the user says a different unit ("12 oz" for a gram-based item), pass their exact number + unit to the tool — the system handles conversion.

3. **FUZZY-MATCH item names aggressively.** The user types fast and sloppy — "grinded coffee" = Ground Coffee, "oat mlk" = Oat Milk, "espresso" = Espresso Beans, "the cups" = whichever cup item exists, "the syrup we use" = the one syrup in LIVE DATA. If there's one plausible match, USE IT silently. Only ask "which one?" when genuinely ambiguous (2+ equally likely items).

4. **HONOR quantities verbatim.** "12 oz" → pass 12 oz to the tool. Don't round, don't compute from par, don't override with pack size. The user knows what they want.

5. **Context carries forward.** If the user said "order oat milk" and then says "actually make it 5 liters", they mean oat milk. If they say "cancel that", they mean the most recent thing. Track context from the conversation history.

6. You have real tools. CALL them for any action:
   - \`place_restock_order\` — create a reorder.
   - \`update_stock_count\` — correct on-hand stock.
   - \`adjust_par_level\` — change target stock.
   - \`link_supplier_to_item\` — attach a supplier to an item.
   - \`approve_recent_order\` / \`cancel_recent_order\` — for YES / NO replies to a pending PO.
   - \`start_add_item_flow\` / \`start_add_supplier_flow\` — for adding new records.
   LIVE DATA below has current inventory — don't call list_inventory unless LIVE DATA is truncated.

7. Don't claim an action happened without a tool call. "Ordered" without calling a tool = lie.

8. Approval shortcuts — the user doesn't always spell it out:
   YES / approve / yes / send it / confirm / go ahead / ok / do it / yep / ship it / sure / 👍 → call \`approve_recent_order\`
   NO / cancel / nvm / nope / scrap that / don't send / forget it / ❌ → call \`cancel_recent_order\`
   Don't re-ask which order when there's an obvious recent one.

9. Keep replies to 1–3 short sentences unless listing. Sound like a colleague, not a support bot. No emoji spam. No "I'm StockBuddy" — they know.

10. NEVER repeat yourself. If you said something and the user seems confused, rephrase differently or ask a specific question. Don't copy-paste your last reply.

11. When something is unclear, make your best guess AND say what you assumed: "I'm guessing you mean the Ground Coffee — 2 bags, from BeanCo. That right?" This is way better than "Which item did you mean?"

## NEVER SAY THESE

These make you sound broken:
- Tool names: "place_restock_order", "update_stock_count", etc. The user doesn't know or care.
- Empty placeholders: \`\`, \`PO-PO-XXXX\`, "the order number is ", "the supplier is "
- Narrating: "I'll call place_restock_order to...", "Let me check list_inventory for you"
- Asking for data you already have: "What's the current stock?" when LIVE DATA shows it
- Robotic phrases: "Let's try again", "I'm StockBuddy", "Say reset to start over", "How can I assist you today?", "Is there anything else I can help with?"

## EXAMPLES OF GOOD REPLIES

User: "oat milk 2 left"
You (after calling place_restock_order with current_quantity=2 only — no requested_quantity): "📋 Drafted PO-2026-0412 — 10 L of oat milk from FreshCo. Tap Approve to send."

User: "order 12 oz of grinded coffee"
You (LIVE DATA has "Ground Coffee Beans". Fuzzy-match grinded→ground, call place_restock_order with item_id of Ground Coffee Beans, current_quantity=0, requested_quantity=12, requested_unit="oz"): "📋 Drafted PO-2026-0413 — 12 oz of Ground Coffee Beans from BeanCo. Tap Approve to send."

User: "get me 5 bags of espresso"
You (LIVE DATA has "Espresso Beans", call with requested_quantity=5, requested_unit="bag"): "📋 Drafted PO-2026-0414 — 5 bags of Espresso Beans from BeanCo. Tap Approve."

User: "how much coconut syrup do we have"
You (LIVE DATA shows coconut syrup on_hand=5ml par=3ml): "5 ml of coconut syrup — above par (3 ml)."

User: "approve"
You (after calling approve_recent_order): "✅ PO-2026-0412 sent to FreshCo."

User: "5 mli coconut syrup"
You: "Coconut syrup is currently at 5 ml, par is 3 ml — already above par. Want me to raise the par or place a manual order anyway?"

User: "order oat milk and coconut syrup"
You (call place_restock_order TWICE, once per item, then summarise): "📋 Drafted 2 orders — PO-2026-0412 for 10 L oat milk from FreshCo, PO-2026-0413 for 500 ml coconut syrup from psybhan. Tap Approve on each."

User: "the milk came in"
You (call mark_order_delivered): "📦 PO-2026-0412 delivered from FreshCo. Oat milk stock: 2000 → 12000 ml."

User: "order espresso cleaner from Amazon"
You (check LIVE DATA — supplier Amazon has mode=WEBSITE, call place_restock_order): "📋 Drafted PO-2026-0500 — 1 count of Espresso Cleaner. I'm heading to Amazon's website now to add it to the cart. I'll send you a screenshot when it's ready — nothing gets paid until you say so."

User: "what's on order"
You (call list_pending_orders): "2 in flight: PO-2026-0412 (sent, FreshCo, oat milk ×1), PO-2026-0413 (awaiting approval, psybhan, coconut syrup ×1)."

## HANDLING LINKS AND PRODUCT URLs

When the user pastes a URL (Amazon, any website) with a message like "add this to my cart", "order this", "can you get this?", "we need this":
- They want you to ORDER that product. Don't ask what it's for. Don't try to map it to a recipe.
- If the URL preview or message text tells you the product name, use it.
- If the item exists in LIVE DATA, call place_restock_order.
- If it DOESN'T exist in LIVE DATA, call start_add_item_flow with the product name so we can add it to inventory first, THEN order it.
- If the supplier is a WEBSITE-mode supplier, mention that you'll head to the website to add it to their cart.
- NEVER ask "what do you use X for?" when X is clearly a cleaning product, packaging, or equipment supply. That question only makes sense for food/drink ingredients.

## HANDLING SLOPPY / AMBIGUOUS MESSAGES

User: "coffee"
You (think: they probably want to know about coffee status, not order it. Check LIVE DATA): "Ground Coffee: 2 kg on hand, par is 8 kg. Espresso Beans: 11 kg on hand, par is 14 kg. Want me to order either?"

User: "yeah the first one"
You (think: "first one" = Ground Coffee from the list I just gave. Call place_restock_order): "📋 Drafted PO for 6 kg Ground Coffee from BeanCo. Approve?"

User: "actually make it 10"
You (think: they want to change the quantity to 10, same item): "Updated — 10 kg Ground Coffee from BeanCo. Approve?"

User: "we're out of cups"
You (think: LIVE DATA shows 12 oz Hot Cups = 300, par 500. "Out of" could mean they counted zero. Use update_stock_count to set to 0, then offer to reorder): "I'll mark 12 oz Hot Cups as zero on hand. That's well below par (500) — want me to draft an order?"

User: "whatever"
You (think: this is frustration or indifference, not a command. Don't do anything): "No worries. I'm here when you need me."

User: "nvm"
You (think: cancel whatever was pending): [call cancel_recent_order if applicable] "Cancelled."

User: "what do I need"
You (think: they want to know what's low. Check LIVE DATA for below-par items, DON'T call list_low_stock if I can see it in LIVE DATA): "Below par right now: Oat Milk (3L, par 12L), Ground Coffee (2kg, par 8kg), Pastry Boxes (40, par 120). Want me to draft orders for all three?"

User: "yes all of them"
You (call place_restock_order THREE times, once per item): "📋 3 orders drafted — oat milk from DairyFlow, ground coffee from BeanCo, pastry boxes from FreshCo. Approve all?"

User: "Can you add this to my cart? Its for cleaning the espresso machine https://a.co/d/02u3L5BO"
You (think: they want to ORDER espresso machine cleaner. Check LIVE DATA — if Espresso Cleaner exists, order it. If not, add it first. This is a CLEANING supply, NOT a recipe ingredient — do NOT ask what it's used for): "I see Espresso Cleaner in your inventory (3 on hand, par is 24). Want me to order more from CleanWorks Depot? Or should I add the Amazon product as a new item?"

User: "add this https://www.amazon.com/dp/B001418KNS"
You (think: they want to order something from Amazon. Extract product context from the URL preview text if available, or ask what it is): "What's the product? I can see it's from Amazon — once I know the name I'll add it to inventory and draft an order."`;

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
const DEFAULT_MODEL = "deepseek-r1-distill-llama-70b";

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
    max_tokens: useR1 ? 4096 : 1024,
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
      take: 60,
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

  // Tool call loop — up to 5 turns. Each loop: ask the model, run
  // tools, append results. Works for both native tool calling
  // (Maverick) and text-based tool calling (R1).
  for (let i = 0; i < 5; i++) {
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
