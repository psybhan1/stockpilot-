import {
  AgentTaskStatus,
  AgentTaskType,
  AlertStatus,
  AlertType,
  PurchaseOrderStatus,
  RecommendationStatus,
} from "@/lib/prisma";
import type { Prisma } from "@/lib/prisma";

import { createAuditLogTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { postStockMovementTx, refreshOperationalState } from "@/modules/inventory/ledger";
import { enqueueJobTx } from "@/modules/jobs/dispatcher";
import {
  canAcknowledgePurchaseOrder,
  canCancelPurchaseOrder,
  canDeliverPurchaseOrder,
  canMarkPurchaseOrderSent,
  normalizeReceivedPackCount,
  receivedQuantityBaseFromPacks,
} from "@/modules/purchasing/lifecycle";
import { getSupplierOrderProviderForLocation } from "@/providers/supplier-order-provider";
import { buildSupplierOrderEmail } from "@/modules/purchasing/email-template";
import { getGmailCredentials } from "@/modules/channels/service";

function nextOrderNumber() {
  // Format: PO-YYYY-<6 base36> — about 2B values per year, plus a
  // millisecond-timestamp prefix so two POs approved in the same
  // second don't share digits. The old format (4 random digits,
  // ~9k values) collided in the wild on any busy café and in any
  // test that approved >10 POs back-to-back — the @@unique on
  // orderNumber would throw P2002 and the whole transaction would
  // roll back.
  const ms = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0");
  return `PO-${new Date().getFullYear()}-${ms}${rand}`;
}

function appendOperationalNote(existing: string | null | undefined, next: string | null | undefined) {
  const normalized = next?.trim();

  if (!normalized) {
    return existing ?? undefined;
  }

  return existing ? `${existing}\n${normalized}` : normalized;
}

export async function approveRecommendation(
  recommendationId: string,
  userId: string,
  overridePackCount?: number
) {
  const recommendation = await db.reorderRecommendation.findUniqueOrThrow({
    where: { id: recommendationId },
    include: {
      inventoryItem: true,
      supplier: true,
      location: { select: { name: true, business: { select: { name: true } } } },
    },
  });

  const approver = await db.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });

  const supplierOrderProvider = await getSupplierOrderProviderForLocation(
    recommendation.locationId
  );
  const orderNumber = nextOrderNumber();
  const approvedPackCount = Number.isFinite(overridePackCount) && overridePackCount && overridePackCount > 0
    ? Math.max(1, Math.round(overridePackCount))
    : recommendation.recommendedPackCount;
  const approvedQuantityBase = approvedPackCount * recommendation.inventoryItem.packSizeBase;

  // Capture the expected unit cost at PO-creation time from the
  // preferred SupplierItem row. Without this, the delivery-time
  // variance comparison has no baseline to diff the actual cost
  // against, and `deliverPurchaseOrder`'s variance-audit logic
  // silently does nothing — which hid the price-creep signal until
  // now. Read the cheapest-supplier's price (same policy as the
  // margin + pricing dashboards so the numbers agree across pages).
  const supplierItemForCost = await db.supplierItem.findFirst({
    where: {
      supplierId: recommendation.supplierId,
      inventoryItemId: recommendation.inventoryItemId,
    },
    select: { lastUnitCostCents: true },
  });
  const expectedLineCostCents = supplierItemForCost?.lastUnitCostCents ?? null;

  const purchaseOrder = await db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.create({
      data: {
        locationId: recommendation.locationId,
        supplierId: recommendation.supplierId,
        recommendationId: recommendation.id,
        orderNumber,
        status: PurchaseOrderStatus.APPROVED,
        totalLines: 1,
        placedById: userId,
        approvedById: userId,
        approvedAt: new Date(),
        notes:
          approvedPackCount === recommendation.recommendedPackCount
            ? recommendation.rationale
            : `${recommendation.rationale}\nManager override: ${approvedPackCount} ${recommendation.recommendedPurchaseUnit.toLowerCase()}.`,
      },
    });

    await tx.purchaseOrderLine.create({
      data: {
        purchaseOrderId: po.id,
        inventoryItemId: recommendation.inventoryItemId,
        description: recommendation.inventoryItem.name,
        quantityOrdered: approvedPackCount,
        expectedQuantityBase: approvedQuantityBase,
        purchaseUnit: recommendation.recommendedPurchaseUnit,
        packSizeBase: recommendation.inventoryItem.packSizeBase,
        latestCostCents: expectedLineCostCents,
      },
    });

    await tx.reorderRecommendation.update({
      where: { id: recommendation.id },
      data: {
        status: RecommendationStatus.CONVERTED,
        approvedById: userId,
        approvedAt: new Date(),
        recommendedPackCount: approvedPackCount,
        recommendedOrderQuantityBase: approvedQuantityBase,
      },
    });

    await tx.alert.updateMany({
      where: {
        inventoryItemId: recommendation.inventoryItemId,
        status: AlertStatus.OPEN,
        type: AlertType.ORDER_APPROVAL,
      },
      data: {
        status: AlertStatus.RESOLVED,
        resolvedAt: new Date(),
      },
    });

    await createAuditLogTx(tx, {
      locationId: recommendation.locationId,
      userId,
      action: "recommendation.approved",
      entityType: "reorderRecommendation",
      entityId: recommendation.id,
      details: { orderNumber, approvedPackCount },
    });

    return po;
  });

  const line = {
    description: recommendation.inventoryItem.name,
    quantity: approvedPackCount,
    unit: recommendation.recommendedPurchaseUnit.toLowerCase(),
  };

  // Build the same branded HTML email as the bot path uses, so
  // suppliers see one consistent template no matter how the order
  // was approved.
  const gmailCreds =
    recommendation.supplier.orderingMode === "EMAIL"
      ? await getGmailCredentials(recommendation.locationId).catch(() => null)
      : null;

  const composed =
    recommendation.supplier.orderingMode === "WEBSITE"
      ? null
      : buildSupplierOrderEmail({
          supplierName: recommendation.supplier.name,
          businessName:
            recommendation.location?.business?.name?.trim() || "Our team",
          locationName: recommendation.location?.name?.trim() || null,
          orderNumber,
          orderedByName: approver?.name?.trim() || null,
          replyToEmail: gmailCreds?.email?.trim() || "",
          lines: [line],
          notes: recommendation.rationale ?? null,
        });

  const draft = composed
    ? { subject: composed.subject, body: composed.text, html: composed.html }
    : null;

  if (recommendation.supplier.orderingMode === "EMAIL") {
    try {
      const sendResult = await supplierOrderProvider.sendApprovedOrder({
        recipient: recommendation.supplier.email ?? "orders@example.com",
        subject: draft?.subject ?? `PO ${orderNumber} from StockPilot`,
        body: draft?.body ?? recommendation.rationale,
        html: draft?.html,
      });

      await db.$transaction(async (tx) => {
        await tx.purchaseOrder.update({
          where: { id: purchaseOrder.id },
          data: {
            status: PurchaseOrderStatus.SENT,
            sentAt: new Date(),
          },
        });

        await tx.supplierCommunication.create({
          data: {
            supplierId: recommendation.supplierId,
            purchaseOrderId: purchaseOrder.id,
            channel: recommendation.supplier.orderingMode,
            direction: "OUTBOUND",
            subject: draft?.subject,
            body: draft?.body ?? recommendation.rationale,
            status: "SENT",
            providerMessageId: sendResult.providerMessageId,
            metadata: {
              ...(("metadata" in sendResult && sendResult.metadata
                ? (sendResult.metadata as Record<string, unknown>)
                : {})),
              ...(draft?.html ? { html: draft.html } : {}),
              recipient: recommendation.supplier.email ?? "orders@example.com",
            } satisfies Prisma.InputJsonValue,
            sentAt: new Date(),
          },
        });

        await createAuditLogTx(tx, {
          locationId: recommendation.locationId,
          userId,
          action: "purchaseOrder.sent",
          entityType: "purchaseOrder",
          entityId: purchaseOrder.id,
          details: {
            orderNumber,
            channel: "EMAIL",
          },
        });
      });
    } catch (error) {
      await db.$transaction(async (tx) => {
        await tx.purchaseOrder.update({
          where: { id: purchaseOrder.id },
          data: {
            status: PurchaseOrderStatus.FAILED,
            notes: appendOperationalNote(
              purchaseOrder.notes,
              `Email send failed: ${error instanceof Error ? error.message : "Unknown send failure"}`
            ),
          },
        });

        await tx.supplierCommunication.create({
          data: {
            supplierId: recommendation.supplierId,
            purchaseOrderId: purchaseOrder.id,
            channel: recommendation.supplier.orderingMode,
            direction: "OUTBOUND",
            subject: draft?.subject,
            body: draft?.body ?? recommendation.rationale,
            status: "FAILED",
          },
        });

        await createAuditLogTx(tx, {
          locationId: recommendation.locationId,
          userId,
          action: "purchaseOrder.send_failed",
          entityType: "purchaseOrder",
          entityId: purchaseOrder.id,
          details: {
            orderNumber,
            channel: "EMAIL",
            error: error instanceof Error ? error.message : "Unknown send failure",
          },
        });
      });
    }
  } else if (recommendation.supplier.orderingMode === "WEBSITE") {
    const task = await supplierOrderProvider.prepareWebsiteTask({
      supplierName: recommendation.supplier.name,
      website: recommendation.supplier.website,
      orderNumber,
      lines: [line],
    });

    await db.$transaction(async (tx) => {
      const agentTask = await tx.agentTask.create({
        data: {
          locationId: recommendation.locationId,
          supplierId: recommendation.supplierId,
          purchaseOrderId: purchaseOrder.id,
          type: AgentTaskType.WEBSITE_ORDER_PREP,
          status: AgentTaskStatus.PENDING,
          title: task.title,
          description: task.description,
          input: task.input as Prisma.InputJsonValue,
        },
      });

      await tx.supplierCommunication.create({
        data: {
          supplierId: recommendation.supplierId,
          purchaseOrderId: purchaseOrder.id,
          channel: recommendation.supplier.orderingMode,
          direction: "OUTBOUND",
          subject: `PO ${orderNumber} website prep queued`,
          body:
            "StockPilot queued a website-order preparation workflow. Final supplier checkout remains approval-first.",
          status: "DRAFT",
        },
      });

      await enqueueJobTx(tx, {
        locationId: recommendation.locationId,
        type: "PREPARE_WEBSITE_ORDER",
        payload: {
          taskId: agentTask.id,
        },
      });

      await createAuditLogTx(tx, {
        locationId: recommendation.locationId,
        userId,
        action: "agentTask.dispatch_queued",
        entityType: "agentTask",
        entityId: agentTask.id,
        details: {
          purchaseOrderId: purchaseOrder.id,
          provider: "website-order",
        },
      });
    });
  } else if (recommendation.supplier.orderingMode === "MANUAL") {
    await db.$transaction(async (tx) => {
      await tx.supplierCommunication.create({
        data: {
          supplierId: recommendation.supplierId,
          purchaseOrderId: purchaseOrder.id,
          channel: recommendation.supplier.orderingMode,
          direction: "OUTBOUND",
          subject: draft?.subject ?? `PO ${orderNumber} manual draft`,
          body:
            draft?.body ??
            `Manual supplier workflow draft for ${recommendation.supplier.name}. Final send stays manager-controlled.`,
          status: "DRAFT",
        },
      });

      await createAuditLogTx(tx, {
        locationId: recommendation.locationId,
        userId,
        action: "purchaseOrder.manual_draft_created",
        entityType: "purchaseOrder",
        entityId: purchaseOrder.id,
        details: {
          orderNumber,
          channel: "MANUAL",
        },
      });
    });
  }

  return (
    (await db.purchaseOrder.findUnique({
      where: {
        id: purchaseOrder.id,
      },
    })) ?? purchaseOrder
  );
}

export async function deferRecommendation(recommendationId: string, userId: string) {
  const recommendation = await db.reorderRecommendation.findUniqueOrThrow({
    where: { id: recommendationId },
  });

  return db.$transaction(async (tx) => {
    await tx.reorderRecommendation.update({
      where: { id: recommendation.id },
      data: {
        status: RecommendationStatus.DEFERRED,
        dismissedAt: new Date(),
      },
    });

    await tx.alert.updateMany({
      where: {
        inventoryItemId: recommendation.inventoryItemId,
        status: AlertStatus.OPEN,
        type: AlertType.ORDER_APPROVAL,
      },
      data: {
        status: AlertStatus.ACKNOWLEDGED,
      },
    });

    await createAuditLogTx(tx, {
      locationId: recommendation.locationId,
      userId,
      action: "recommendation.deferred",
      entityType: "reorderRecommendation",
      entityId: recommendation.id,
    });
  });
}

export async function rejectRecommendation(recommendationId: string, userId: string) {
  const recommendation = await db.reorderRecommendation.findUniqueOrThrow({
    where: { id: recommendationId },
  });

  return db.$transaction(async (tx) => {
    await tx.reorderRecommendation.update({
      where: { id: recommendation.id },
      data: {
        status: RecommendationStatus.REJECTED,
        dismissedAt: new Date(),
      },
    });

    await tx.alert.updateMany({
      where: {
        inventoryItemId: recommendation.inventoryItemId,
        status: AlertStatus.OPEN,
        type: AlertType.ORDER_APPROVAL,
      },
      data: {
        status: AlertStatus.RESOLVED,
        resolvedAt: new Date(),
      },
    });

    await createAuditLogTx(tx, {
      locationId: recommendation.locationId,
      userId,
      action: "recommendation.rejected",
      entityType: "reorderRecommendation",
      entityId: recommendation.id,
    });
  });
}

export async function markPurchaseOrderSent(
  purchaseOrderId: string,
  userId: string,
  notes?: string
) {
  const purchaseOrder = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
    include: {
      supplier: true,
      communications: true,
    },
  });

  if (!canMarkPurchaseOrderSent(purchaseOrder.status)) {
    throw new Error("This purchase order cannot be marked as sent from its current status.");
  }

  return db.$transaction(async (tx) => {
    const updatedOrder = await tx.purchaseOrder.update({
      where: { id: purchaseOrder.id },
      data: {
        status: PurchaseOrderStatus.SENT,
        sentAt: new Date(),
        notes: appendOperationalNote(purchaseOrder.notes, notes),
      },
      include: {
        supplier: true,
      },
    });

    const latestDraftCommunication = purchaseOrder.communications
      .filter((communication) => communication.status === "DRAFT")
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];

    if (latestDraftCommunication) {
      await tx.supplierCommunication.update({
        where: { id: latestDraftCommunication.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          body: appendOperationalNote(latestDraftCommunication.body, notes),
        },
      });
    } else {
      await tx.supplierCommunication.create({
        data: {
          supplierId: purchaseOrder.supplierId,
          purchaseOrderId: purchaseOrder.id,
          channel: purchaseOrder.supplier.orderingMode,
          direction: "OUTBOUND",
          subject: `PO ${purchaseOrder.orderNumber} marked sent`,
          body:
            notes?.trim() ||
            `Purchase order ${purchaseOrder.orderNumber} was marked as sent from StockPilot.`,
          status: "SENT",
          sentAt: new Date(),
        },
      });
    }

    await createAuditLogTx(tx, {
      locationId: purchaseOrder.locationId,
      userId,
      action: "purchaseOrder.sent",
      entityType: "purchaseOrder",
      entityId: purchaseOrder.id,
      details: {
        orderNumber: purchaseOrder.orderNumber,
      },
    });

    return updatedOrder;
  });
}

export async function acknowledgePurchaseOrder(
  purchaseOrderId: string,
  userId: string,
  notes?: string
) {
  const purchaseOrder = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
  });

  if (!canAcknowledgePurchaseOrder(purchaseOrder.status)) {
    throw new Error("This purchase order cannot be acknowledged from its current status.");
  }

  return db.$transaction(async (tx) => {
    const updatedOrder = await tx.purchaseOrder.update({
      where: { id: purchaseOrder.id },
      data: {
        status: PurchaseOrderStatus.ACKNOWLEDGED,
        notes: appendOperationalNote(purchaseOrder.notes, notes),
      },
      include: {
        supplier: true,
      },
    });

    await createAuditLogTx(tx, {
      locationId: purchaseOrder.locationId,
      userId,
      action: "purchaseOrder.acknowledged",
      entityType: "purchaseOrder",
      entityId: purchaseOrder.id,
      details: {
        orderNumber: purchaseOrder.orderNumber,
      },
    });

    return updatedOrder;
  });
}

export async function cancelPurchaseOrder(
  purchaseOrderId: string,
  userId: string,
  notes?: string
) {
  const purchaseOrder = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
  });

  if (!canCancelPurchaseOrder(purchaseOrder.status)) {
    throw new Error("This purchase order is already closed.");
  }

  return db.$transaction(async (tx) => {
    const updatedOrder = await tx.purchaseOrder.update({
      where: { id: purchaseOrder.id },
      data: {
        status: PurchaseOrderStatus.CANCELLED,
        notes: appendOperationalNote(purchaseOrder.notes, notes),
      },
      include: {
        supplier: true,
      },
    });

    await createAuditLogTx(tx, {
      locationId: purchaseOrder.locationId,
      userId,
      action: "purchaseOrder.cancelled",
      entityType: "purchaseOrder",
      entityId: purchaseOrder.id,
      details: {
        orderNumber: purchaseOrder.orderNumber,
      },
    });

    return updatedOrder;
  });
}

export async function deliverPurchaseOrder(input: {
  purchaseOrderId: string;
  userId: string;
  notes?: string;
  lineReceipts?: Record<string, number>;
  /**
   * Per-line actual unit cost in cents, captured from the delivery
   * invoice. When present, we (a) store it on the PurchaseOrderLine,
   * (b) update SupplierItem.lastUnitCostCents so future reorder
   * suggestions use the real recent price, (c) emit an audit entry
   * if the price variance vs the PO estimate is significant. Lines
   * not in this map keep their estimate.
   */
  actualUnitCostsCents?: Record<string, number>;
}) {
  const purchaseOrder = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: input.purchaseOrderId },
    include: {
      supplier: true,
      lines: true,
      agentTasks: true,
    },
  });

  if (!canDeliverPurchaseOrder(purchaseOrder.status)) {
    throw new Error("This purchase order has already been closed for receiving.");
  }

  const touchedInventoryItemIds = new Set<string>();
  const varianceFindings: Array<{
    lineId: string;
    description: string;
    expectedCents: number | null;
    actualCents: number;
    deltaPct: number;
    severity: "watch" | "review";
  }> = [];

  const updatedOrder = await db.$transaction(async (tx) => {
    for (const line of purchaseOrder.lines) {
      const receivedPackCount = normalizeReceivedPackCount(
        input.lineReceipts?.[line.id],
        line.quantityOrdered
      );
      const receivedQuantityBase = receivedQuantityBaseFromPacks(
        receivedPackCount,
        line.packSizeBase
      );

      const rawActualCost = input.actualUnitCostsCents?.[line.id];
      const actualUnitCostCents =
        typeof rawActualCost === "number" &&
        Number.isFinite(rawActualCost) &&
        rawActualCost >= 0
          ? Math.round(rawActualCost)
          : null;

      if (receivedQuantityBase <= 0 && actualUnitCostCents == null) {
        continue;
      }

      if (receivedQuantityBase > 0) {
        touchedInventoryItemIds.add(line.inventoryItemId);

        await postStockMovementTx(tx, {
          locationId: purchaseOrder.locationId,
          inventoryItemId: line.inventoryItemId,
          quantityDeltaBase: receivedQuantityBase,
          movementType: "RECEIVING",
          sourceType: "purchase_order",
          sourceId: purchaseOrder.id,
          notes: input.notes,
          metadata: {
            purchaseOrderLineId: line.id,
            orderNumber: purchaseOrder.orderNumber,
            quantityReceived: receivedPackCount,
            purchaseUnit: line.purchaseUnit,
            actualUnitCostCents,
          },
          userId: input.userId,
        });
      }

      await tx.purchaseOrderLine.update({
        where: { id: line.id },
        data: {
          actualQuantityBase: receivedQuantityBase,
          ...(actualUnitCostCents != null ? { actualUnitCostCents } : {}),
          notes: appendOperationalNote(
            line.notes,
            `Received ${receivedPackCount} ${line.purchaseUnit.toLowerCase()} from ${purchaseOrder.orderNumber}${
              actualUnitCostCents != null
                ? ` @ $${(actualUnitCostCents / 100).toFixed(2)}/${line.purchaseUnit.toLowerCase()}`
                : ""
            }.`
          ),
        },
      });

      // Price history: when an actual cost landed, write it to the
      // SupplierItem row so the reorder engine + cart builder use
      // recent real pricing instead of whatever was on the last PO
      // at creation time.
      if (actualUnitCostCents != null) {
        await tx.supplierItem
          .updateMany({
            where: {
              supplierId: purchaseOrder.supplierId,
              inventoryItemId: line.inventoryItemId,
            },
            data: { lastUnitCostCents: actualUnitCostCents },
          })
          .catch(() => null);
      }

      // Variance classification — capture for the audit log below.
      if (actualUnitCostCents != null && line.latestCostCents != null && line.latestCostCents > 0) {
        const deltaCents = actualUnitCostCents - line.latestCostCents;
        const deltaPct = deltaCents / line.latestCostCents;
        const absPct = Math.abs(deltaPct);
        if (absPct >= 0.05) {
          varianceFindings.push({
            lineId: line.id,
            description: line.description,
            expectedCents: line.latestCostCents,
            actualCents: actualUnitCostCents,
            deltaPct,
            severity: absPct >= 0.15 ? "review" : "watch",
          });
        }
      }
    }

    await tx.agentTask.updateMany({
      where: {
        purchaseOrderId: purchaseOrder.id,
        status: {
          in: [AgentTaskStatus.PENDING, AgentTaskStatus.READY_FOR_REVIEW],
        },
      },
      data: {
        status: AgentTaskStatus.COMPLETED,
        output: {
          completedBy: input.userId,
          completedAt: new Date().toISOString(),
          resolution: "Purchase order marked delivered and stock was received in-app.",
        },
      },
    });

    const nextOrder = await tx.purchaseOrder.update({
      where: { id: purchaseOrder.id },
      data: {
        status: PurchaseOrderStatus.DELIVERED,
        deliveredAt: new Date(),
        notes: appendOperationalNote(purchaseOrder.notes, input.notes),
      },
      include: {
        supplier: true,
      },
    });

    await createAuditLogTx(tx, {
      locationId: purchaseOrder.locationId,
      userId: input.userId,
      action: "purchaseOrder.delivered",
      entityType: "purchaseOrder",
      entityId: purchaseOrder.id,
      details: {
        orderNumber: purchaseOrder.orderNumber,
        lineReceipts: purchaseOrder.lines.map((line) => ({
          purchaseOrderLineId: line.id,
          quantityReceived: normalizeReceivedPackCount(
            input.lineReceipts?.[line.id],
            line.quantityOrdered
          ),
          actualUnitCostCents:
            input.actualUnitCostsCents?.[line.id] ?? null,
        })),
      },
    });

    // Surface price-variance findings as their own audit rows so
    // dashboards / alerts can pick them up without parsing the
    // delivery entry's details blob.
    for (const finding of varianceFindings) {
      await createAuditLogTx(tx, {
        locationId: purchaseOrder.locationId,
        userId: input.userId,
        action:
          finding.severity === "review"
            ? "purchaseOrder.priceVariance.review"
            : "purchaseOrder.priceVariance.watch",
        entityType: "purchaseOrderLine",
        entityId: finding.lineId,
        details: {
          orderNumber: purchaseOrder.orderNumber,
          description: finding.description,
          expectedCents: finding.expectedCents,
          actualCents: finding.actualCents,
          deltaPct: Math.round(finding.deltaPct * 10000) / 10000,
        },
      });
    }

    return nextOrder;
  });

  if (touchedInventoryItemIds.size > 0) {
    await refreshOperationalState(purchaseOrder.locationId, [...touchedInventoryItemIds]);
  }

  return updatedOrder;
}

