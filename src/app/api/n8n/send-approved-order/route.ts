import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PurchaseOrderStatus, CommunicationDirection, CommunicationStatus, SupplierOrderingMode } from "@/lib/prisma";
import type { Prisma } from "@/lib/prisma";
import { getSupplierOrderProviderForLocation } from "@/providers/supplier-order-provider";
import { verifyN8nRequest } from "@/modules/automation/n8n-auth";
import { buildSupplierOrderEmail } from "@/modules/purchasing/email-template";
import { getGmailCredentials } from "@/modules/channels/service";

export async function POST(request: NextRequest) {
  const auth = await verifyN8nRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ message: auth.reason }, { status: 401 });
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
        location: { include: { business: true } },
        approvedBy: { select: { name: true } },
        placedBy: { select: { name: true } },
      },
    });

    if (!po) {
      return NextResponse.json({ message: "Purchase order not found" }, { status: 404 });
    }

    if (po.status === PurchaseOrderStatus.SENT) {
      return NextResponse.json({ ok: true, message: "Already sent", orderNumber: po.orderNumber });
    }

    const supplierOrderProvider = await getSupplierOrderProviderForLocation(
      po.locationId
    );

    const lines = po.lines.map((l) => ({
      description: l.description,
      quantity: l.quantityOrdered,
      unit: l.purchaseUnit.toLowerCase(),
    }));

    // Build the same branded HTML email as every other path
    const gmailCreds =
      po.supplier.orderingMode === SupplierOrderingMode.EMAIL
        ? await getGmailCredentials(po.locationId).catch(() => null)
        : null;

    const composed = buildSupplierOrderEmail({
      supplierName: po.supplier.name,
      businessName: po.location?.business?.name?.trim() || "Our team",
      locationName: po.location?.name?.trim() || null,
      orderNumber: po.orderNumber,
      orderedByName:
        po.approvedBy?.name?.trim() || po.placedBy?.name?.trim() || null,
      replyToEmail: gmailCreds?.email?.trim() || "",
      lines,
      notes: po.notes ?? null,
    });

    // Send it
    if (po.supplier.orderingMode === SupplierOrderingMode.EMAIL && po.supplier.email) {
      const sendResult = await supplierOrderProvider.sendApprovedOrder({
        recipient: po.supplier.email,
        subject: composed.subject,
        body: composed.text,
        html: composed.html,
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
            subject: composed.subject,
            body: composed.text,
            status: CommunicationStatus.SENT,
            providerMessageId: sendResult.providerMessageId ?? null,
            metadata: {
              ...(("metadata" in sendResult && sendResult.metadata
                ? (sendResult.metadata as Record<string, unknown>)
                : {})),
              html: composed.html,
              recipient: po.supplier.email,
            } satisfies Prisma.InputJsonValue,
            sentAt: new Date(),
          },
        }),
      ]);

      return NextResponse.json({
        ok: true,
        orderNumber: po.orderNumber,
        supplierEmail: po.supplier.email,
        supplierName: po.supplier.name,
        subject: composed.subject,
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
