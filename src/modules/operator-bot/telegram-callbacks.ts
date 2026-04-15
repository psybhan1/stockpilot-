/**
 * Handlers for Telegram inline-button callback_query events.
 *
 * Callback payloads are small strings like `po_cancel:<po_id>` or
 * `po_approve:<po_id>`. We parse the action + id, perform the
 * mutation, and return (a) a short toast for answerCallbackQuery and
 * (b) the text to edit the original message to. The caller in
 * src/app/api/bot/telegram/route.ts takes care of actually answering
 * and editing.
 */

import { PurchaseOrderStatus, type Prisma } from "@/lib/prisma";
import { db } from "@/lib/db";
import { createAuditLogTx } from "@/lib/audit";
import { canCancelPurchaseOrder } from "@/modules/purchasing/lifecycle";
import { approveAndDispatchPurchaseOrder } from "@/modules/operator-bot/service";
import type { InlineKeyboard } from "@/lib/telegram-bot";

export type CallbackResult = {
  /** Short confirmation shown as a toast above the button. */
  toast: string;
  /** Replacement text for the original message (edited in place). */
  editText: string;
  /** Replace the inline keyboard on the edited message. Null drops it. */
  editKeyboard?: InlineKeyboard | null;
  ok: boolean;
};

export async function handleTelegramCallback(
  data: string,
  ctx: { chatId: string; senderId: string; userId?: string | null }
): Promise<CallbackResult> {
  const [action, ...rest] = data.split(":");
  const resourceId = rest.join(":");

  switch (action) {
    case "po_approve":
      return approvePurchaseOrderFromBot(resourceId, ctx);
    case "po_cancel":
      return cancelPurchaseOrderFromBot(resourceId, ctx);
    case "po_retry":
      return retryPurchaseOrderFromBot(resourceId, ctx);
    case "noop":
      return { ok: true, toast: "", editText: "" };
    default:
      return {
        ok: false,
        toast: "Unknown action",
        editText: "",
      };
  }
}

// ── Approve & dispatch ────────────────────────────────────────────────

async function approvePurchaseOrderFromBot(
  purchaseOrderId: string,
  ctx: { chatId: string; userId?: string | null }
): Promise<CallbackResult> {
  if (!purchaseOrderId) {
    return { ok: false, toast: "Missing order id", editText: "" };
  }

  const result = await approveAndDispatchPurchaseOrder({
    purchaseOrderId,
    userId: ctx.userId ?? null,
  });

  if (result.status === PurchaseOrderStatus.SENT) {
    return {
      ok: true,
      toast: "Sent to supplier",
      editText: `✅ *${result.orderNumber}* approved and sent to *${result.supplierName}*.`,
      editKeyboard: null,
    };
  }

  if (result.status === PurchaseOrderStatus.APPROVED) {
    // Mode like WEBSITE or MANUAL — approved but still needs a human step.
    return {
      ok: true,
      toast: "Approved",
      editText: `✅ *${result.orderNumber}* approved — *${result.supplierName}* has a manual / website ordering mode, so a task was created for it.`,
      editKeyboard: null,
    };
  }

  if (result.status === PurchaseOrderStatus.CANCELLED) {
    return {
      ok: false,
      toast: "Cancelled",
      editText: `✖ *${result.orderNumber}* was cancelled and can't be approved.`,
      editKeyboard: null,
    };
  }

  if (result.status === PurchaseOrderStatus.FAILED) {
    return {
      ok: false,
      toast: "Dispatch failed",
      editText:
        `⚠ *${result.orderNumber}* approved, but the dispatch to *${result.supplierName}* failed.\n\n` +
        (result.reason ? `*Reason:* ${result.reason}\n\n` : "") +
        `Tap *Retry* to try again.`,
      editKeyboard: [
        [
          { text: "🔁 Retry", callback_data: `po_retry:${purchaseOrderId}` },
          { text: "✖ Cancel", callback_data: `po_cancel:${purchaseOrderId}` },
        ],
      ],
    };
  }

  return {
    ok: false,
    toast: "Unexpected state",
    editText: `*${result.orderNumber}* is now in \`${result.status.toLowerCase()}\`.`,
    editKeyboard: null,
  };
}

// ── Retry dispatch ────────────────────────────────────────────────────

async function retryPurchaseOrderFromBot(
  purchaseOrderId: string,
  ctx: { chatId: string; userId?: string | null }
): Promise<CallbackResult> {
  // Retry just re-runs the approve+dispatch path — approveAndDispatch
  // handles the APPROVED+FAILED → re-dispatch transition for us.
  return approvePurchaseOrderFromBot(purchaseOrderId, ctx);
}

// ── Cancel ────────────────────────────────────────────────────────────

async function cancelPurchaseOrderFromBot(
  purchaseOrderId: string,
  ctx: { chatId: string; userId?: string | null }
): Promise<CallbackResult> {
  if (!purchaseOrderId) {
    return { ok: false, toast: "Missing order id", editText: "" };
  }

  const po = await db.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      id: true,
      status: true,
      orderNumber: true,
      locationId: true,
      supplier: { select: { name: true } },
    },
  });

  if (!po) {
    return {
      ok: false,
      toast: "Order not found",
      editText: "❌ That order is no longer available.",
      editKeyboard: null,
    };
  }

  if (po.status === PurchaseOrderStatus.CANCELLED) {
    return {
      ok: true,
      toast: "Already cancelled",
      editText: `✖ *${po.orderNumber}* was already cancelled.`,
      editKeyboard: null,
    };
  }

  if (!canCancelPurchaseOrder(po.status)) {
    return {
      ok: false,
      toast: "Too late to cancel",
      editText: `This order is already in *${po.status.toLowerCase()}* status and can't be cancelled from here.`,
      editKeyboard: null,
    };
  }

  await db.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: PurchaseOrderStatus.CANCELLED },
    });
    await createAuditLogTx(tx, {
      locationId: po.locationId,
      userId: ctx.userId ?? null,
      action: "purchase_order.cancelled_via_bot",
      entityType: "purchaseOrder",
      entityId: po.id,
      details: {
        from: "telegram-callback",
        orderNumber: po.orderNumber,
      } satisfies Prisma.InputJsonValue,
    });
  });

  return {
    ok: true,
    toast: "Cancelled",
    editText: `✖ *${po.orderNumber}* cancelled.\nNothing was sent to ${po.supplier?.name ?? "the supplier"}.`,
    editKeyboard: null,
  };
}
