/**
 * Supplier-invoice upload + OCR endpoint.
 *
 * POST /api/purchase-orders/[id]/invoice
 *   Body: { imageDataUrl: "data:image/jpeg;base64,..." }
 *   - Runs the invoice parser against the PO's lines
 *   - Stores the image bytes + parsed JSON on the PO
 *   - Returns { parsed: InvoiceParseResult } — the UI shows this
 *     for human review before the delivery form commits
 *
 * GET /api/purchase-orders/[id]/invoice
 *   - Returns the stored invoice image bytes (for display in the UI)
 *
 * DELETE /api/purchase-orders/[id]/invoice
 *   - Wipes the stored invoice + parsed data (so the user can
 *     re-upload a clearer photo)
 *
 * Auth: requireSession(SUPERVISOR) — same tier that can mark the
 * PO delivered. Scoped by locationId so one business can't peek at
 * another's invoices.
 *
 * Size cap: 6 MB on the image data URL (≈4.5 MB decoded). Groq's
 * payload limit is 20 MB and vision models generally choke on
 * anything bigger, so we clamp early.
 */
import { NextRequest, NextResponse } from "next/server";

import { createAuditLogTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { Role } from "@/lib/domain-enums";
import { Prisma } from "@/lib/prisma";
import { requireSession } from "@/modules/auth/session";
import { parseInvoiceImage } from "@/modules/invoices/parse";

export const runtime = "nodejs";
export const maxDuration = 90;
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

type UploadBody = {
  imageDataUrl?: string;
};

function parseDataUrl(
  dataUrl: string
): { contentType: string; bytes: Uint8Array<ArrayBuffer> } | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl.trim());
  if (!match) return null;
  const contentType = match[1].toLowerCase();
  if (!/^image\/(jpeg|png|webp|heic)$/.test(contentType)) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2], "base64");
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
  // Copy into a fresh, standalone ArrayBuffer so Prisma's Bytes
  // binding (which wants Uint8Array<ArrayBuffer>) accepts it.
  const buf = new ArrayBuffer(bytes.length);
  const view = new Uint8Array(buf);
  view.set(bytes);
  return { contentType, bytes: view };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ purchaseOrderId: string }> }
) {
  const { purchaseOrderId } = await params;
  const session = await requireSession(Role.SUPERVISOR);

  const po = await db.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, locationId: session.locationId },
    include: {
      supplier: { select: { name: true } },
      lines: {
        select: {
          id: true,
          description: true,
          quantityOrdered: true,
          purchaseUnit: true,
          packSizeBase: true,
          latestCostCents: true,
          inventoryItem: { select: { name: true } },
        },
      },
    },
  });
  if (!po) {
    return NextResponse.json(
      { message: "Purchase order not found at this location." },
      { status: 404 }
    );
  }

  const body = (await req.json().catch(() => null)) as UploadBody | null;
  if (!body?.imageDataUrl) {
    return NextResponse.json(
      { message: "Missing imageDataUrl in request body." },
      { status: 400 }
    );
  }

  const decoded = parseDataUrl(body.imageDataUrl);
  if (!decoded) {
    return NextResponse.json(
      {
        message: `Upload must be a JPEG/PNG/WEBP data URL under ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB.`,
      },
      { status: 400 }
    );
  }

  const parsed = await parseInvoiceImage({
    imageDataUrl: body.imageDataUrl,
    imageContentType: decoded.contentType,
    poContext: {
      orderNumber: po.orderNumber,
      supplierName: po.supplier.name,
      lines: po.lines.map((l) => ({
        lineId: l.id,
        description: l.description,
        inventoryItemName: l.inventoryItem.name,
        quantityOrdered: l.quantityOrdered,
        purchaseUnit: l.purchaseUnit,
        packSizeBase: l.packSizeBase,
        expectedUnitCostCents: l.latestCostCents ?? null,
      })),
    },
  });

  // Persist the image + parsed payload regardless of OCR success —
  // even if the parser fails, the image is uploaded and the user
  // can review it and retry. The UI decides what to display.
  await db.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        invoiceImage: decoded.bytes,
        invoiceContentType: decoded.contentType,
        invoiceParsed: parsed as unknown as Prisma.InputJsonValue,
        invoiceParsedAt: new Date(),
      },
    });
    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: parsed.ok
        ? "purchaseOrder.invoice_parsed"
        : "purchaseOrder.invoice_uploaded",
      entityType: "purchaseOrder",
      entityId: po.id,
      details: {
        orderNumber: po.orderNumber,
        contentType: decoded.contentType,
        bytes: decoded.bytes.byteLength,
        ok: parsed.ok,
        linesFound: parsed.lines.length,
        reason: parsed.reason ?? null,
      },
    });
  });

  return NextResponse.json({ parsed });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ purchaseOrderId: string }> }
) {
  const { purchaseOrderId } = await params;
  const session = await requireSession(Role.SUPERVISOR);

  const po = await db.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, locationId: session.locationId },
    select: { invoiceImage: true, invoiceContentType: true },
  });
  if (!po || !po.invoiceImage || !po.invoiceContentType) {
    return NextResponse.json({ message: "No invoice on file." }, { status: 404 });
  }
  return new NextResponse(Buffer.from(po.invoiceImage), {
    status: 200,
    headers: {
      "content-type": po.invoiceContentType,
      "cache-control": "private, max-age=60",
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ purchaseOrderId: string }> }
) {
  const { purchaseOrderId } = await params;
  const session = await requireSession(Role.SUPERVISOR);

  const po = await db.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, locationId: session.locationId },
    select: { id: true, orderNumber: true, invoiceImage: true },
  });
  if (!po) {
    return NextResponse.json({ message: "Not found." }, { status: 404 });
  }
  if (!po.invoiceImage) {
    return NextResponse.json({ ok: true, noop: true });
  }

  await db.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        invoiceImage: null,
        invoiceContentType: null,
        invoiceParsed: Prisma.JsonNull,
        invoiceParsedAt: null,
      },
    });
    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: "purchaseOrder.invoice_cleared",
      entityType: "purchaseOrder",
      entityId: po.id,
      details: { orderNumber: po.orderNumber },
    });
  });

  return NextResponse.json({ ok: true });
}
