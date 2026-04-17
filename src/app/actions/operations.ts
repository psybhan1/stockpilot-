"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Role } from "@/lib/domain-enums";
import { ChannelType, NotificationChannel, MovementType, SupplierOrderingMode } from "@/lib/prisma";
import type { Prisma } from "@/lib/prisma";

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

export async function updateAutoApproveThresholdAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const raw = String(formData.get("thresholdDollars") ?? "").trim();
  // Empty input = disable auto-approve. Otherwise must parse as a
  // non-negative dollar amount (cents is the storage unit).
  let cents: number | null;
  if (raw === "" || raw === "0") {
    cents = null;
  } else {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      // Silently no-op on bad input — the form accepts numeric only.
      return;
    }
    cents = Math.round(parsed * 100);
  }
  await db.location.update({
    where: { id: session.locationId },
    data: { autoApproveEmailUnderCents: cents },
  });
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

  // Actual costs come from the `actualCost-<lineId>` fields on the
  // ReceivePanel — they're dollar-denominated (so "12.45" → 1245
  // cents). Absent / blank / non-numeric values are dropped so the
  // PO line keeps its estimate.
  const actualUnitCostsCents: Record<string, number> = {};
  for (const line of purchaseOrder.lines) {
    const raw = formData.get(`actualCost-${line.id}`);
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    actualUnitCostsCents[line.id] = Math.round(parsed * 100);
  }

  const deliveredOrder = await deliverPurchaseOrder({
    purchaseOrderId: purchaseOrder.id,
    userId: session.userId,
    notes,
    lineReceipts,
    actualUnitCostsCents: Object.keys(actualUnitCostsCents).length > 0
      ? actualUnitCostsCents
      : undefined,
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

// ── Supplier website-login credentials ──────────────────────────────
// Manager pastes either a username+password OR a session-cookie JSON
// export, we encrypt with AES-256-GCM and store on Supplier.
// websiteCredentials. The browser ordering agent decrypts at PO
// dispatch time and either logs in or injects the cookies — see
// modules/automation/browser-agent.ts.

export async function setSupplierCredentialsAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const supplierId = String(formData.get("supplierId") ?? "");
  const kind = String(formData.get("credentialKind") ?? "password");

  if (!supplierId) {
    throw new Error("supplierId is required.");
  }

  await db.supplier.findFirstOrThrow({
    where: { id: supplierId, locationId: session.locationId },
    select: { id: true },
  });

  const { encryptSupplierCredentials, parseCookieJson } = await import(
    "@/modules/suppliers/website-credentials"
  );

  let encrypted: string;
  if (kind === "cookies") {
    const raw = String(formData.get("cookieJson") ?? "");
    const cookies = parseCookieJson(raw);
    encrypted = encryptSupplierCredentials({ kind: "cookies", cookies });
  } else {
    encrypted = encryptSupplierCredentials({
      kind: "password",
      username: String(formData.get("username") ?? ""),
      password: String(formData.get("password") ?? ""),
      loginUrl: readNullableStringValue(formData, "loginUrl") ?? undefined,
    });
  }

  await db.$transaction(async (tx) => {
    await tx.supplier.update({
      where: { id: supplierId },
      data: {
        websiteCredentials: encrypted,
        credentialsConfigured: true,
      },
    });
    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: "supplier.credentials_set",
      entityType: "supplier",
      entityId: supplierId,
      details: { kind },
    });
  });

  revalidateOperations();
  revalidatePath(`/suppliers/${supplierId}`);
}

export async function clearSupplierCredentialsAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const supplierId = String(formData.get("supplierId") ?? "");
  if (!supplierId) {
    throw new Error("supplierId is required.");
  }

  await db.supplier.findFirstOrThrow({
    where: { id: supplierId, locationId: session.locationId },
    select: { id: true },
  });

  await db.$transaction(async (tx) => {
    await tx.supplier.update({
      where: { id: supplierId },
      data: {
        websiteCredentials: null,
        credentialsConfigured: false,
      },
    });
    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: "supplier.credentials_cleared",
      entityType: "supplier",
      entityId: supplierId,
    });
  });

  revalidateOperations();
  revalidatePath(`/suppliers/${supplierId}`);
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

function smtpSettingsFromEmail(email: string): { host: string; port: number } {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com")
    return { host: "smtp.gmail.com", port: 587 };
  if (domain === "outlook.com" || domain === "hotmail.com" || domain === "live.com" || domain === "msn.com")
    return { host: "smtp-mail.outlook.com", port: 587 };
  if (domain === "yahoo.com" || domain === "ymail.com")
    return { host: "smtp.mail.yahoo.com", port: 587 };
  if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com")
    return { host: "smtp.mail.me.com", port: 587 };
  return { host: `smtp.${domain}`, port: 587 };
}

export async function connectSmtpEmailChannelAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);

  const email = String(formData.get("email") ?? "").trim();
  const pass = String(formData.get("password") ?? "").trim();

  if (!email || !pass) {
    redirect("/settings?channelConnect=error&channelType=email&channelDetail=Please+enter+your+email+and+password");
    return;
  }

  const { host, port } = smtpSettingsFromEmail(email);

  await connectSmtpEmailChannel(session.locationId, {
    host,
    port,
    secure: port === 465,
    user: email,
    pass,
    fromName: email,
    fromEmail: email,
  });

  revalidateOperations();
  redirect(`/settings?channelConnect=connected&channelType=email&channelDetail=${encodeURIComponent(email)}`);
}

export async function disconnectEmailChannelAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const provider = String(formData.get("provider") ?? "smtp");
  const channel = provider === "gmail" ? ChannelType.EMAIL_GMAIL : ChannelType.EMAIL_SMTP;
  await disconnectEmailChannel(session.locationId, channel);
  revalidateOperations();
  redirect("/settings?channelConnect=disconnected&channelType=email");
}


/**
 * Photo count: accepts a JSON string "counts" of
 * [{inventoryItemId, count}] from the camera flow and submits
 * each as a count entry on the current session.
 */
export async function applyPhotoCountsAction(formData: FormData) {
  const session = await requireSession(Role.STAFF);
  const raw = String(formData.get("counts") ?? "[]");
  let parsed: Array<{ inventoryItemId?: string; count?: number }> = [];
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return;

  let countSession = await db.stockCountSession.findFirst({
    where: { locationId: session.locationId, status: "IN_PROGRESS" },
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

  for (const entry of parsed) {
    if (!entry.inventoryItemId) continue;
    const n = Number(entry.count);
    if (!Number.isFinite(n) || n < 0) continue;
    try {
      await submitCountEntry({
        sessionId: countSession.id,
        inventoryItemId: String(entry.inventoryItemId),
        countedBase: Math.round(n),
        userId: session.userId,
        notes: "Applied via photo-count (vision)",
      });
    } catch (err) {
      console.warn("[applyPhotoCounts] failed for item", entry.inventoryItemId, err);
    }
  }

  revalidateOperations();
}

/**
 * CSV bulk import for inventory items. Accepts a "csv" form field —
 * a CSV string with header row. Columns we understand (others ignored):
 *   name, sku, category, baseUnit, displayUnit, packSize, par, onHand, supplierName
 *
 * Creates missing suppliers by name inline so a single paste can
 * bootstrap both items and their suppliers.
 */
export async function importInventoryCsvAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const csv = String(formData.get("csv") ?? "").trim();
  if (!csv) return;

  const rows = parseCsv(csv);
  if (rows.length < 2) return; // header + at least 1 data row
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  const nameIdx = idx("name");
  if (nameIdx < 0) return;

  const skuIdx = idx("sku");
  const categoryIdx = idx("category");
  const baseUnitIdx = idx("baseunit");
  const displayUnitIdx = idx("displayunit");
  const packSizeIdx = idx("packsize");
  const parIdx = idx("par");
  const onHandIdx = idx("onhand");
  const supplierIdx = idx("suppliername");

  const supplierCache = new Map<string, string>();
  let created = 0;
  let skipped = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[nameIdx] ?? "").trim();
    if (!name) {
      skipped += 1;
      continue;
    }
    const sku = (skuIdx >= 0 ? row[skuIdx] : "").trim() ||
      `IMP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const category = normaliseCategory((categoryIdx >= 0 ? row[categoryIdx] : "")) ?? "SUPPLY";
    const baseUnit = normaliseBaseUnit((baseUnitIdx >= 0 ? row[baseUnitIdx] : "")) ?? "COUNT";
    const displayUnit = normaliseMeasurementUnit((displayUnitIdx >= 0 ? row[displayUnitIdx] : "")) ?? "COUNT";
    const packSize = Math.max(1, Math.round(Number((packSizeIdx >= 0 ? row[packSizeIdx] : "1") || "1")));
    const par = Math.max(0, Math.round(Number((parIdx >= 0 ? row[parIdx] : "0") || "0")));
    const onHand = Math.max(0, Math.round(Number((onHandIdx >= 0 ? row[onHandIdx] : "0") || "0")));
    const supplierName = (supplierIdx >= 0 ? row[supplierIdx] : "").trim();

    let supplierId: string | null = null;
    if (supplierName) {
      const cached = supplierCache.get(supplierName.toLowerCase());
      if (cached) {
        supplierId = cached;
      } else {
        const existing = await db.supplier.findFirst({
          where: {
            locationId: session.locationId,
            name: { equals: supplierName, mode: "insensitive" },
          },
          select: { id: true },
        });
        if (existing) {
          supplierId = existing.id;
        } else {
          const created = await db.supplier.create({
            data: {
              locationId: session.locationId,
              name: supplierName,
              orderingMode: "EMAIL",
              leadTimeDays: 2,
            },
            select: { id: true },
          });
          supplierId = created.id;
        }
        supplierCache.set(supplierName.toLowerCase(), supplierId);
      }
    }

    try {
      await db.inventoryItem.create({
        data: {
          locationId: session.locationId,
          name,
          sku,
          category: category as Prisma.InventoryItemCreateInput["category"],
          baseUnit: baseUnit as Prisma.InventoryItemCreateInput["baseUnit"],
          displayUnit: displayUnit as Prisma.InventoryItemCreateInput["displayUnit"],
          countUnit: displayUnit as Prisma.InventoryItemCreateInput["countUnit"],
          purchaseUnit: displayUnit as Prisma.InventoryItemCreateInput["purchaseUnit"],
          packSizeBase: packSize,
          stockOnHandBase: onHand,
          parLevelBase: par,
          safetyStockBase: Math.max(1, Math.round(par * 0.2)),
          lowStockThresholdBase: Math.max(1, Math.round(par * 0.4)),
          primarySupplierId: supplierId,
        },
      });
      created += 1;
    } catch (err) {
      console.warn("[importInventoryCsv] failed to create", name, err);
      skipped += 1;
    }
  }

  revalidateOperations();
}

function parseCsv(input: string): string[][] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  return lines
    .filter((l) => l.trim().length > 0)
    .map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
}

function normaliseCategory(v: string): string | null {
  const k = v.trim().toUpperCase().replace(/\s+/g, "_");
  const allow = [
    "COFFEE",
    "DAIRY",
    "ALT_DAIRY",
    "SYRUP",
    "BAKERY_INGREDIENT",
    "PACKAGING",
    "CLEANING",
    "PAPER_GOODS",
    "RETAIL",
    "SEASONAL",
    "SUPPLY",
  ];
  return allow.includes(k) ? k : null;
}
function normaliseBaseUnit(v: string): string | null {
  const k = v.trim().toUpperCase();
  return ["GRAM", "MILLILITER", "COUNT"].includes(k) ? k : null;
}
function normaliseMeasurementUnit(v: string): string | null {
  const k = v.trim().toUpperCase();
  return [
    "GRAM",
    "KILOGRAM",
    "MILLILITER",
    "LITER",
    "COUNT",
    "CASE",
    "BOTTLE",
    "BAG",
    "BOX",
  ].includes(k)
    ? k
    : null;
}
