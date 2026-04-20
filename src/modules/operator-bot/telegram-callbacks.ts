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

import { PurchaseOrderStatus, SupplierOrderingMode, type Prisma } from "@/lib/prisma";
import { botTelemetry } from "@/lib/bot-telemetry";
import { db } from "@/lib/db";
import { createAuditLogTx } from "@/lib/audit";
import { canCancelPurchaseOrder } from "@/modules/purchasing/lifecycle";
import { approveAndDispatchPurchaseOrder } from "@/modules/operator-bot/service";
import { describeEmailPathForLocation } from "@/providers/email/provider-status";
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

/**
 * Authorization for Telegram callbacks. The Telegram `chat_id`
 * (senderId) must be paired to a User that has a role at the
 * location owning this PO. Otherwise: reject.
 *
 * Without this check, any paired Telegram account could approve /
 * cancel / mark-delivered any PO in the whole system by guessing
 * or learning a PO id — callback payloads are public strings.
 *
 * Returns { ok: true, locationId, userId } on success, or a
 * CallbackResult to return directly on failure.
 */
async function authorizeCallback(
  purchaseOrderId: string,
  ctx: { chatId: string; senderId?: string; userId?: string | null }
): Promise<
  | { ok: true; locationId: string; userId: string | null; orderNumber: string }
  | { ok: false; result: CallbackResult }
> {
  if (!purchaseOrderId) {
    return {
      ok: false,
      result: { ok: false, toast: "Missing order id", editText: "" },
    };
  }

  const po = await db.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { id: true, locationId: true, orderNumber: true },
  });

  if (!po) {
    return {
      ok: false,
      result: {
        ok: false,
        toast: "Order not found",
        editText: "❌ That order is no longer available.",
        editKeyboard: null,
      },
    };
  }

  // Sender must be (a) a User with telegramChatId matching, AND
  // (b) have a role at the PO's location. Either-or isn't enough:
  // a user paired at location A must not be able to act on location B.
  const chatIdCandidate = ctx.chatId || ctx.senderId || "";
  if (!chatIdCandidate) {
    return {
      ok: false,
      result: {
        ok: false,
        toast: "Not authorized",
        editText: "🔒 This chat isn't linked to StockPilot.",
        editKeyboard: null,
      },
    };
  }

  const authorizedUser = await db.user.findFirst({
    where: {
      telegramChatId: chatIdCandidate,
      roles: { some: { locationId: po.locationId } },
    },
    select: { id: true },
  });

  if (!authorizedUser) {
    // Audit the attempt so operators can see if this is abuse.
    await db.auditLog
      .create({
        data: {
          locationId: po.locationId,
          action: "bot.callback_unauthorized",
          entityType: "purchaseOrder",
          entityId: po.id,
          details: {
            chatId: chatIdCandidate,
            senderId: ctx.senderId ?? null,
            orderNumber: po.orderNumber,
          },
        },
      })
      .catch(() => null);
    return {
      ok: false,
      result: {
        ok: false,
        toast: "Not your order",
        editText:
          "🔒 This Telegram account isn't linked to the location that owns this order. " +
          "Ask the location's manager to link you first.",
        editKeyboard: null,
      },
    };
  }

  return {
    ok: true,
    locationId: po.locationId,
    userId: ctx.userId ?? authorizedUser.id,
    orderNumber: po.orderNumber,
  };
}

export async function handleTelegramCallback(
  data: string,
  ctx: { chatId: string; senderId: string; userId?: string | null }
): Promise<CallbackResult> {
  const [action, ...rest] = data.split(":");
  const resourceId = rest.join(":");
  const stop = botTelemetry.start(`telegram.callback.${action}`, {
    purchaseOrderId: resourceId,
    senderId: ctx.senderId,
  });

  try {
    let result: CallbackResult;
    switch (action) {
      case "po_approve":
        result = await approvePurchaseOrderFromBot(resourceId, ctx);
        break;
      case "po_cancel":
        result = await cancelPurchaseOrderFromBot(resourceId, ctx);
        break;
      case "po_retry":
        result = await retryPurchaseOrderFromBot(resourceId, ctx);
        break;
      case "po_rescue":
        result = await rescuePurchaseOrderFromBot(resourceId, ctx);
        break;
      case "po_delivered":
        result = await markDeliveredFromBot(resourceId, ctx);
        break;
      case "po_snooze_delivery":
        result = await snoozeDeliveryFromBot(resourceId, ctx);
        break;
      case "website_cart_approve":
        result = await websiteCartApproveFromBot(resourceId, ctx);
        break;
      case "website_cart_cancel":
        result = await websiteCartCancelFromBot(resourceId, ctx);
        break;
      case "noop":
        result = { ok: true, toast: "", editText: "" };
        break;
      default:
        result = { ok: false, toast: "Unknown action", editText: "" };
    }
    stop({ ok: result.ok, toast: result.toast });
    return result;
  } catch (err) {
    botTelemetry.error(`telegram.callback.${action}`, err, {
      purchaseOrderId: resourceId,
    });
    return {
      ok: false,
      toast: "Something went wrong",
      editText: "⚠ Something went wrong. Try again in a moment.",
    };
  }
}

// ── Approve & dispatch ────────────────────────────────────────────────

async function approvePurchaseOrderFromBot(
  purchaseOrderId: string,
  ctx: { chatId: string; senderId?: string; userId?: string | null }
): Promise<CallbackResult> {
  const auth = await authorizeCallback(purchaseOrderId, ctx);
  if (!auth.ok) return auth.result;

  const result = await approveAndDispatchPurchaseOrder({
    purchaseOrderId,
    userId: auth.userId,
  });

  if (result.status === PurchaseOrderStatus.SENT) {
    // Was dispatch actually performed, or did the console/mock email
    // provider just simulate it? Check the location's actual email
    // path — Gmail-connected locations count as real, otherwise fall
    // back to global Resend config.
    const supplierOrderingMode = result.supplierOrderingMode;

    if (supplierOrderingMode === SupplierOrderingMode.EMAIL) {
      const path = await describeEmailPathForLocation(result.locationId);
      if (path.kind === "none") {
        return {
          ok: true,
          toast: "Approved (test mode)",
          editText:
            `✅ *${result.orderNumber}* approved.\n\n` +
            `⚠ *No email provider:* *${result.supplierName}* did not receive a real order. ` +
            `Go to *Settings → Channels → Gmail* and connect your Gmail account to send real supplier emails for free.`,
          editKeyboard: null,
        };
      }
      if (path.kind === "gmail") {
        return {
          ok: true,
          toast: "Sent to supplier",
          editText: `✅ *${result.orderNumber}* sent to *${result.supplierName}* from *${path.from}*.`,
          editKeyboard: null,
        };
      }
      return {
        ok: true,
        toast: "Sent to supplier",
        editText: `✅ *${result.orderNumber}* approved and sent to *${result.supplierName}*.`,
        editKeyboard: null,
      };
    }

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
  ctx: { chatId: string; senderId?: string; userId?: string | null }
): Promise<CallbackResult> {
  const auth = await authorizeCallback(purchaseOrderId, ctx);
  if (!auth.ok) return auth.result;

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
      userId: auth.userId,
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

// ── Rescue from alternate supplier ───────────────────────────────────

async function rescuePurchaseOrderFromBot(
  failedPurchaseOrderId: string,
  ctx: { chatId: string; senderId?: string; userId?: string | null }
): Promise<CallbackResult> {
  const auth = await authorizeCallback(failedPurchaseOrderId, ctx);
  if (!auth.ok) return auth.result;

  const { createRescuePurchaseOrder } = await import(
    "@/modules/purchasing/rescue"
  );
  const result = await createRescuePurchaseOrder(
    failedPurchaseOrderId,
    auth.userId
  );

  if (!result.ok) {
    return {
      ok: false,
      toast: "Couldn't rescue",
      editText: `⚠ Couldn't auto-reorder: ${result.reason}`,
      editKeyboard: null,
    };
  }

  if (result.dispatchStatus === PurchaseOrderStatus.SENT) {
    return {
      ok: true,
      toast: "Rescued ✓",
      editText:
        `✅ Rescue order *${result.newOrderNumber}* sent to *${result.alternateSupplierName}*.\n\n` +
        `You'll get a ping when they respond — same pipeline as any other order.`,
      editKeyboard: null,
    };
  }

  if (result.dispatchStatus === PurchaseOrderStatus.FAILED) {
    return {
      ok: false,
      toast: "Rescue dispatch failed",
      editText:
        `⚠ Rescue order *${result.newOrderNumber}* was created for *${result.alternateSupplierName}*, ` +
        `but sending to them failed.\n\n` +
        (result.dispatchReason ? `*Reason:* ${result.dispatchReason}\n\n` : "") +
        `Tap *Retry* to try again.`,
      editKeyboard: [
        [
          { text: "🔁 Retry", callback_data: `po_retry:${result.newPurchaseOrderId}` },
          { text: "✖ Cancel", callback_data: `po_cancel:${result.newPurchaseOrderId}` },
        ],
      ],
    };
  }

  return {
    ok: true,
    toast: "Rescue queued",
    editText:
      `📋 Rescue order *${result.newOrderNumber}* for *${result.alternateSupplierName}* is now ` +
      `in status *${result.dispatchStatus.toLowerCase()}*.`,
    editKeyboard: null,
  };
}

// ── Mark delivered (from late-delivery prompt) ───────────────────────

async function markDeliveredFromBot(
  poId: string,
  ctx: { chatId: string; senderId?: string; userId?: string | null }
): Promise<CallbackResult> {
  const auth = await authorizeCallback(poId, ctx);
  if (!auth.ok) return auth.result;
  const po = await db.purchaseOrder.findUnique({
    where: { id: poId },
    select: { id: true, orderNumber: true, status: true, supplier: { select: { name: true } } },
  });
  if (!po) return { ok: false, toast: "Order not found", editText: "Order not found." };
  if (
    po.status === PurchaseOrderStatus.SENT ||
    po.status === PurchaseOrderStatus.ACKNOWLEDGED
  ) {
    await db.purchaseOrder.update({
      where: { id: po.id },
      data: { status: PurchaseOrderStatus.DELIVERED, deliveredAt: new Date() },
    });
  }
  return {
    ok: true,
    toast: "Marked delivered",
    editText: `📦 *${po.orderNumber}* marked as delivered from *${po.supplier?.name ?? "supplier"}*.`,
    editKeyboard: null,
  };
}

async function snoozeDeliveryFromBot(
  poId: string,
  ctx: { chatId: string; senderId?: string; userId?: string | null }
): Promise<CallbackResult> {
  const auth = await authorizeCallback(poId, ctx);
  if (!auth.ok) return auth.result;
  const po = await db.purchaseOrder.findUnique({
    where: { id: poId },
    select: { id: true, orderNumber: true, metadata: true },
  });
  if (!po) return { ok: false, toast: "Order not found", editText: "Order not found." };
  // Clear the lateDeliveryPromptSentAt so we re-nudge tomorrow.
  const meta = (po.metadata ?? {}) as Record<string, unknown>;
  delete meta.lateDeliveryPromptSentAt;
  meta.deliverySnoozedAt = new Date().toISOString();
  await db.purchaseOrder.update({
    where: { id: po.id },
    data: { metadata: meta as Prisma.InputJsonValue },
  });
  return {
    ok: true,
    toast: "Snoozed 24h",
    editText: `⏰ *${po.orderNumber}* snoozed — I'll check back tomorrow.`,
    editKeyboard: null,
  };
}

// ── Website cart approval ────────────────────────────────────────────

async function websiteCartApproveFromBot(
  agentTaskId: string,
  ctx: { chatId: string; senderId?: string; userId?: string | null }
): Promise<CallbackResult> {
  if (!agentTaskId) return { ok: false, toast: "Missing task", editText: "" };
  // Resolve the PO through the task so we can authorize by location.
  const taskPo = await db.agentTask.findUnique({
    where: { id: agentTaskId },
    select: { purchaseOrderId: true },
  });
  if (!taskPo?.purchaseOrderId) {
    return { ok: false, toast: "Not found", editText: "Task not found." };
  }
  const auth = await authorizeCallback(taskPo.purchaseOrderId, ctx);
  if (!auth.ok) return auth.result;
  const task = await db.agentTask.findUnique({
    where: { id: agentTaskId },
    // Pull the line items so we can rebuild the cart links — without
    // ASINs the user has nothing tappable to open and (rightly)
    // complains "where's the cart?".
    select: {
      id: true,
      status: true,
      purchaseOrder: {
        select: {
          id: true,
          orderNumber: true,
          supplier: { select: { name: true, website: true } },
          lines: {
            select: {
              description: true,
              quantityOrdered: true,
              notes: true,
              inventoryItem: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!task?.purchaseOrder) return { ok: false, toast: "Not found", editText: "Task not found." };

  await db.agentTask.update({
    where: { id: agentTaskId },
    data: { status: "COMPLETED" as never },
  });
  await db.purchaseOrder.update({
    where: { id: task.purchaseOrder.id },
    data: { status: PurchaseOrderStatus.ACKNOWLEDGED },
  });

  // Re-derive the cart links so the Approved-state message keeps the
  // tap targets visible. We need to know whether the agent had saved
  // credentials — that determines whether "open cart" actually shows
  // a populated cart, or whether we should instead show per-product
  // buttons for the user to add manually.
  const freshSupplier = await db.supplier.findFirst({
    where: { purchaseOrders: { some: { id: task.purchaseOrder.id } } },
    select: { websiteCredentials: true },
  });
  const { decryptSupplierCredentials } = await import(
    "@/modules/suppliers/website-credentials"
  );
  const hasCredentials = !!decryptSupplierCredentials(freshSupplier?.websiteCredentials);

  const { buildCartLinks } = await import("@/modules/automation/cart-links");
  const { extractLineProductUrl } = await import("@/modules/automation/browser-agent");
  const links = buildCartLinks({
    supplierWebsite: task.purchaseOrder.supplier?.website ?? null,
    supplierName: task.purchaseOrder.supplier?.name ?? "supplier",
    hasCredentials,
    lines: task.purchaseOrder.lines.map((l) => ({
      description: l.description || l.inventoryItem.name,
      quantityOrdered: l.quantityOrdered,
      productUrl: extractLineProductUrl(l.notes),
    })),
  });

  const editKeyboard: InlineKeyboard = [];
  if (links.openCartUrl) {
    editKeyboard.push([{ text: links.openCartLabel, url: links.openCartUrl }]);
  }
  for (const btn of links.productButtons) {
    editKeyboard.push([btn]);
  }

  const supplierName = task.purchaseOrder.supplier?.name ?? "the supplier";
  const itemsList = task.purchaseOrder.lines
    .map((l) => `• ${l.quantityOrdered}× ${l.description || l.inventoryItem.name}`)
    .join("\n");

  const body = hasCredentials
    ? `✓ In your real ${supplierName} cart (saved login). Tap *${links.openCartLabel}* to checkout.`
    : links.openCartUrl
      ? `⚠ Cart built in an anonymous session. Tap *${links.openCartLabel}*; if it's empty, open the product URL you sent and tap Add to Cart in your browser. Save your ${supplierName} login at Settings → Suppliers to skip this next time.`
      : `Couldn't transfer the cart. Open *${supplierName}* and add the items to your own cart.\n\n_Save your ${supplierName} login at Settings → Suppliers and the agent will put items straight into your real cart next time._`;

  return {
    ok: true,
    toast: "Cart approved",
    editText:
      `✅ *${task.purchaseOrder.orderNumber}* cart approved on *${supplierName}*\n\n` +
      `${itemsList}\n\n` +
      `${body}\n\n` +
      `_StockPilot never auto-pays._`,
    editKeyboard: editKeyboard.length > 0 ? editKeyboard : null,
  };
}

async function websiteCartCancelFromBot(
  agentTaskId: string,
  ctx: { chatId: string; senderId?: string; userId?: string | null }
): Promise<CallbackResult> {
  if (!agentTaskId) return { ok: false, toast: "Missing task", editText: "" };
  const taskPo = await db.agentTask.findUnique({
    where: { id: agentTaskId },
    select: { purchaseOrderId: true },
  });
  if (!taskPo?.purchaseOrderId) {
    return { ok: false, toast: "Not found", editText: "Task not found." };
  }
  const auth = await authorizeCallback(taskPo.purchaseOrderId, ctx);
  if (!auth.ok) return auth.result;
  const task = await db.agentTask.findUnique({
    where: { id: agentTaskId },
    select: {
      id: true,
      purchaseOrder: { select: { id: true, orderNumber: true } },
    },
  });
  if (!task) return { ok: false, toast: "Not found", editText: "Task not found." };

  await db.agentTask.update({
    where: { id: agentTaskId },
    data: { status: "FAILED" as never },
  });
  if (task.purchaseOrder) {
    await db.purchaseOrder.update({
      where: { id: task.purchaseOrder.id },
      data: { status: PurchaseOrderStatus.CANCELLED },
    });
  }

  return {
    ok: true,
    toast: "Cancelled",
    editText: `✖ Website order ${task.purchaseOrder?.orderNumber ?? ""} cancelled. Cart was not purchased.`,
    editKeyboard: null,
  };
}
