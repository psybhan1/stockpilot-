import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PurchaseOrderStatus, CommunicationDirection, CommunicationStatus, SupplierOrderingMode } from "@/lib/prisma";
import { getSupplierOrderProvider } from "@/providers/supplier-order-provider";

function validateSecret(request: NextRequest) {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) return true;
  return request.headers.get("X-StockPilot-Webhook-Secret") === secret;
}

export async function POST(request: NextRequest) {
  if (!validateSecret(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const purchaseOrderId = String(body.purchaseOrderId ?? "").trim();

    if (!purchaseOrderId) {
      return NextResponse.json({ message: "Missing purchaseOrderId" }, { status: 400 });
    }

    const po = await db.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        supplier: true,
        lines: {
          include: { inventoryItem: true },
        },
        location: true,
      },
    });

    if (!po) {
      return NextResponse.json({ message: "Purchase order not found" }, { status: 404 });
    }

    if (po.status === PurchaseOrderStatus.SENT) {
      return NextResponse.json({ ok: true, message: "Already sent", orderNumber: po.orderNumber });
    }

    const supplierOrderProvider = getSupplierOrderProvider();

    const lines = po.lines.map((l) => ({
      description: l.description,
      quantity: l.quantityOrdered,
      unit: l.purchaseUnit.toLowerCase(),
    }));

    // Draft the email
    const draft = await supplierOrderProvider.createDraft({
      supplierName: po.supplier.name,
      mode: po.supplier.orderingMode,
      orderNumber: po.orderNumber,
      lines,
    });

    // Send it
    if (po.supplier.orderingMode === SupplierOrderingMode.EMAIL && po.supplier.email) {
      const sendResult = await supplierOrderProvider.sendApprovedOrder({
        recipient: po.supplier.email,
        subject: draft.subject,
        body: draft.body,
      });

      // Mark PO as SENT
      await db.$transaction([
        db.purchaseOrder.update({
          where: { id: po.id },
          data: {
            status: PurchaseOrderStatus.SENT,
            sentAt: new Date(),
          },
        }),
        db.supplierCommunication.create({
          data: {
            supplierId: po.supplierId,
            purchaseOrderId: po.id,
            channel: SupplierOrderingMode.EMAIL,
            direction: CommunicationDirection.OUTBOUND,
            subject: draft.subject,
            body: draft.body,
            status: CommunicationStatus.SENT,
            providerMessageId: sendResult.providerMessageId ?? null,
            sentAt: new Date(),
          },
        }),
      ]);

      return NextResponse.json({
        ok: true,
        orderNumber: po.orderNumber,
        supplierEmail: po.supplier.email,
        supplierName: po.supplier.name,
        subject: draft.subject,
        providerMessageId: sendResult.providerMessageId ?? null,
      });
    }

    // Manual mode — just mark as approved and notify
    await db.purchaseOrder.update({
      where: { id: po.id },
      data: { status: PurchaseOrderStatus.APPROVED, approvedAt: new Date() },
    });

    return NextResponse.json({
      ok: true,
      orderNumber: po.orderNumber,
      supplierName: po.supplier.name,
      mode: po.supplier.orderingMode,
      message: "Order approved — manual follow-up required",
    });
  } catch (error) {
    console.error("[send-approved-order] error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
