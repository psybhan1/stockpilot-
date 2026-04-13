"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Role } from "@/lib/domain-enums";
import { ChannelType, NotificationChannel, MovementType, SupplierOrderingMode } from "@/lib/prisma";

import { createAuditLogTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { toDeliveryDaysJson } from "@/lib/delivery-days";
import {
  AgentTaskStatus,
  BotChannel,
  JobType,
} from "@/lib/prisma";
import {
  acknowledgePurchaseOrder,
  approveRecommendation,
  cancelPurchaseOrder,
  deliverPurchaseOrder,
  deferRecommendation,
  markPurchaseOrderSent,
  rejectRecommendation,
} from "@/modules/purchasing/service";
import { ensureSquareIntegration, importSampleSales } from "@/modules/pos/service";
import { requireSession } from "@/modules/auth/session";
import { runPendingJobs } from "@/modules/jobs/dispatcher";
import {
  logWasteEntry,
  recordInventoryMovement,
  skipCountEntry,
  submitCountEntry,
} from "@/modules/inventory/ledger";
import {
  buildTelegramConnectUrl,
  buildWhatsAppConnectUrl,
  createBotConnectRequest,
  getTelegramBotUsername,
  isPublicAppUrl,
} from "@/modules/operator-bot/connect";
import {
  startTelegramChannelPairing,
  disconnectTelegramChannel,
  startWhatsAppChannelPairing,
  disconnectWhatsAppChannel,
  connectSmtpEmailChannel,
  disconnectEmailChannel,
} from "@/modules/channels/service";
import {
  buildTelegramOidcAuthorizationUrl,
  createTelegramOidcSession,
  getTelegramOidcCookieName,
  isTelegramOneTapReady,
} from "@/modules/operator-bot/telegram-oidc";
import {
  createFailureAlertTx,
  queueNotificationTx,
} from "@/modules/notifications/service";
import {
  getDefaultTestNotificationDraft,
  getSuggestedTestRecipient,
  validateNotificationRecipient,
} from "@/modules/notifications/channels";
import { sendManagerBotWelcomeMessages } from "@/modules/operator-bot/welcome";
import { ensureTelegramWebhook } from "@/lib/telegram-bot";

function revalidateOperations() {
  const paths = [
    "/dashboard",
    "/inventory",
    "/stock-count",
    "/recipes",
    "/pos-mapping",
    "/suppliers",
    "/purchase-orders",
    "/alerts",
    "/notifications",
    "/agent-tasks",
    "/settings",
  ];

  for (const path of paths) {
    revalidatePath(path);
  }
}

function revalidatePurchaseOrderPaths(purchaseOrderId: string, supplierId?: string | null) {
  revalidateOperations();
  revalidatePath(`/purchase-orders/${purchaseOrderId}`);

  if (supplierId) {
    revalidatePath(`/suppliers/${supplierId}`);
  }
}

export async function connectSquareAction() {
  const session = await requireSession(Role.MANAGER);
  const result = await ensureSquareIntegration(session.locationId, session.userId);
  if (result.requiresRedirect && result.authUrl) {
    redirect(result.authUrl);
  }
  await runPendingJobs(10);
  revalidateOperations();
}

export async function syncSalesAction() {
  const session = await requireSession(Role.MANAGER);
  const integration = await db.posIntegration.findFirstOrThrow({
    where: {
      locationId: session.locationId,
      provider: "SQUARE",
    },
  });
  await importSampleSales(integration.id, session.userId);
  revalidateOperations();
}

export async function runJobsAction() {
  await requireSession(Role.SUPERVISOR);
  await runPendingJobs(25);
  revalidateOperations();
}

export async function approveRecipeAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const recipeId = String(formData.get("recipeId") ?? "");

  const recipe = await db.recipe.findUniqueOrThrow({
    where: { id: recipeId },
    include: {
      components: true,
      mappings: true,
    },
  });

  await db.$transaction(async (tx) => {
    for (const component of recipe.components) {
      const nextQuantity = Number(formData.get(`component-${component.id}`) ?? component.quantityBase);
      await tx.recipeComponent.update({
        where: { id: component.id },
        data: {
          quantityBase: Number.isFinite(nextQuantity) ? Math.round(nextQuantity) : component.quantityBase,
        },
      });
    }

    await tx.recipe.update({
      where: { id: recipe.id },
      data: {
        status: "APPROVED",
        approvedById: session.userId,
        approvedAt: new Date(),
        completenessScore: 0.94,
        confidenceScore: 0.86,
      },
    });

    await tx.posVariationMapping.updateMany({
      where: { recipeId: recipe.id },
      data: {
        mappingStatus: "READY",
      },
    });

    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: "recipe.approved",
      entityType: "recipe",
      entityId: recipe.id,
    });
  });

  revalidateOperations();
  redirect(`/recipes/${recipe.id}`);
}

export async function updatePosMappingAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const mappingId = String(formData.get("mappingId") ?? "");
  const requestedMenuItemVariantId = String(formData.get("menuItemVariantId") ?? "");
  const requestedRecipeId = String(formData.get("recipeId") ?? "");
  const requestedStatus = String(formData.get("mappingStatus") ?? "NEEDS_REVIEW");
  const requestedPackagingMode = String(formData.get("packagingMode") ?? "");
  const notes = String(formData.get("notes") ?? "");

  const mapping = await db.posVariationMapping.findFirstOrThrow({
    where: {
      id: mappingId,
      locationId: session.locationId,
    },
  });

  let nextMenuItemVariantId = requestedMenuItemVariantId || mapping.menuItemVariantId;
  const nextRecipeId: string | null = requestedRecipeId || null;
  let nextStatus = requestedStatus;

  if (nextRecipeId) {
    const recipe = await db.recipe.findFirstOrThrow({
      where: {
        id: nextRecipeId,
        locationId: session.locationId,
      },
    });

    nextMenuItemVariantId = recipe.menuItemVariantId;
    nextStatus = recipe.status === "APPROVED" && requestedStatus === "READY"
      ? "READY"
      : recipe.status === "APPROVED"
      ? requestedStatus
      : "RECIPE_DRAFT";
  } else if (requestedStatus === "READY" || requestedStatus === "RECIPE_DRAFT") {
    nextStatus = "NEEDS_REVIEW";
  }

  await db.$transaction(async (tx) => {
    await tx.posVariationMapping.update({
      where: {
        id: mapping.id,
      },
      data: {
        menuItemVariantId: nextMenuItemVariantId,
        recipeId: nextRecipeId,
        mappingStatus: nextStatus as "UNMAPPED" | "RECIPE_DRAFT" | "READY" | "NEEDS_REVIEW",
        packagingMode: requestedPackagingMode
          ? (requestedPackagingMode as "TO_GO" | "DINE_IN")
          : null,
        notes: notes.trim() || null,
      },
    });

    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: "posMapping.updated",
      entityType: "posVariationMapping",
      entityId: mapping.id,
      details: {
        menuItemVariantId: nextMenuItemVariantId,
        recipeId: nextRecipeId,
        mappingStatus: nextStatus,
        packagingMode: requestedPackagingMode || null,
      },
    });
  });

  revalidateOperations();
  revalidatePath(`/pos-mapping/${mapping.id}`);
}

export async function approveRecommendationAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const recommendationId = String(formData.get("recommendationId") ?? "");
  const recommendedPackCount = Number(formData.get("recommendedPackCount") ?? 0);

  const purchaseOrder = await approveRecommendation(
    recommendationId,
    session.userId,
    recommendedPackCount
  );
  revalidatePurchaseOrderPaths(purchaseOrder.id, purchaseOrder.supplierId);
}

export async function deferRecommendationAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const recommendationId = String(formData.get("recommendationId") ?? "");

  await deferRecommendation(recommendationId, session.userId);
  revalidateOperations();
}

export async function rejectRecommendationAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const recommendationId = String(formData.get("recommendationId") ?? "");

  await rejectRecommendation(recommendationId, session.userId);
  revalidateOperations();
}

export async function submitCountAction(formData: FormData) {
  const session = await requireSession(Role.STAFF);
  const inventoryItemId = String(formData.get("inventoryItemId") ?? "");
  const countedBase = Number(formData.get("countedBase") ?? 0);
  const notes = String(formData.get("notes") ?? "");
  const entryMode = String(formData.get("entryMode") ?? "COUNT");

  let countSession = await db.stockCountSession.findFirst({
    where: {
      locationId: session.locationId,
      status: "IN_PROGRESS",
    },
    orderBy: { startedAt: "desc" },
  });

  if (!countSession) {
    countSession = await db.stockCountSession.create({
      data: {
        locationId: session.locationId,
        createdById: session.userId,
        status: "IN_PROGRESS",
        mode: "SWIPE",
      },
    });
  }

  if (entryMode === "SKIP") {
    await skipCountEntry({
      sessionId: countSession.id,
      inventoryItemId,
      userId: session.userId,
      notes,
    });
  } else if (entryMode === "WASTE") {
    await logWasteEntry({
      sessionId: countSession.id,
      inventoryItemId,
      wastedBase: Number.isFinite(countedBase) ? countedBase : 0,
      userId: session.userId,
      notes,
    });
  } else {
    await submitCountEntry({
      sessionId: countSession.id,
      inventoryItemId,
      countedBase: Number.isFinite(countedBase) ? countedBase : 0,
      userId: session.userId,
      notes,
    });
  }

  revalidateOperations();
}

export async function acknowledgeAlertAction(formData: FormData) {
  const session = await requireSession(Role.SUPERVISOR);
  const alertId = String(formData.get("alertId") ?? "");

  await db.$transaction(async (tx) => {
    await tx.alert.update({
      where: { id: alertId },
      data: {
        status: "ACKNOWLEDGED",
      },
    });

    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: "alert.acknowledged",
      entityType: "alert",
      entityId: alertId,
    });
  });

  revalidateOperations();
}

export async function resolveAlertAction(formData: FormData) {
  const session = await requireSession(Role.SUPERVISOR);
  const alertId = String(formData.get("alertId") ?? "");

  await db.$transaction(async (tx) => {
    await tx.alert.update({
      where: { id: alertId },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
      },
    });

    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: "alert.resolved",
      entityType: "alert",
      entityId: alertId,
    });
  });

  revalidateOperations();
}

export async function retryNotificationAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const notificationId = String(formData.get("notificationId") ?? "");

  const notification = await db.notification.findFirstOrThrow({
    where: {
      id: notificationId,
      locationId: session.locationId,
    },
  });

  await db.$transaction(async (tx) => {
    await tx.notification.update({
      where: { id: notification.id },
      data: {
        status: "QUEUED",
        sentAt: null,
      },
    });

    await tx.jobRun.create({
      data: {
        locationId: session.locationId,
        type: "SEND_EMAIL",
        payload: {
          notificationId: notification.id,
        },
      },
    });

    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: "notification.requeued",
      entityType: "notification",
      entityId: notification.id,
      details: {
        recipient: notification.recipient,
        channel: notification.channel,
      },
    });
  });

  revalidateOperations();
}

export async function queueTestNotificationAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const channelKey = String(formData.get("channel") ?? "EMAIL") as
    | "EMAIL"
    | "PUSH"
    | "WHATSAPP";
  const channel = NotificationChannel[channelKey];
  const defaultDraft = getDefaultTestNotificationDraft(channel);
  const recipient =
    readStringValue(formData, "recipient") ??
    getSuggestedTestRecipient({
      channel,
      sessionEmail: session.email,
      expoTestPushToken: env.EXPO_TEST_PUSH_TOKEN,
      twilioTestWhatsappTo: env.TWILIO_TEST_WHATSAPP_TO,
    });
  const subject = readStringValue(formData, "subject") ?? defaultDraft.subject;
  const body = readStringValue(formData, "body") ?? defaultDraft.body;

  const recipientError = validateNotificationRecipient(channel, recipient);
  if (recipientError) {
    redirect(`/notifications?error=${encodeURIComponent(recipientError)}`);
  }

  await db.$transaction(async (tx) => {
    const { notification } = await queueNotificationTx(tx, {
      locationId: session.locationId,
      channel,
      recipient,
      subject,
      body,
    });

    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: "notification.test_queued",
      entityType: "notification",
      entityId: notification.id,
      details: {
        channel: channelKey,
        recipient,
      },
    });
  });

  revalidateOperations();
  redirect(`/notifications?queued=${encodeURIComponent(channelKey.toLowerCase())}`);
}

export async function dispatchAgentTaskAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const taskId = String(formData.get("taskId") ?? "");

  const task = await db.agentTask.findFirstOrThrow({
    where: {
      id: taskId,
      locationId: session.locationId,
    },
  });

  if (task.type !== "WEBSITE_ORDER_PREP") {
    throw new Error("Only website-order prep tasks can be re-dispatched.");
  }

  await db.$transaction(async (tx) => {
    await tx.agentTask.update({
      where: { id: task.id },
      data: {
        status: AgentTaskStatus.PENDING,
      },
    });

    await tx.jobRun.create({
      data: {
        locationId: session.locationId,
        type: JobType.PREPARE_WEBSITE_ORDER,
        payload: {
          taskId: task.id,
          queuedById: session.userId,
        },
      },
    });

    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: "agentTask.dispatch_queued",
      entityType: "agentTask",
      entityId: task.id,
    });
  });

  revalidateOperations();
}

export async function completeAgentTaskAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const taskId = String(formData.get("taskId") ?? "");

  let purchaseOrderId: string | null = null;
  let purchaseOrderSupplierId: string | null = null;

  await db.$transaction(async (tx) => {
    const task = await tx.agentTask.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
      },
    });

    purchaseOrderId = task.purchaseOrderId;

    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: "agentTask.completed",
      entityType: "agentTask",
      entityId: taskId,
    });
  });

  if (purchaseOrderId) {
    const currentPurchaseOrder = await db.purchaseOrder.findUnique({
      where: {
        id: purchaseOrderId,
      },
      select: {
        id: true,
        status: true,
        supplierId: true,
      },
    });

    purchaseOrderSupplierId = currentPurchaseOrder?.supplierId ?? null;

    if (currentPurchaseOrder?.status === "APPROVED") {
      const purchaseOrder = await markPurchaseOrderSent(
        purchaseOrderId,
        session.userId,
        "Manager approved the website ordering workflow and marked the order as sent."
      );
      purchaseOrderSupplierId = purchaseOrder.supplierId;
    }
  }

  revalidateOperations();

  if (purchaseOrderId) {
    revalidatePurchaseOrderPaths(purchaseOrderId, purchaseOrderSupplierId);
  }
}

export async function failAgentTaskAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const taskId = String(formData.get("taskId") ?? "");
  const notes = String(formData.get("notes") ?? "");

  await db.$transaction(async (tx) => {
    const task = await tx.agentTask.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        output: {
          completedBy: session.userId,
          completedAt: new Date().toISOString(),
          resolution: notes || "Manager marked the task as failed.",
        },
      },
    });

    if (task.purchaseOrderId) {
      await tx.purchaseOrder.update({
        where: { id: task.purchaseOrderId },
        data: {
          status: "FAILED",
          notes: notes.trim() || "Website or automation-assisted ordering workflow failed.",
        },
      });
    }

    await createFailureAlertTx(tx, {
      locationId: session.locationId,
      title: `${task.title} failed`,
      message: notes || task.description,
      metadata: {
        agentTaskId: task.id,
        purchaseOrderId: task.purchaseOrderId,
      },
    });

    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: "agentTask.failed",
      entityType: "agentTask",
      entityId: taskId,
    });
  });

  revalidateOperations();
}

export async function markPurchaseOrderSentAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const purchaseOrderId = String(formData.get("purchaseOrderId") ?? "");
  const notes = String(formData.get("notes") ?? "");

  const purchaseOrder = await markPurchaseOrderSent(purchaseOrderId, session.userId, notes);
  revalidatePurchaseOrderPaths(purchaseOrder.id, purchaseOrder.supplierId);
}

export async function acknowledgePurchaseOrderAction(formData: FormData) {
  const session = await requireSession(Role.SUPERVISOR);
  const purchaseOrderId = String(formData.get("purchaseOrderId") ?? "");
  const notes = String(formData.get("notes") ?? "");

  const purchaseOrder = await acknowledgePurchaseOrder(purchaseOrderId, session.userId, notes);
  revalidatePurchaseOrderPaths(purchaseOrder.id, purchaseOrder.supplierId);
}

export async function deliverPurchaseOrderAction(formData: FormData) {
  const session = await requireSession(Role.SUPERVISOR);
  const purchaseOrderId = String(formData.get("purchaseOrderId") ?? "");
  const notes = String(formData.get("notes") ?? "");

  const purchaseOrder = await db.purchaseOrder.findFirstOrThrow({
    where: {
      id: purchaseOrderId,
      locationId: session.locationId,
    },
    include: {
      lines: true,
    },
  });

  const lineReceipts = Object.fromEntries(
    purchaseOrder.lines.map((line) => [
      line.id,
      Number(formData.get(`received-${line.id}`) ?? line.quantityOrdered),
    ])
  );

  const deliveredOrder = await deliverPurchaseOrder({
    purchaseOrderId: purchaseOrder.id,
    userId: session.userId,
    notes,
    lineReceipts,
  });

  revalidatePurchaseOrderPaths(deliveredOrder.id, deliveredOrder.supplierId);
}

export async function cancelPurchaseOrderAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const purchaseOrderId = String(formData.get("purchaseOrderId") ?? "");
  const notes = String(formData.get("notes") ?? "");

  const purchaseOrder = await cancelPurchaseOrder(purchaseOrderId, session.userId, notes);
  revalidatePurchaseOrderPaths(purchaseOrder.id, purchaseOrder.supplierId);
}

export async function updateInventoryItemAction(formData: FormData) {
  const session = await requireSession(Role.SUPERVISOR);
  const itemId = String(formData.get("itemId") ?? "");

  const item = await db.inventoryItem.findFirstOrThrow({
    where: {
      id: itemId,
      locationId: session.locationId,
    },
  });

  await db.$transaction(async (tx) => {
    await tx.inventoryItem.update({
      where: {
        id: item.id,
      },
      data: {
        name: readStringValue(formData, "name") ?? item.name,
        storageLocation: readNullableStringValue(formData, "storageLocation"),
        sublocation: readNullableStringValue(formData, "sublocation"),
        parLevelBase: readIntegerValue(formData, "parLevelBase", item.parLevelBase),
        lowStockThresholdBase: readIntegerValue(
          formData,
          "lowStockThresholdBase",
          item.lowStockThresholdBase
        ),
        safetyStockBase: readIntegerValue(formData, "safetyStockBase", item.safetyStockBase),
        leadTimeDays: readIntegerValue(formData, "leadTimeDays", item.leadTimeDays),
        minimumOrderQuantity: readIntegerValue(
          formData,
          "minimumOrderQuantity",
          item.minimumOrderQuantity
        ),
        packSizeBase: readIntegerValue(formData, "packSizeBase", item.packSizeBase),
        latestCostNote: readNullableStringValue(formData, "latestCostNote"),
        notes: readNullableStringValue(formData, "notes"),
        confidenceScore: readFloatValue(formData, "confidenceScore", item.confidenceScore),
        primarySupplierId: readNullableStringValue(formData, "primarySupplierId"),
      },
    });

    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: "inventory.profile_updated",
      entityType: "inventoryItem",
      entityId: item.id,
    });
  });

  revalidateOperations();
  revalidatePath(`/inventory/${item.id}`);
}

export async function recordInventoryMovementAction(formData: FormData) {
  const session = await requireSession(Role.SUPERVISOR);
  const inventoryItemId = String(formData.get("inventoryItemId") ?? "");
  const movementType = String(formData.get("movementType") ?? MovementType.CORRECTION) as MovementType;
  const quantityBase = readIntegerValue(formData, "quantityBase", 0);
  const notes = readNullableStringValue(formData, "notes");

  const quantityDeltaBase = normalizeMovementDelta(movementType, quantityBase);

  if (quantityDeltaBase === 0) {
    return;
  }

  await recordInventoryMovement({
    locationId: session.locationId,
    inventoryItemId,
    movementType,
    quantityDeltaBase,
    userId: session.userId,
    notes: notes ?? undefined,
  });

  revalidateOperations();
  revalidatePath(`/inventory/${inventoryItemId}`);
}

export async function upsertSupplierAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const supplierId = readNullableStringValue(formData, "supplierId");
  const deliveryDays = readDeliveryDays(formData, "deliveryDay");
  const payload = {
    name: readStringValue(formData, "name") ?? "Unnamed supplier",
    contactName: readNullableStringValue(formData, "contactName"),
    email: readNullableStringValue(formData, "email"),
    phone: readNullableStringValue(formData, "phone"),
    website: readNullableStringValue(formData, "website"),
    orderingMode: (readStringValue(formData, "orderingMode") ??
      SupplierOrderingMode.EMAIL) as SupplierOrderingMode,
    leadTimeDays: readIntegerValue(formData, "leadTimeDays", 0),
    minimumOrderQuantity: readIntegerValue(formData, "minimumOrderQuantity", 1),
    deliveryDays: toDeliveryDaysJson(deliveryDays),
    notes: readNullableStringValue(formData, "notes"),
    credentialsConfigured: formData.get("credentialsConfigured") === "on",
  };

  if (supplierId) {
    await db.supplier.findFirstOrThrow({
      where: {
        id: supplierId,
        locationId: session.locationId,
      },
      select: {
        id: true,
      },
    });
  }

  const supplier = supplierId
    ? await db.$transaction(async (tx) => {
        const updatedSupplier = await tx.supplier.update({
          where: {
            id: supplierId,
          },
          data: payload,
        });

        await createAuditLogTx(tx, {
          locationId: session.locationId,
          userId: session.userId,
          action: "supplier.updated",
          entityType: "supplier",
          entityId: updatedSupplier.id,
        });

        return updatedSupplier;
      })
    : await db.$transaction(async (tx) => {
        const createdSupplier = await tx.supplier.create({
          data: {
            locationId: session.locationId,
            ...payload,
          },
        });

        await createAuditLogTx(tx, {
          locationId: session.locationId,
          userId: session.userId,
          action: "supplier.created",
          entityType: "supplier",
          entityId: createdSupplier.id,
        });

        return createdSupplier;
      });

  revalidateOperations();
  revalidatePath(`/suppliers/${supplier.id}`);
}

export async function upsertSupplierItemAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const supplierId = String(formData.get("supplierId") ?? "");
  const supplierItemId = readNullableStringValue(formData, "supplierItemId");
  const inventoryItemId = String(formData.get("inventoryItemId") ?? "");
  const preferred = formData.get("preferred") === "on";
  const deliveryDays = readDeliveryDays(formData, "supplierItemDeliveryDay");

  const payload = {
    supplierSku: readNullableStringValue(formData, "supplierSku"),
    packSizeBase: readIntegerValue(formData, "packSizeBase", 1),
    minimumOrderQuantity: readIntegerValue(formData, "minimumOrderQuantity", 1),
    lastUnitCostCents: readNullableIntegerValue(formData, "lastUnitCostCents"),
    priceNotes: readNullableStringValue(formData, "priceNotes"),
    preferred,
    leadTimeDays: readNullableIntegerValue(formData, "leadTimeDays"),
    deliveryDays: toDeliveryDaysJson(deliveryDays),
  };

  await Promise.all([
    db.supplier.findFirstOrThrow({
      where: {
        id: supplierId,
        locationId: session.locationId,
      },
      select: {
        id: true,
      },
    }),
    db.inventoryItem.findFirstOrThrow({
      where: {
        id: inventoryItemId,
        locationId: session.locationId,
      },
      select: {
        id: true,
      },
    }),
  ]);

  if (supplierItemId) {
    await db.supplierItem.findFirstOrThrow({
      where: {
        id: supplierItemId,
        supplier: {
          locationId: session.locationId,
        },
      },
      select: {
        id: true,
      },
    });
  }

  await db.$transaction(async (tx) => {
    if (preferred) {
      await tx.supplierItem.updateMany({
        where: {
          inventoryItemId,
        },
        data: {
          preferred: false,
        },
      });
    }

    const supplierItem = supplierItemId
      ? await tx.supplierItem.update({
          where: {
            id: supplierItemId,
          },
          data: payload,
        })
      : await tx.supplierItem.upsert({
          where: {
            supplierId_inventoryItemId: {
              supplierId,
              inventoryItemId,
            },
          },
          update: payload,
          create: {
            supplierId,
            inventoryItemId,
            ...payload,
          },
        });

    if (preferred) {
      await tx.inventoryItem.update({
        where: {
          id: inventoryItemId,
        },
        data: {
          primarySupplierId: supplierId,
        },
      });
    }

    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: "supplierItem.upserted",
      entityType: "supplierItem",
      entityId: supplierItem.id,
      details: {
        supplierId,
        inventoryItemId,
        preferred,
      },
    });
  });

  revalidateOperations();
  revalidatePath(`/suppliers/${supplierId}`);
  revalidatePath(`/inventory/${inventoryItemId}`);
}

export async function startWhatsAppBotConnectAction() {
  const session = await requireSession(Role.MANAGER);

  if (!env.TWILIO_WHATSAPP_FROM) {
    redirect(
      `/settings?channelConnect=error&channelType=whatsapp&channelDetail=${encodeURIComponent(
        "WhatsApp is not configured yet. Ask your admin to add TWILIO_WHATSAPP_FROM."
      )}`
    );
  }

  const request = await createBotConnectRequest({
    userId: session.userId,
    locationId: session.locationId,
    channel: BotChannel.WHATSAPP,
  });

  // Opens WhatsApp directly with the connect message pre-filled — user just taps Send
  redirect(buildWhatsAppConnectUrl(env.TWILIO_WHATSAPP_FROM, request.token));
}

export async function startTelegramBotConnectAction() {
  const session = await requireSession(Role.MANAGER);

  if (!isPublicAppUrl(env.APP_URL)) {
    redirect(
      `/settings?channelConnect=error&channelType=telegram&channelDetail=${encodeURIComponent(
        "Production chat linking needs a public HTTPS APP_URL."
      )}`
    );
  }

  if (isTelegramOneTapReady()) {
    const request = await createBotConnectRequest({
      userId: session.userId,
      locationId: session.locationId,
      channel: BotChannel.TELEGRAM,
    });
    const oidcSession = createTelegramOidcSession(request.token);
    const cookieStore = await cookies();
    cookieStore.set(getTelegramOidcCookieName(), oidcSession.cookieValue, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/bot/telegram/oidc/callback",
      maxAge: 15 * 60,
    });

    redirect(
      buildTelegramOidcAuthorizationUrl({
        state: request.token,
        codeChallenge: oidcSession.codeChallenge,
      })
    );
  }

  if (!env.TELEGRAM_BOT_TOKEN) {
    redirect(
      `/settings?channelConnect=error&channelType=telegram&channelDetail=${encodeURIComponent(
        "Telegram bot token is missing."
      )}`
    );
  }

  const request = await createBotConnectRequest({
    userId: session.userId,
    locationId: session.locationId,
    channel: BotChannel.TELEGRAM,
  });

  const webhook = await ensureTelegramWebhook();

  if (!webhook.ok) {
    redirect(
      `/settings?channelConnect=error&channelType=telegram&channelDetail=${encodeURIComponent(
        webhook.reason
      )}`
    );
  }

  redirect(`/settings/telegram/connect?token=${encodeURIComponent(request.token)}`);
}

export async function startLocalWhatsAppBotConnectAction() {
  const session = await requireSession(Role.MANAGER);

  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_WHATSAPP_FROM) {
    redirect(
      `/settings?channelConnect=error&channelType=whatsapp&channelDetail=${encodeURIComponent(
        "Twilio WhatsApp credentials are still missing."
      )}`
    );
  }

  const request = await createBotConnectRequest({
    userId: session.userId,
    locationId: session.locationId,
    channel: BotChannel.WHATSAPP,
  });

  redirect(buildWhatsAppConnectUrl(env.TWILIO_WHATSAPP_FROM, request.token));
}

export async function startLocalTelegramBotConnectAction() {
  const session = await requireSession(Role.MANAGER);
  const telegramBotUsername = await getTelegramBotUsername();

  if (!env.TELEGRAM_BOT_TOKEN || !telegramBotUsername) {
    redirect(
      `/settings?channelConnect=error&channelType=telegram&channelDetail=${encodeURIComponent(
        "Telegram bot credentials are missing or the bot username could not be resolved."
      )}`
    );
  }

  const request = await createBotConnectRequest({
    userId: session.userId,
    locationId: session.locationId,
    channel: BotChannel.TELEGRAM,
  });

  redirect(buildTelegramConnectUrl(telegramBotUsername, request.token));
}

export async function disconnectBotChannelAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const channel = String(formData.get("channel") ?? "").toUpperCase();

  if (channel !== BotChannel.WHATSAPP && channel !== BotChannel.TELEGRAM) {
    redirect(
      `/settings?channelConnect=error&channelDetail=${encodeURIComponent(
        "Unknown channel."
      )}`
    );
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: {
        id: session.userId,
      },
      data:
        channel === BotChannel.WHATSAPP
          ? {
              phoneNumber: null,
            }
          : {
              telegramChatId: null,
              telegramUsername: null,
            },
    });

    await tx.botConnectRequest.updateMany({
      where: {
        userId: session.userId,
        channel,
        consumedAt: null,
      },
      data: {
        consumedAt: new Date(),
      },
    });

    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: "bot.disconnect",
      entityType: "user",
      entityId: session.userId,
      details: {
        channel,
      },
    });
  });

  revalidateOperations();
  redirect(`/settings?channelConnect=disconnected&channelType=${channel.toLowerCase()}`);
}

export async function updateBotIdentityAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const phoneNumber = normalizePhoneNumber(readNullableStringValue(formData, "phoneNumber"));
  const telegramChatId = readNullableStringValue(formData, "telegramChatId");
  const telegramUsername = normalizeTelegramUsername(
    readNullableStringValue(formData, "telegramUsername")
  );

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: {
        id: session.userId,
      },
      data: {
        phoneNumber,
        telegramChatId,
        telegramUsername,
      },
    });

    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: "user.bot_identity_updated",
      entityType: "user",
      entityId: session.userId,
    });
  });

  revalidateOperations();
  const welcomeResults = await sendManagerBotWelcomeMessages({
    userName: session.userName,
    phoneNumber,
    telegramChatId,
  });

  redirect(
    `/settings?bot=updated&botWhatsapp=${encodeURIComponent(
      welcomeResults.whatsapp.status
    )}&botWhatsappDetail=${encodeURIComponent(
      welcomeResults.whatsapp.detail ?? ""
    )}&botTelegram=${encodeURIComponent(
      welcomeResults.telegram.status
    )}&botTelegramDetail=${encodeURIComponent(welcomeResults.telegram.detail ?? "")}`
  );
}

function readStringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNullableStringValue(formData: FormData, key: string) {
  return readStringValue(formData, key);
}

function readIntegerValue(formData: FormData, key: string, fallback: number) {
  const value = Number(formData.get(key));
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function readNullableIntegerValue(formData: FormData, key: string) {
  const value = Number(formData.get(key));
  return Number.isFinite(value) ? Math.round(value) : null;
}

function readFloatValue(formData: FormData, key: string, fallback: number) {
  const value = Number(formData.get(key));
  return Number.isFinite(value) ? Math.min(0.99, Math.max(0.1, value)) : fallback;
}

function readDeliveryDays(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6);
}

function normalizeMovementDelta(movementType: MovementType, quantityBase: number) {
  const normalizedQuantity = Math.round(quantityBase);

  switch (movementType) {
    case MovementType.RECEIVING:
    case MovementType.RETURN:
      return Math.abs(normalizedQuantity);
    case MovementType.BREAKAGE:
    case MovementType.WASTE:
    case MovementType.TRANSFER:
      return -1 * Math.abs(normalizedQuantity);
    case MovementType.CORRECTION:
    default:
      return normalizedQuantity;
  }
}

function normalizePhoneNumber(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[^\d+]/g, "");
  if (!normalized) {
    return null;
  }

  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

function normalizeTelegramUsername(value: string | null) {
  if (!value) {
    return null;
  }

  return value.startsWith("@") ? value : `@${value}`;
}

// ---------------------------------------------------------------------------
// Location channel actions
// ---------------------------------------------------------------------------

/**
 * Generates a 15-min Telegram pairing code for the current location.
 * Redirects back to /settings with the code in the URL for display.
 */
export async function generateTelegramChannelCodeAction() {
  const session = await requireSession(Role.MANAGER);
  const { code, expiresAt } = await startTelegramChannelPairing(session.locationId);
  redirect(
    `/settings?channelCode=${encodeURIComponent(code)}&channelCodeExpiry=${encodeURIComponent(expiresAt.toISOString())}&channel=telegram`
  );
}

export async function disconnectTelegramChannelAction() {
  const session = await requireSession(Role.MANAGER);
  await disconnectTelegramChannel(session.locationId);
  revalidateOperations();
  redirect("/settings?channelConnect=disconnected&channelType=telegram");
}

export async function generateWhatsAppChannelCodeAction() {
  const session = await requireSession(Role.MANAGER);

  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_WHATSAPP_FROM) {
    redirect(
      `/settings?channelConnect=error&channelType=whatsapp&channelDetail=${encodeURIComponent(
        "Twilio WhatsApp credentials are not configured."
      )}`
    );
  }

  const { code, expiresAt } = await startWhatsAppChannelPairing(session.locationId);
  redirect(
    `/settings?channelCode=${encodeURIComponent(code)}&channelCodeExpiry=${encodeURIComponent(expiresAt.toISOString())}&channel=whatsapp`
  );
}

export async function disconnectWhatsAppChannelAction() {
  const session = await requireSession(Role.MANAGER);
  await disconnectWhatsAppChannel(session.locationId);
  revalidateOperations();
  redirect("/settings?channelConnect=disconnected&channelType=whatsapp");
}

export async function connectSmtpEmailChannelAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);

  const host = String(formData.get("smtp_host") ?? "").trim();
  const port = Number(formData.get("smtp_port") ?? 587);
  const user = String(formData.get("smtp_user") ?? "").trim();
  const pass = String(formData.get("smtp_pass") ?? "").trim();
  const fromName = String(formData.get("smtp_from_name") ?? "").trim();
  const fromEmail = String(formData.get("smtp_from_email") ?? "").trim();

  if (!host || !user || !pass || !fromEmail) {
    redirect("/settings?channelConnect=error&channelType=email&channelDetail=Missing+required+SMTP+fields");
    return;
  }

  await connectSmtpEmailChannel(session.locationId, {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure: port === 465,
    user,
    pass,
    fromName: fromName || fromEmail,
    fromEmail,
  });

  revalidateOperations();
  redirect(`/settings?channelConnect=connected&channelType=email&channelDetail=${encodeURIComponent(fromEmail)}`);
}

export async function disconnectEmailChannelAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const provider = String(formData.get("provider") ?? "smtp");
  const channel = provider === "gmail" ? ChannelType.EMAIL_GMAIL : ChannelType.EMAIL_SMTP;
  await disconnectEmailChannel(session.locationId, channel);
  revalidateOperations();
  redirect("/settings?channelConnect=disconnected&channelType=email");
}

