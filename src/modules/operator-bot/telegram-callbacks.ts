/**
 * Handlers for Telegram inline-button callback_query events.
 *
 * Callback payloads are small strings like `po_cancel:<po_id>` or
 * `po_approve:<po_id>`. We parse the action + id, perform the mutation,
 * and return the text to edit the original message to. The caller
 * (src/app/api/bot/telegram/route.ts) takes care of answerCallbackQuery
 * + editMessageText.
 */

import {
  PurchaseOrderStatus,
  type Prisma,
} from "@/lib/prisma";
import { db } from "@/lib/db";
import { createAuditLogTx } from "@/lib/audit";
import { canCancelPurchaseOrder } from "@/modules/purchasing/lifecycle";

export type CallbackResult = {
  /** Short confirmation shown as a toast above the button. */
  toast: string;
  /** Replacement text for the original message (edited in place). */
  editText: string;
  /** If true, drop the inline keyboard from the edited message. */
  clearKeyboard?: boolean;
  ok: boolean;
};

export async function handleTelegramCallback(
  data: string,
  ctx: { chatId: string; senderId: string; userId?: string | null }
): Promise<CallbackResult> {
  const [action, ...rest] = data.split(":");
  const resourceId = rest.join(":");

  switch (action) {
    case "po_cancel":
      return cancelPurchaseOrderFromBot(resourceId, ctx);
    case "po_approve":
      return approvePurchaseOrderFromBot(resourceId, ctx);
    case "noop":
      return { ok: true, toast: "", editText: "", clearKeyboard: false };
    default:
      return {
        ok: false,
        toast: "Unknown action",
        editText: "",
      };
  }
}

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
      clearKeyboard: true,
    };
  }

  if (po.status === PurchaseOrderStatus.CANCELLED) {
    return {
      ok: true,
      toast: "Already cancelled",
      editText: `✖ *${po.orderNumber}* was already cancelled.`,
      clearKeyboard: true,
    };
  }

  if (!canCancelPurchaseOrder(po.status)) {
    return {
      ok: false,
      toast: "Too late to cancel",
      editText: `This order is already in *${po.status.toLowerCase()}* status and can't be cancelled from here.`,
      clearKeyboard: true,
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
    clearKeyboard: true,
  };
}

async function approvePurchaseOrderFromBot(
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
      clearKeyboard: true,
    };
  }

  if (
    po.status !== PurchaseOrderStatus.DRAFT &&
    po.status !== PurchaseOrderStatus.AWAITING_APPROVAL
  ) {
    return {
      ok: true,
      toast: `Already ${po.status.toLowerCase()}`,
      editText: `*${po.orderNumber}* is already *${po.status.toLowerCase()}*.`,
      clearKeyboard: true,
    };
  }

  await db.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: PurchaseOrderStatus.APPROVED,
        approvedAt: new Date(),
        approvedById: ctx.userId ?? undefined,
      },
    });
    await createAuditLogTx(tx, {
      locationId: po.locationId,
      userId: ctx.userId ?? null,
      action: "purchase_order.approved_via_bot",
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
    toast: "Approved",
    editText: `✅ *${po.orderNumber}* approved.\nSending to ${po.supplier?.name ?? "the supplier"} now…`,
    clearKeyboard: true,
  };
}
