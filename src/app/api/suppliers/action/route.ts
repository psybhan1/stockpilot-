/**
 * Records a supplier's one-click action on a PO. The token in the
 * POST body is the same HMAC-signed value embedded in the email the
 * supplier received; no other auth is needed — the token IS auth.
 *
 * Side effects on success:
 *   - creates an INBOUND SupplierCommunication row with a definitive
 *     intent (CONFIRMED / OUT_OF_STOCK / DELAYED), body composed
 *     from the supplier's form input, and metadata.source="supplier_action_link".
 *   - when the action is CONFIRMED, flips the PO status to
 *     ACKNOWLEDGED.
 *   - when the action is OUT_OF_STOCK, flips the PO status to FAILED
 *     with an explanatory note.
 *   - fires a Telegram notification to every paired manager so the
 *     operator sees the response within seconds (vs the 5-min poll).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  CommunicationDirection,
  CommunicationStatus,
  PurchaseOrderStatus,
  SupplierOrderingMode,
  type Prisma,
} from "@/lib/prisma";
import { verifySupplierActionToken } from "@/lib/supplier-action-token";
import { sendTelegramMessage } from "@/lib/telegram-bot";

const VALID_ACTIONS = ["CONFIRMED", "OUT_OF_STOCK", "DELAYED"] as const;
type Action = (typeof VALID_ACTIONS)[number];

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    token?: string;
    action?: string;
    eta?: string;
    note?: string;
  } | null;

  if (!body) {
    return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 });
  }

  const verification = verifySupplierActionToken(body.token ?? "");
  if (!verification.ok) {
    return NextResponse.json(
      { ok: false, message: `Link invalid: ${verification.reason}` },
      { status: 401 }
    );
  }

  const action = (body.action ?? "").toUpperCase();
  if (!VALID_ACTIONS.includes(action as Action)) {
    return NextResponse.json(
      { ok: false, message: "Unknown action" },
      { status: 400 }
    );
  }

  const po = await db.purchaseOrder.findUnique({
    where: { id: verification.payload.poId },
    include: {
      supplier: { select: { id: true, name: true, email: true } },
      location: { select: { id: true, name: true } },
      lines: {
        select: { description: true, quantityOrdered: true, purchaseUnit: true },
      },
    },
  });
  if (!po) {
    return NextResponse.json({ ok: false, message: "Order not found" }, { status: 404 });
  }

  // Build a human-readable body from the supplier's submission so
  // the PO detail page's "Supplier conversation" panel renders it
  // just like a normal reply.
  const etaText = body.eta?.trim() ? ` (ETA ${body.eta.trim()})` : "";
  const noteText = body.note?.trim() ? `\n\n${body.note.trim()}` : "";
  const replyBody = (() => {
    switch (action as Action) {
      case "CONFIRMED":
        return `Confirmed via one-click action link.${etaText}${noteText}`;
      case "OUT_OF_STOCK":
        return `Cannot fulfil — out of stock. Submitted via one-click action link.${noteText}`;
      case "DELAYED":
        return `Delayed — can deliver later than usual.${etaText}${noteText}`;
    }
  })();

  await db.$transaction(async (tx) => {
    await tx.supplierCommunication.create({
      data: {
        supplierId: po.supplierId,
        purchaseOrderId: po.id,
        channel: SupplierOrderingMode.EMAIL,
        direction: CommunicationDirection.INBOUND,
        subject: `Supplier action: ${action} on ${po.orderNumber}`,
        body: replyBody,
        status: CommunicationStatus.SENT,
        metadata: {
          source: "supplier_action_link",
          intent: action,
          eta: body.eta?.trim() || null,
          note: body.note?.trim() || null,
          submittedAt: new Date().toISOString(),
        } satisfies Prisma.InputJsonValue,
        sentAt: new Date(),
      },
    });

    if (action === "CONFIRMED" && po.status === PurchaseOrderStatus.SENT) {
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: PurchaseOrderStatus.ACKNOWLEDGED,
          deliveredAt: null,
        },
      });
    } else if (action === "OUT_OF_STOCK" && po.status === PurchaseOrderStatus.SENT) {
      // Mark as FAILED with context so the manager sees it clearly
      // in the list + can reorder from a fallback supplier.
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: PurchaseOrderStatus.FAILED,
          notes: appendNote(po.notes, `Supplier declined via action link: ${action}. ${body.note?.trim() ?? ""}`),
        },
      });
    }
  });

  // Notify every paired manager with a Telegram chat id so they see
  // the response instantly (vs waiting for the 5-min poller).
  const managers = await db.user.findMany({
    where: { telegramChatId: { not: null } },
    select: { telegramChatId: true },
    take: 5,
  });
  const icon =
    action === "CONFIRMED" ? "✅" : action === "OUT_OF_STOCK" ? "⚠️" : "⏰";
  const label =
    action === "CONFIRMED"
      ? "confirmed"
      : action === "OUT_OF_STOCK"
      ? "is OUT OF STOCK on"
      : "will deliver with delay on";
  const message =
    `${icon} *${po.supplier.name}* ${label} *${po.orderNumber}*` +
    (body.eta?.trim() ? `\nETA: ${body.eta.trim()}` : "") +
    (body.note?.trim() ? `\n\n_${body.note.trim()}_` : "") +
    `\n\n_(clicked the one-click action link — no email reply needed)_`;

  await Promise.all(
    managers.map(async (m) => {
      if (!m.telegramChatId) return;
      try {
        await sendTelegramMessage(m.telegramChatId, message, { parseMode: "Markdown" });
      } catch (err) {
        console.error("[supplier-action] telegram notify failed:", err);
      }
    })
  );

  return NextResponse.json({
    ok: true,
    orderNumber: po.orderNumber,
    businessName: po.location?.name ?? null,
    action,
  });
}

function appendNote(existing: string | null, next: string): string {
  const clean = next.trim();
  if (!clean) return existing ?? "";
  return existing ? `${existing}\n${clean}` : clean;
}
