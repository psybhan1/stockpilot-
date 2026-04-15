/**
 * Debug endpoint for the supplier-reply-poller pipeline.
 * Returns a snapshot of what the poller can see + runs one pass.
 * Protected by the same webhook secret as every other /api/n8n/*.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CommunicationDirection, SupplierOrderingMode } from "@/lib/prisma";
import { verifyN8nRequest } from "@/modules/automation/n8n-auth";
import { backfillGmailThreadIds } from "@/modules/purchasing/backfill-gmail-threads";
import { pollSupplierReplies } from "@/modules/purchasing/supplier-reply-poller";
import { sendTelegramMessage } from "@/lib/telegram-bot";

export async function GET(request: NextRequest) {
  const auth = await verifyN8nRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ message: auth.reason }, { status: 401 });
  }

  try {
    const recent = await db.supplierCommunication.findMany({
      where: {
        direction: CommunicationDirection.OUTBOUND,
        channel: SupplierOrderingMode.EMAIL,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        metadata: true,
        purchaseOrder: {
          select: {
            orderNumber: true,
            status: true,
            locationId: true,
            supplier: { select: { name: true, email: true } },
          },
        },
      },
    });

    const outbound = recent.map((c) => {
      const meta = (c.metadata ?? {}) as Record<string, unknown>;
      return {
        id: c.id,
        orderNumber: c.purchaseOrder?.orderNumber,
        status: c.purchaseOrder?.status,
        supplier: c.purchaseOrder?.supplier.name,
        supplierEmail: c.purchaseOrder?.supplier.email,
        hasThreadId: typeof meta.gmailThreadId === "string",
        gmailThreadId: meta.gmailThreadId ?? null,
        createdAt: c.createdAt.toISOString(),
      };
    });

    const inboundCount = await db.supplierCommunication.count({
      where: {
        direction: CommunicationDirection.INBOUND,
        channel: SupplierOrderingMode.EMAIL,
      },
    });

    const inboundRecent = await db.supplierCommunication.findMany({
      where: {
        direction: CommunicationDirection.INBOUND,
        channel: SupplierOrderingMode.EMAIL,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        createdAt: true,
        body: true,
        metadata: true,
        purchaseOrder: {
          select: { orderNumber: true },
        },
      },
    });
    const inboundList = inboundRecent.map((c) => {
      const meta = (c.metadata ?? {}) as Record<string, unknown>;
      return {
        id: c.id,
        orderNumber: c.purchaseOrder?.orderNumber,
        intent: meta.intent ?? null,
        fromHeader: meta.fromHeader ?? null,
        bodyPreview: c.body.slice(0, 200).replace(/\s+/g, " ").trim(),
        createdAt: c.createdAt.toISOString(),
      };
    });

    // Direct Telegram send test to the first paired manager.
    const manager = await db.user.findFirst({
      where: { telegramChatId: { not: null } },
      select: { telegramChatId: true, name: true },
    });
    let telegramTest: Record<string, unknown> = { skipped: true };
    if (manager?.telegramChatId) {
      try {
        // Replay the LATEST inbound supplier reply as a Telegram ping
        // so the user sees what they should have been getting all along.
        const latestInbound = await db.supplierCommunication.findFirst({
          where: {
            direction: CommunicationDirection.INBOUND,
            channel: SupplierOrderingMode.EMAIL,
          },
          orderBy: { createdAt: "desc" },
          select: {
            body: true,
            metadata: true,
            purchaseOrder: {
              select: {
                orderNumber: true,
                supplier: { select: { name: true } },
              },
            },
          },
        });
        let messageText: string;
        if (latestInbound?.purchaseOrder) {
          const meta = (latestInbound.metadata ?? {}) as Record<string, unknown>;
          const intent = String(meta.intent ?? "OTHER").toUpperCase();
          const icon =
            intent === "CONFIRMED" ? "✅"
            : intent === "OUT_OF_STOCK" ? "⚠️"
            : intent === "DELAYED" ? "⏰"
            : intent === "QUESTION" ? "❓"
            : "📨";
          const label =
            intent === "CONFIRMED" ? "confirmed"
            : intent === "OUT_OF_STOCK" ? "out of stock"
            : intent === "DELAYED" ? "delayed"
            : intent === "QUESTION" ? "asked a question"
            : "replied";
          const preview = latestInbound.body.slice(0, 300).replace(/\s+/g, " ").trim();
          messageText =
            `${icon} *${latestInbound.purchaseOrder.supplier.name}* ${label} on *${latestInbound.purchaseOrder.orderNumber}*.\n\n` +
            `> ${preview}${latestInbound.body.length > 300 ? "…" : ""}\n\n` +
            `_(replayed via debug-poller — supplier-reply notifications are live going forward)_`;
        } else {
          messageText = `🔧 Debug test from StockPilot at ${new Date().toISOString()}. If you see this, the bot→you pipe is working.`;
        }
        const result = await sendTelegramMessage(
          manager.telegramChatId,
          messageText,
          { parseMode: "Markdown" }
        );
        telegramTest = { ok: true, sent: true, result: result as unknown };
      } catch (err) {
        telegramTest = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const backfillResult = await backfillGmailThreadIds(100).catch((e) => ({
      error: e instanceof Error ? e.message : String(e),
    }));

    const pollResult = await pollSupplierReplies(20).catch((e) => ({
      error: e instanceof Error ? e.message : String(e),
    }));

    return NextResponse.json({
      ok: true,
      summary: {
        recentOutbound: outbound.length,
        outboundWithThreadId: outbound.filter((o) => o.hasThreadId).length,
        inboundRecorded: inboundCount,
      },
      outbound,
      inboundList,
      telegramTest,
      backfillResult,
      pollResult,
    });
  } catch (error) {
    console.error("[debug-poller] error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
