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

const NUDGE_AFTER_HOURS = 24;
const LATE_DELIVERY_BUFFER_HOURS = 2; // fire N hours past leadTimeDays

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
  const cutoff = new Date(Date.now() - NUDGE_AFTER_HOURS * 60 * 60 * 1000);
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
    if (typeof meta.nudgeSentAt === "string") continue; // already nudged
    if (!comm.purchaseOrder) continue;
    if (comm.purchaseOrder.communications.length > 0) continue; // they replied
    const recipient = comm.supplier.email;
    if (!recipient) continue;

    const subject = `Re: ${comm.subject ?? "Purchase Order " + comm.purchaseOrder.orderNumber}`;
    const businessLine = [
      comm.purchaseOrder.location?.business?.name,
      comm.purchaseOrder.location?.name,
    ]
      .filter(Boolean)
      .join(" — ");
    const greeting = comm.supplier.contactName?.trim() || comm.supplier.name;
    const text =
      `Hi ${greeting},\n\n` +
      `Just checking in on order *${comm.purchaseOrder.orderNumber}* — when should I expect it? ` +
      `If anything's short or back-ordered, let me know what you can substitute and I'll adjust.\n\n` +
      `Thanks,\n${businessLine || "the team"}`;
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827">
      <table width="100%" cellspacing="0" cellpadding="0" border="0" style="padding:24px 12px"><tr><td align="center">
        <table width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;padding:24px 28px">
          <tr><td style="font-size:15px;line-height:1.55">
            <p style="margin:0 0 12px 0">Hi ${escapeHtml(greeting)},</p>
            <p style="margin:0 0 14px 0">Just checking in on order <b>${escapeHtml(comm.purchaseOrder.orderNumber)}</b> — when should I expect it? If anything's short or back-ordered, let me know what you can substitute and I'll adjust.</p>
            <p style="margin:0 0 4px 0">Thanks,</p>
            <p style="margin:0;font-weight:600">${escapeHtml(businessLine || "the team")}</p>
          </td></tr>
        </table>
      </td></tr></table>
    </body></html>`;

    try {
      const provider = new GmailEmailProvider(comm.purchaseOrder.locationId);
      const sent = await provider.sendApprovedOrder({
        recipient,
        subject,
        body: text,
        html,
      });
      await db.supplierCommunication.create({
        data: {
          supplierId: comm.purchaseOrder.id
            ? (await db.purchaseOrder.findUniqueOrThrow({
                where: { id: comm.purchaseOrder.id },
                select: { supplierId: true },
              })).supplierId
            : "", // never reached in practice
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
          sentAt: new Date(),
        },
      });
      await db.supplierCommunication.update({
        where: { id: comm.id },
        data: {
          metadata: {
            ...meta,
            nudgeSentAt: new Date().toISOString(),
          } satisfies Prisma.InputJsonValue,
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
  const now = Date.now();
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
    if (!po.sentAt) continue;
    const meta = (po.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.lateDeliveryPromptSentAt === "string") continue;
    const leadHours = (po.supplier.leadTimeDays ?? 2) * 24 + LATE_DELIVERY_BUFFER_HOURS;
    const age = (now - po.sentAt.getTime()) / (60 * 60 * 1000);
    if (age < leadHours) continue;

    const managers = await db.user.findMany({
      where: {
        telegramChatId: { not: null },
        roles: { some: { locationId: po.locationId } },
      },
      select: { telegramChatId: true },
      take: 3,
    });
    if (managers.length === 0) continue;

    const message =
      `📦 *${po.orderNumber}* from *${po.supplier.name}* should have arrived by now.\n\n` +
      `Did the delivery come in? Tap below to close the loop.`;
    const keyboard = [
      [
        { text: "✅ Yes — delivered", callback_data: `po_delivered:${po.id}` },
        { text: "⏰ Still waiting", callback_data: `po_snooze_delivery:${po.id}` },
      ],
    ];

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
          metadata: {
            ...meta,
            lateDeliveryPromptSentAt: new Date().toISOString(),
          } satisfies Prisma.InputJsonValue,
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
