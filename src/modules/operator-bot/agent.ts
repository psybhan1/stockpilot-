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
        "Create a purchase order (PO) for an item. The system computes quantity from par level automatically. Use when the user asks to order/reorder/restock something AND a supplier is linked. If no supplier is linked, tell the user and offer to link one — do NOT call this tool.",
      parameters: {
        type: "object",
        properties: {
          item_id: { type: "string", description: "Inventory item id (from list_inventory)." },
          current_quantity: {
            type: "number",
            description:
              "Current on-hand quantity the user reported, in display units (e.g. '2' if they said '2 left'). If unknown, pass 0.",
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
      if (!itemId) return { content: "ERROR: item_id required." };
      const result = await createRestockOrderFromBotMessage({
        locationId: ctx.locationId,
        userId: ctx.userId,
        channel: ctx.channel,
        inventoryItemId: itemId,
        reportedOnHandDisplay: current,
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
const SYSTEM_PROMPT = `You are StockBuddy, an AI inventory assistant that talks to restaurant and cafe managers via WhatsApp and Telegram. You are warm, direct, and fast. Reply in at most 3 short sentences unless listing items.

Rules:
- You have real tools that read and mutate the inventory DB. USE them — do not guess, do not pretend. When the user asks what they have, call list_inventory. When they ask to order, call place_restock_order. When they correct stock, call update_stock_count.
- Do NOT claim an action succeeded unless a tool returned a success message for it. If you didn't call a tool, you didn't do anything.
- Before ordering or updating stock, you MUST call list_inventory first to get the real item id.
- If the user wants to order an item that has no linked supplier, say so and offer to link an existing supplier or add a new one. Do not call place_restock_order without a supplier.
- If the user wants to add a new item or new supplier, call the corresponding start_* tool — it kicks off a structured multi-turn flow that collects the details.
- If the user just chats ("hi", "how are you", "thanks"), reply naturally in one sentence. Don't spam tools for greetings.
- Never repeat your previous message verbatim. If you already said it, say something different or ask a specific follow-up.
- Use short, human phrasing. No bullet lists unless presenting multiple items/suppliers.
- Never invent item names, quantities, or PO numbers — only use values returned by tools.
- When the user's last message looks like a YES reply to a pending order — 'approve', 'yes', 'yes send it', 'confirm', 'go ahead', 'send', 'ok send' — call approve_recent_order. Don't ask which order; the tool finds the most recent pending one.
- When the user's last message looks like a NO / abort — 'cancel', 'no', 'no don't send', 'scrap that', 'nvm', 'nevermind' — call cancel_recent_order.
- If the user says just 'retry' and the previous exchange mentioned a failed dispatch, call approve_recent_order (it handles re-dispatch).`;

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

async function callGroq(messages: GroqMessage[]): Promise<{
  content: string | null;
  tool_calls: GroqToolCall[];
}> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_BOT_MODEL ?? "llama-3.3-70b-versatile",
      temperature: 0.3,
      max_tokens: 600,
      tools: TOOLS,
      tool_choice: "auto",
      messages,
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

// ── Public entry point ────────────────────────────────────────────────────────
export async function runBotAgent(ctx: AgentContext): Promise<BotHandlingResult> {
  const messages: GroqMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...ctx.conversation.map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
  ];

  let finalReply: string | null = null;
  let purchaseOrderId: string | null = null;
  let orderNumber: string | null = null;

  // Tool call loop — up to 5 turns. Each loop: ask the model, run tools, append results.
  for (let i = 0; i < 5; i++) {
    const response = await callGroq(messages);

    // If the model gave us a final text reply (no tool calls), we're done.
    if (!response.tool_calls.length) {
      finalReply = response.content ?? "";
      break;
    }

    // Otherwise append the assistant turn and execute each tool.
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
      const result = await executeTool(call.function.name, parsedArgs, ctx);
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

  return {
    ok: true,
    purchaseOrderId,
    orderNumber,
    reply: finalReply,
    replyScenario: "agent",
  };
}
