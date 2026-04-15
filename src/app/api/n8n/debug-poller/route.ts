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
