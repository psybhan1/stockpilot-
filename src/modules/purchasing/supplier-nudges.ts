/**
 * Periodic "something should have happened by now" worker.
 *
 * Two heuristics:
 *
 *   A) Stuck-reply nudge.
 *      A PO is SENT, >24h ago, and we have no INBOUND reply yet.
 *      We send ONE polite follow-up email from the same Gmail
 *      thread, then mark the comm's metadata.nudgeSentAt so we
 *      don't do it twice.
 *
 *   B) Late-delivery prompt.
 *      A PO is SENT or ACKNOWLEDGED, the supplier's leadTimeDays
 *      has already elapsed since `sentAt`, and the manager hasn't
 *      marked it delivered. We Telegram-ping them with inline
 *      buttons to mark delivered or snooze. Only once per PO.
 *
 * Runs from the in-process worker loop — same cadence as the
 * supplier-reply poller.
 */

import {
  CommunicationDirection,
  CommunicationStatus,
  PurchaseOrderStatus,
  SupplierOrderingMode,
  type Prisma,
} from "@/lib/prisma";
import { db } from "@/lib/db";
import { botTelemetry } from "@/lib/bot-telemetry";
import { sendTelegramMessage } from "@/lib/telegram-bot";
import { GmailEmailProvider } from "@/providers/email/gmail-email";
import {
  buildLateDeliveryKeyboard,
  buildLateDeliveryMessage,
  buildStuckReplyBusinessLine,
  buildStuckReplyGreeting,
  buildStuckReplyHtmlBody,
  buildStuckReplySubject,
  buildStuckReplyTextBody,
  computeStuckReplyCutoff,
  isLateDeliveryPromptAlreadySent,
  isLateDeliveryReady,
  isReplyNudgeAlreadySent,
  markLateDeliveryPromptSent,
  markReplyNudgeSent,
} from "./supplier-nudges-primitives";

export type NudgeResult = {
  stuckReplyNudgesSent: number;
  lateDeliveryPromptsSent: number;
};

export async function runSupplierNudges(): Promise<NudgeResult> {
  const stop = botTelemetry.start("supplier-nudges.run");
  let stuckReplyNudgesSent = 0;
  let lateDeliveryPromptsSent = 0;

  try {
    stuckReplyNudgesSent = await sendStuckReplyNudges();
    lateDeliveryPromptsSent = await sendLateDeliveryPrompts();
  } catch (err) {
    botTelemetry.error("supplier-nudges.run", err);
  } finally {
    stop({ stuckReplyNudgesSent, lateDeliveryPromptsSent });
  }

  return { stuckReplyNudgesSent, lateDeliveryPromptsSent };
}

async function sendStuckReplyNudges(): Promise<number> {
  const cutoff = computeStuckReplyCutoff(new Date());
  // Candidate outbound comms: SENT POs, created before the cutoff,
  // whose metadata doesn't already carry nudgeSentAt.
  const candidates = await db.supplierCommunication.findMany({
    where: {
      direction: CommunicationDirection.OUTBOUND,
      channel: SupplierOrderingMode.EMAIL,
      createdAt: { lt: cutoff },
      purchaseOrder: { status: PurchaseOrderStatus.SENT },
    },
    take: 20,
    select: {
      id: true,
      supplierId: true,
      metadata: true,
      body: true,
      subject: true,
      supplier: { select: { name: true, email: true, contactName: true } },
      purchaseOrder: {
        select: {
          id: true,
          orderNumber: true,
          locationId: true,
          location: { select: { business: { select: { name: true } }, name: true } },
          communications: {
            where: { direction: CommunicationDirection.INBOUND },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });

  let count = 0;
  for (const comm of candidates) {
    const meta = (comm.metadata ?? {}) as Record<string, unknown>;
    if (isReplyNudgeAlreadySent(meta)) continue;
    if (!comm.purchaseOrder) continue;
    if (comm.purchaseOrder.communications.length > 0) continue; // they replied
    const recipient = comm.supplier.email;
    if (!recipient) continue;

    const subject = buildStuckReplySubject({
      originalSubject: comm.subject,
      orderNumber: comm.purchaseOrder.orderNumber,
    });
    const greeting = buildStuckReplyGreeting({
      contactName: comm.supplier.contactName,
      supplierName: comm.supplier.name,
    });
    const businessLine = buildStuckReplyBusinessLine({
      businessName: comm.purchaseOrder.location?.business?.name,
      locationName: comm.purchaseOrder.location?.name,
    });
    const text = buildStuckReplyTextBody({
      greeting,
      orderNumber: comm.purchaseOrder.orderNumber,
      businessLine,
    });
    const html = buildStuckReplyHtmlBody({
      greeting,
      orderNumber: comm.purchaseOrder.orderNumber,
      businessLine,
    });

    try {
      const { buildSupplierReplyAddress } = await import(
        "@/modules/purchasing/reply-address"
      );
      const provider = new GmailEmailProvider(comm.purchaseOrder.locationId);
      const sent = await provider.sendApprovedOrder({
        recipient,
        subject,
        body: text,
        html,
        replyTo:
          buildSupplierReplyAddress(comm.purchaseOrder.id) ?? undefined,
      });
      const now = new Date();
      await db.supplierCommunication.create({
        data: {
          supplierId: comm.supplierId,
          purchaseOrderId: comm.purchaseOrder.id,
          channel: SupplierOrderingMode.EMAIL,
          direction: CommunicationDirection.OUTBOUND,
          subject,
          body: text,
          status: CommunicationStatus.SENT,
          providerMessageId: sent.providerMessageId ?? null,
          metadata: {
            source: "stuck_reply_nudge",
            originalCommId: comm.id,
            ...(sent.metadata ?? {}),
          } satisfies Prisma.InputJsonValue,
          sentAt: now,
        },
      });
      await db.supplierCommunication.update({
        where: { id: comm.id },
        data: {
          metadata: markReplyNudgeSent(meta, now) as Prisma.InputJsonObject,
        },
      });
      count += 1;
      botTelemetry.event("supplier-nudges.stuck_reply_sent", {
        orderNumber: comm.purchaseOrder.orderNumber,
      });
    } catch (err) {
      botTelemetry.error("supplier-nudges.stuck_reply_send", err, {
        orderNumber: comm.purchaseOrder.orderNumber,
      });
    }
  }
  return count;
}

async function sendLateDeliveryPrompts(): Promise<number> {
  // Candidate POs: SENT/ACKNOWLEDGED, sentAt > N hours + supplier leadTimeDays,
  // and metadata doesn't already mark lateDeliveryPromptSentAt.
  const now = new Date();
  const candidates = await db.purchaseOrder.findMany({
    where: {
      status: {
        in: [PurchaseOrderStatus.SENT, PurchaseOrderStatus.ACKNOWLEDGED],
      },
      sentAt: { not: null },
    },
    take: 50,
    select: {
      id: true,
      orderNumber: true,
      locationId: true,
      sentAt: true,
      metadata: true,
      supplier: { select: { name: true, leadTimeDays: true } },
    },
  });

  let count = 0;
  for (const po of candidates) {
    const meta = (po.metadata ?? {}) as Record<string, unknown>;
    if (isLateDeliveryPromptAlreadySent(meta)) continue;
    if (
      !isLateDeliveryReady({
        sentAt: po.sentAt,
        leadTimeDays: po.supplier.leadTimeDays,
        now,
      })
    ) {
      continue;
    }

    const managers = await db.user.findMany({
      where: {
        telegramChatId: { not: null },
        roles: { some: { locationId: po.locationId } },
      },
      select: { telegramChatId: true },
      take: 3,
    });
    if (managers.length === 0) continue;

    const message = buildLateDeliveryMessage({
      orderNumber: po.orderNumber,
      supplierName: po.supplier.name,
    });
    const keyboard = buildLateDeliveryKeyboard(po.id);

    let sentToAny = false;
    for (const m of managers) {
      if (!m.telegramChatId) continue;
      try {
        await sendTelegramMessage(m.telegramChatId, message, {
          parseMode: "Markdown",
          replyMarkup: keyboard,
        });
        sentToAny = true;
      } catch (err) {
        botTelemetry.error("supplier-nudges.late_delivery_send", err);
      }
    }
    if (sentToAny) {
      await db.purchaseOrder.update({
        where: { id: po.id },
        data: {
          metadata: markLateDeliveryPromptSent(
            meta,
            now
          ) as Prisma.InputJsonObject,
        },
      });
      count += 1;
      botTelemetry.event("supplier-nudges.late_delivery_prompt", {
        orderNumber: po.orderNumber,
      });
    }
  }
  return count;
}
