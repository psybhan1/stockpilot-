import {
  PurchaseOrderStatus,
  RecommendationStatus,
  Role,
  SupplierOrderingMode,
  MovementType,
  AgentTaskStatus,
  AgentTaskType,
  CommunicationDirection,
  CommunicationStatus,
  AlertStatus,
  AlertType,
  BotChannel,
} from "@/lib/prisma";
import type { Prisma } from "@/lib/prisma";
import type { BotConversationTurn, BotPendingContext } from "@/providers/contracts";

import { createAuditLogTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { formatQuantityBase } from "@/modules/inventory/units";
import { convertDisplayToBase } from "@/modules/inventory/units";
import { postStockMovementTx, refreshOperationalState } from "@/modules/inventory/ledger";
import { enqueueJobTx } from "@/modules/jobs/dispatcher";
import { calculateRestockToParOrder } from "@/modules/operator-bot/order";
import { parseManagerRestockMessage } from "@/modules/operator-bot/parser";
import {
  completeBotMessageReceipt,
  failBotMessageReceipt,
  reserveBotMessageReceipt,
} from "@/modules/operator-bot/receipts";
import { getAiProvider } from "@/providers/ai-provider";
import { getBotLanguageProvider } from "@/providers/bot-language-provider";
import { getSupplierOrderProvider } from "@/providers/supplier-order-provider";

export type ManagerBotChannel = "WHATSAPP" | "TELEGRAM";

type InboundManagerBotMessage = {
  channel: ManagerBotChannel;
  senderId: string;
  senderDisplayName?: string | null;
  text: string;
  sourceMessageId?: string | null;
  rawPayload?: Prisma.InputJsonValue;
};

type BotHandlingResult = {
  ok: boolean;
  reply: string;
  purchaseOrderId?: string | null;
  orderNumber?: string | null;
  replyScenario?: string;
  replyFacts?: Record<string, unknown>;
  skipSend?: boolean;
};

export async function handleInboundManagerBotMessage(
  input: InboundManagerBotMessage
): Promise<BotHandlingResult> {
  const receipt = await reserveBotMessageReceipt({
    channel: toBotChannel(input.channel),
    externalMessageId: input.sourceMessageId ?? null,
    senderId: input.senderId,
    senderDisplayName: input.senderDisplayName ?? null,
    inboundText: input.text,
    rawPayload: input.rawPayload,
  });

  if (receipt.kind === "duplicate") {
    return {
      ok: true,
      reply: receipt.reply ?? "",
      purchaseOrderId: receipt.purchaseOrderId ?? null,
      orderNumber: receipt.orderNumber ?? null,
      replyScenario: "duplicate",
      skipSend: receipt.skipSend,
    };
  }

  const receiptId = receipt.kind === "new" ? receipt.receiptId : null;
  let managerContext:
    | {
        locationId: string;
        userId: string;
      }
    | null = null;

  try {
    managerContext = await findManagerContext(input.channel, input.senderId);

    if (!managerContext) {
      const result = {
        ok: false,
        reply:
          "I couldn't match this sender to a manager account yet. Open StockPilot settings and use the Connect WhatsApp or Connect Telegram button first.",
        replyScenario: "unlinked",
      } satisfies BotHandlingResult;

      await db.auditLog.create({
        data: {
          action: "bot.inbound_unlinked",
          entityType: "botChannel",
          entityId: input.sourceMessageId ?? input.channel.toLowerCase(),
          details: {
            senderId: input.senderId,
            senderDisplayName: input.senderDisplayName ?? null,
            text: input.text,
          },
        },
      });

      await completeBotMessageReceipt({
        receiptId,
        reply: result.reply,
        metadata: toInputJsonValue({
          channel: input.channel,
          replyScenario: result.replyScenario,
        }),
      });

      return result;
    }

    await db.auditLog.create({
      data: {
        locationId: managerContext.locationId,
        userId: managerContext.userId,
        action: "bot.inbound_received",
        entityType: "botChannel",
        entityId: input.sourceMessageId ?? `${input.channel.toLowerCase()}-message`,
        details: {
          channel: input.channel,
          senderId: input.senderId,
          senderDisplayName: input.senderDisplayName ?? null,
          text: input.text,
          rawPayload: input.rawPayload ?? null,
        },
      },
    });

    const inventoryChoices = await db.inventoryItem.findMany({
      where: {
        locationId: managerContext.locationId,
      },
      select: {
        id: true,
        name: true,
        sku: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    const recentReceipts = await db.botMessageReceipt.findMany({
      where: {
        channel: toBotChannel(input.channel),
        senderId: input.senderId,
        status: "COMPLETED",
      },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { inboundText: true, replyText: true, metadata: true },
    });

    const conversationHistory: BotConversationTurn[] = recentReceipts
      .reverse()
      .flatMap((r) => [
        { role: "manager" as const, text: r.inboundText },
        ...(r.replyText ? [{ role: "bot" as const, text: r.replyText }] : []),
      ]);

    const pendingContext = extractPendingContext(recentReceipts[0]?.metadata);

    const botLanguage = getBotLanguageProvider();
    const interpretation = await botLanguage.interpretMessage({
      channel: input.channel,
      text: input.text,
      inventoryChoices,
      conversationHistory,
      pendingContext,
    });

    let result: BotHandlingResult;

    if (interpretation.needsClarification && interpretation.clarificationQuestion) {
      result = {
        ok: false,
        reply: interpretation.clarificationQuestion,
        replyScenario: "clarification",
        replyFacts: {
          interpretation,
        },
      };
    } else {
      switch (interpretation.intent) {
        case "GREETING":
          result = {
            ok: true,
            reply:
              "Hey. I'm here and ready to help with stock. You can ask what's low, check an item, or say something like 'Whole milk 2 left, order more.'",
            replyScenario: "greeting",
            replyFacts: {
              interpretation,
            },
          };
          break;
        case "HELP":
          result = {
            ok: true,
            reply:
              "I can check stock, explain what's low, and create a reorder to par from chat. Try 'How much oat milk do we have?' or 'Whole milk 2 left, order more.'",
            replyScenario: "help",
            replyFacts: {
              interpretation,
            },
          };
          break;
        case "STOCK_STATUS":
          result = await answerStockStatusFromBotMessage({
            locationId: managerContext.locationId,
            userId: managerContext.userId,
            inventoryItemId: interpretation.inventoryItemId ?? null,
            inventoryItemName: interpretation.inventoryItemName ?? null,
          });
          break;
        case "RESTOCK_TO_PAR":
          if (!interpretation.inventoryItemId || interpretation.reportedOnHand == null) {
            result = {
              ok: false,
              reply:
                "Tell me the item and how many are left so I can restock to par. Example: 'Whole milk 2 left, order more.'",
              replyScenario: "clarification",
              replyFacts: {
                interpretation,
              },
            };
            break;
          }

          result = await createRestockOrderFromBotMessage({
            locationId: managerContext.locationId,
            userId: managerContext.userId,
            channel: input.channel,
            sourceMessageId: input.sourceMessageId ?? null,
            originalText: input.text,
            inventoryItemId: interpretation.inventoryItemId,
            reportedOnHandDisplay: interpretation.reportedOnHand,
          });
          break;
        case "UNKNOWN":
        default: {
          const parsed = parseManagerRestockMessage(input.text, inventoryChoices);

          if (parsed.kind === "matched") {
            result = await createRestockOrderFromBotMessage({
              locationId: managerContext.locationId,
              userId: managerContext.userId,
              channel: input.channel,
              sourceMessageId: input.sourceMessageId ?? null,
              originalText: input.text,
              inventoryItemId: parsed.inventoryItemId,
              reportedOnHandDisplay: parsed.reportedOnHandBase,
            });
            break;
          }

          result = {
            ok: false,
            reply:
              "I can help with stock checks and restocks. Ask what's low, check a specific item, or say 'Whole milk 2 left, order more.'",
            replyScenario: "unknown",
            replyFacts: {
              interpretation,
            },
          };
          break;
        }
      }
    }

    const draftedReply = await botLanguage.draftReply({
      channel: input.channel,
      managerText: input.text,
      scenario: result.replyScenario ?? "default",
      fallbackReply: result.reply,
      facts: result.replyFacts ?? {},
      conversationHistory,
    });

    result = {
      ...result,
      reply: draftedReply.reply,
    };

    await db.auditLog.create({
      data: {
        locationId: managerContext.locationId,
        userId: managerContext.userId,
        action: "bot.outbound_replied",
        entityType: "botChannel",
        entityId: input.sourceMessageId ?? `${input.channel.toLowerCase()}-message`,
        details: {
          channel: input.channel,
          purchaseOrderId: result.purchaseOrderId ?? null,
          orderNumber: result.orderNumber ?? null,
          reply: result.reply,
          replyScenario: result.replyScenario ?? null,
        },
      },
    });

    await completeBotMessageReceipt({
      receiptId,
      locationId: managerContext.locationId,
      userId: managerContext.userId,
      reply: result.reply,
      purchaseOrderId: result.purchaseOrderId ?? null,
      orderNumber: result.orderNumber ?? null,
      metadata: toInputJsonValue({
        channel: input.channel,
        replyScenario: result.replyScenario ?? null,
        replyFacts: result.replyFacts ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
        senderId: input.senderId,
        replyProvider: draftedReply.provider,
      }),
    });

    return result;
  } catch (error) {
    await failBotMessageReceipt({
      receiptId,
      locationId: managerContext?.locationId,
      userId: managerContext?.userId,
      errorMessage: error instanceof Error ? error.message : "Unknown bot handling failure",
      metadata: toInputJsonValue({
        channel: input.channel,
        sourceMessageId: input.sourceMessageId ?? null,
        senderId: input.senderId,
      }),
    });

    throw error;
  }
}

async function createRestockOrderFromBotMessage(input: {
  locationId: string;
  userId: string;
  channel: ManagerBotChannel;
  inventoryItemId: string;
  reportedOnHandDisplay: number;
  sourceMessageId: string | null;
  originalText: string;
}): Promise<BotHandlingResult> {
  const item = await db.inventoryItem.findFirstOrThrow({
    where: {
      id: input.inventoryItemId,
      locationId: input.locationId,
    },
    include: {
      snapshot: true,
      primarySupplier: true,
      supplierItems: {
        include: {
          supplier: true,
        },
        orderBy: [{ preferred: "desc" }, { supplier: { name: "asc" } }],
      },
    },
  });

  const reportedOnHandBase = convertDisplayToBase(
    input.reportedOnHandDisplay,
    item.displayUnit,
    item.packSizeBase
  );
  const quantityDeltaBase = reportedOnHandBase - item.stockOnHandBase;

  if (quantityDeltaBase !== 0) {
    await db.$transaction(async (tx) => {
      await postStockMovementTx(tx, {
        locationId: input.locationId,
        inventoryItemId: item.id,
        quantityDeltaBase,
        movementType: MovementType.MANUAL_COUNT_ADJUSTMENT,
        sourceType: "manager_bot_message",
        sourceId: input.sourceMessageId ?? `${input.channel.toLowerCase()}-${Date.now()}`,
        userId: input.userId,
        metadata: {
          channel: input.channel,
          originalText: input.originalText,
          reportedOnHandDisplay: input.reportedOnHandDisplay,
          displayUnit: item.displayUnit,
        },
      });

      await createAuditLogTx(tx, {
        locationId: input.locationId,
        userId: input.userId,
        action: "bot.count_recorded",
        entityType: "inventoryItem",
        entityId: item.id,
        details: {
          channel: input.channel,
          originalText: input.originalText,
          reportedOnHandDisplay: input.reportedOnHandDisplay,
          reportedOnHandBase,
          quantityDeltaBase,
        },
      });
    });

    await refreshOperationalState(input.locationId, [item.id]);
  }

  const refreshedItem = await db.inventoryItem.findFirstOrThrow({
    where: {
      id: item.id,
      locationId: input.locationId,
    },
    include: {
      primarySupplier: true,
      supplierItems: {
        include: {
          supplier: true,
        },
        orderBy: [{ preferred: "desc" }, { supplier: { name: "asc" } }],
      },
    },
  });

  const supplierContext = pickSupplierContext(refreshedItem);

  if (!supplierContext) {
    return {
      ok: false,
      reply: `I recorded ${refreshedItem.name} at ${formatQuantityBase(
        reportedOnHandBase,
        refreshedItem.displayUnit,
        refreshedItem.packSizeBase
      )}, but I couldn't find a linked supplier for that item yet.`,
      replyScenario: "supplier_missing",
      replyFacts: {
        inventoryItemName: refreshedItem.name,
        reportedOnHandBase,
        parLevelBase: refreshedItem.parLevelBase,
      },
    };
  }

  const order = calculateRestockToParOrder({
    parLevelBase: refreshedItem.parLevelBase,
    reportedOnHandBase,
    packSizeBase: supplierContext.packSizeBase,
    minimumOrderQuantity: supplierContext.minimumOrderQuantity,
  });

  if (order.orderQuantityBase <= 0) {
    return {
      ok: true,
      reply: `I recorded ${refreshedItem.name} at ${formatQuantityBase(
        reportedOnHandBase,
        refreshedItem.displayUnit,
        refreshedItem.packSizeBase
      )}. That already meets the par target of ${formatQuantityBase(
        refreshedItem.parLevelBase,
        refreshedItem.displayUnit,
        refreshedItem.packSizeBase
      )}, so I did not place an order.`,
      replyScenario: "restock_not_needed",
      replyFacts: {
        inventoryItemName: refreshedItem.name,
        reportedOnHandBase,
        parLevelBase: refreshedItem.parLevelBase,
      },
    };
  }

  const existingRecommendation = await db.reorderRecommendation.findFirst({
    where: {
      inventoryItemId: refreshedItem.id,
      status: RecommendationStatus.PENDING_APPROVAL,
      purchaseOrder: {
        is: null,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const orderNumber = nextOrderNumber();

  const purchaseOrder = await db.$transaction(async (tx) => {
    const createdPurchaseOrder = await tx.purchaseOrder.create({
      data: {
        locationId: input.locationId,
        supplierId: supplierContext.supplier.id,
        recommendationId: existingRecommendation?.id,
        orderNumber,
        status: PurchaseOrderStatus.APPROVED,
        totalLines: 1,
        placedById: input.userId,
        approvedById: input.userId,
        approvedAt: new Date(),
        notes: [
          `Manager approved this reorder via ${input.channel.toLowerCase()} bot command.`,
          `Reported on hand: ${formatQuantityBase(
            reportedOnHandBase,
            refreshedItem.displayUnit,
            refreshedItem.packSizeBase
          )}.`,
          `Par target: ${formatQuantityBase(
            refreshedItem.parLevelBase,
            refreshedItem.displayUnit,
            refreshedItem.packSizeBase
          )}.`,
        ].join(" "),
        metadata: {
          source: "manager-bot",
          channel: input.channel,
          sourceMessageId: input.sourceMessageId,
          originalText: input.originalText,
          reportedOnHandDisplay: input.reportedOnHandDisplay,
          reportedOnHandBase,
          shortageBase: order.shortageBase,
        },
      },
    });

    await tx.purchaseOrderLine.create({
      data: {
        purchaseOrderId: createdPurchaseOrder.id,
        inventoryItemId: refreshedItem.id,
        description: refreshedItem.name,
        quantityOrdered: order.recommendedPackCount,
        expectedQuantityBase: order.orderQuantityBase,
        purchaseUnit: refreshedItem.purchaseUnit,
        packSizeBase: supplierContext.packSizeBase,
      },
    });

    if (existingRecommendation) {
      await tx.reorderRecommendation.update({
        where: {
          id: existingRecommendation.id,
        },
        data: {
          status: RecommendationStatus.CONVERTED,
          approvedById: input.userId,
          approvedAt: new Date(),
          recommendedPackCount: order.recommendedPackCount,
          recommendedOrderQuantityBase: order.orderQuantityBase,
        },
      });
    }

    await tx.alert.updateMany({
      where: {
        inventoryItemId: refreshedItem.id,
        type: AlertType.ORDER_APPROVAL,
        status: AlertStatus.OPEN,
      },
      data: {
        status: AlertStatus.RESOLVED,
        resolvedAt: new Date(),
      },
    });

    await createAuditLogTx(tx, {
      locationId: input.locationId,
      userId: input.userId,
      action: "bot.purchase_order_created",
      entityType: "purchaseOrder",
      entityId: createdPurchaseOrder.id,
      details: {
        channel: input.channel,
        orderNumber,
        reportedOnHandBase,
        shortageBase: order.shortageBase,
        recommendedPackCount: order.recommendedPackCount,
      },
    });

    return createdPurchaseOrder;
  });

  const finalOrder = await dispatchBotPurchaseOrder({
    purchaseOrderId: purchaseOrder.id,
    locationId: input.locationId,
    userId: input.userId,
    supplier: supplierContext.supplier,
    inventoryName: refreshedItem.name,
    purchaseUnit: refreshedItem.purchaseUnit,
    packCount: order.recommendedPackCount,
    orderQuantityBase: order.orderQuantityBase,
    reportedOnHandBase,
    parLevelBase: refreshedItem.parLevelBase,
  });

  return {
    ok: finalOrder.status !== PurchaseOrderStatus.FAILED,
    purchaseOrderId: finalOrder.id,
    orderNumber: finalOrder.orderNumber,
    reply: buildBotReply({
      itemName: refreshedItem.name,
      displayUnit: refreshedItem.displayUnit,
      itemPackSizeBase: refreshedItem.packSizeBase,
      reportedOnHandBase,
      parLevelBase: refreshedItem.parLevelBase,
      orderedQuantityBase: order.orderQuantityBase,
      orderedPackCount: order.recommendedPackCount,
      purchaseUnit: refreshedItem.purchaseUnit,
      supplierName: supplierContext.supplier.name,
      supplierOrderingMode: supplierContext.supplier.orderingMode,
      purchaseOrderId: finalOrder.id,
      orderNumber: finalOrder.orderNumber,
      status: finalOrder.status,
      lastError: readPurchaseOrderFailure(finalOrder.metadata),
    }),
    replyScenario: mapPurchaseOrderReplyScenario({
      supplierOrderingMode: supplierContext.supplier.orderingMode,
      status: finalOrder.status,
    }),
    replyFacts: {
      inventoryItemName: refreshedItem.name,
      supplierName: supplierContext.supplier.name,
      supplierOrderingMode: supplierContext.supplier.orderingMode,
      reportedOnHandBase,
      parLevelBase: refreshedItem.parLevelBase,
      orderedQuantityBase: order.orderQuantityBase,
      orderedPackCount: order.recommendedPackCount,
      purchaseUnit: refreshedItem.purchaseUnit,
      orderNumber: finalOrder.orderNumber,
      orderStatus: finalOrder.status,
      lastError: readPurchaseOrderFailure(finalOrder.metadata),
    },
  };
}

async function answerStockStatusFromBotMessage(input: {
  locationId: string;
  userId: string;
  inventoryItemId: string | null;
  inventoryItemName: string | null;
}): Promise<BotHandlingResult> {
  if (input.inventoryItemId) {
    const item = await db.inventoryItem.findFirstOrThrow({
      where: {
        id: input.inventoryItemId,
        locationId: input.locationId,
      },
      include: {
        snapshot: true,
      },
    });

    return {
      ok: true,
      reply: `${item.name} is currently at ${formatQuantityBase(
        item.stockOnHandBase,
        item.displayUnit,
        item.packSizeBase
      )}. Par is ${formatQuantityBase(
        item.parLevelBase,
        item.displayUnit,
        item.packSizeBase
      )}.${item.snapshot?.daysLeft != null ? ` Forecasted days left: ${item.snapshot.daysLeft.toFixed(1)}.` : ""}`,
      replyScenario: "stock_status_item",
      replyFacts: {
        inventoryItemName: item.name,
        stockOnHandBase: item.stockOnHandBase,
        parLevelBase: item.parLevelBase,
        lowStockThresholdBase: item.lowStockThresholdBase,
        daysLeft: item.snapshot?.daysLeft ?? null,
        projectedRunoutAt: item.snapshot?.projectedRunoutAt?.toISOString() ?? null,
      },
    };
  }

  const inventoryItems = await db.inventoryItem.findMany({
    where: {
      locationId: input.locationId,
    },
    include: {
      snapshot: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  const lowItems = inventoryItems
    .filter(
      (item) =>
        item.stockOnHandBase <= item.lowStockThresholdBase ||
        (item.snapshot?.daysLeft != null && item.snapshot.daysLeft <= 3)
    )
    .sort((left, right) => {
      const leftDays = left.snapshot?.daysLeft ?? Number.POSITIVE_INFINITY;
      const rightDays = right.snapshot?.daysLeft ?? Number.POSITIVE_INFINITY;

      if (leftDays !== rightDays) {
        return leftDays - rightDays;
      }

      return left.stockOnHandBase - right.stockOnHandBase;
    })
    .slice(0, 4);

  const fallbackReply = lowItems.length
    ? `Right now the main low-stock risks are ${lowItems
        .map((item) => `${item.name} (${formatQuantityBase(item.stockOnHandBase, item.displayUnit, item.packSizeBase)} left)`)
        .join(", ")}.`
    : "Nothing is currently below its low-stock threshold right now.";

  return {
    ok: true,
    reply: fallbackReply,
    replyScenario: "stock_status_summary",
    replyFacts: {
      requestedItemName: input.inventoryItemName,
      lowItems: lowItems.map((item) => ({
        name: item.name,
        stockOnHandBase: item.stockOnHandBase,
        parLevelBase: item.parLevelBase,
        daysLeft: item.snapshot?.daysLeft ?? null,
      })),
    },
  };
}

async function dispatchBotPurchaseOrder(input: {
  purchaseOrderId: string;
  locationId: string;
  userId: string;
  supplier: {
    id: string;
    name: string;
    email: string | null;
    website: string | null;
    orderingMode: SupplierOrderingMode;
  };
  inventoryName: string;
  purchaseUnit: string;
  packCount: number;
  orderQuantityBase: number;
  reportedOnHandBase: number;
  parLevelBase: number;
}) {
  const supplierOrderProvider = getSupplierOrderProvider();
  const ai = getAiProvider();

  const line = {
    description: input.inventoryName,
    quantity: input.packCount,
    unit: input.purchaseUnit.toLowerCase(),
  };

  const draft =
    input.supplier.orderingMode === SupplierOrderingMode.WEBSITE
      ? null
      : (await ai.draftSupplierMessage({
          supplierName: input.supplier.name,
          orderNumber: (
            await db.purchaseOrder.findUniqueOrThrow({
              where: { id: input.purchaseOrderId },
              select: { orderNumber: true },
            })
          ).orderNumber,
          lines: [line],
        })) ??
        (await supplierOrderProvider.createDraft({
          supplierName: input.supplier.name,
          mode: input.supplier.orderingMode,
          orderNumber: (
            await db.purchaseOrder.findUniqueOrThrow({
              where: { id: input.purchaseOrderId },
              select: { orderNumber: true },
            })
          ).orderNumber,
          lines: [line],
        }));

  const currentPurchaseOrder = await db.purchaseOrder.findUniqueOrThrow({
    where: {
      id: input.purchaseOrderId,
    },
    select: {
      id: true,
      orderNumber: true,
      notes: true,
      status: true,
    },
  });

  if (input.supplier.orderingMode === SupplierOrderingMode.EMAIL) {
    try {
      if (!input.supplier.email) {
        throw new Error("Supplier email is missing for this order.");
      }

      const sendResult = await supplierOrderProvider.sendApprovedOrder({
        recipient: input.supplier.email,
        subject: draft?.subject ?? `PO ${currentPurchaseOrder.orderNumber} from StockPilot`,
        body:
          draft?.body ??
          `Please confirm ${line.quantity} ${line.unit} of ${line.description}.`,
      });

      await db.$transaction(async (tx) => {
        await tx.purchaseOrder.update({
          where: {
            id: input.purchaseOrderId,
          },
          data: {
            status: PurchaseOrderStatus.SENT,
            sentAt: new Date(),
          },
        });

        await tx.supplierCommunication.create({
          data: {
            supplierId: input.supplier.id,
            purchaseOrderId: input.purchaseOrderId,
            channel: input.supplier.orderingMode,
            direction: CommunicationDirection.OUTBOUND,
            subject: draft?.subject ?? `PO ${currentPurchaseOrder.orderNumber} from StockPilot`,
            body: draft?.body ?? `Please confirm ${line.quantity} ${line.unit} of ${line.description}.`,
            status: CommunicationStatus.SENT,
            providerMessageId: sendResult.providerMessageId,
            sentAt: new Date(),
          },
        });

        await createAuditLogTx(tx, {
          locationId: input.locationId,
          userId: input.userId,
          action: "bot.purchase_order_sent",
          entityType: "purchaseOrder",
          entityId: input.purchaseOrderId,
          details: {
            supplierOrderingMode: input.supplier.orderingMode,
            providerMessageId: sendResult.providerMessageId ?? null,
          },
        });
      });
    } catch (error) {
      await db.$transaction(async (tx) => {
        await tx.purchaseOrder.update({
          where: {
            id: input.purchaseOrderId,
          },
          data: {
            status: PurchaseOrderStatus.FAILED,
            notes: appendOperationalNote(
              currentPurchaseOrder.notes,
              `Bot email send failed: ${error instanceof Error ? error.message : "Unknown send failure"}`
            ),
            metadata: {
              source: "manager-bot",
              error: error instanceof Error ? error.message : "Unknown send failure",
            },
          },
        });

        await tx.supplierCommunication.create({
          data: {
            supplierId: input.supplier.id,
            purchaseOrderId: input.purchaseOrderId,
            channel: input.supplier.orderingMode,
            direction: CommunicationDirection.OUTBOUND,
            subject: draft?.subject ?? `PO ${currentPurchaseOrder.orderNumber} from StockPilot`,
            body: draft?.body ?? `Please confirm ${line.quantity} ${line.unit} of ${line.description}.`,
            status: CommunicationStatus.FAILED,
          },
        });

        await createAuditLogTx(tx, {
          locationId: input.locationId,
          userId: input.userId,
          action: "bot.purchase_order_send_failed",
          entityType: "purchaseOrder",
          entityId: input.purchaseOrderId,
          details: {
            supplierOrderingMode: input.supplier.orderingMode,
            error: error instanceof Error ? error.message : "Unknown send failure",
          },
        });
      });
    }
  } else if (input.supplier.orderingMode === SupplierOrderingMode.WEBSITE) {
    const task = await supplierOrderProvider.prepareWebsiteTask({
      supplierName: input.supplier.name,
      website: input.supplier.website,
      orderNumber: currentPurchaseOrder.orderNumber,
      lines: [line],
    });

    await db.$transaction(async (tx) => {
      const agentTask = await tx.agentTask.create({
        data: {
          locationId: input.locationId,
          supplierId: input.supplier.id,
          purchaseOrderId: input.purchaseOrderId,
          type: AgentTaskType.WEBSITE_ORDER_PREP,
          status: AgentTaskStatus.PENDING,
          title: task.title,
          description: task.description,
          input: task.input as Prisma.InputJsonValue,
        },
      });

      await tx.supplierCommunication.create({
        data: {
          supplierId: input.supplier.id,
          purchaseOrderId: input.purchaseOrderId,
          channel: input.supplier.orderingMode,
          direction: CommunicationDirection.OUTBOUND,
          subject: `PO ${currentPurchaseOrder.orderNumber} website prep queued`,
          body:
            "StockPilot queued a website-order preparation workflow from a manager bot command. Final checkout remains approval-first.",
          status: CommunicationStatus.DRAFT,
        },
      });

      await enqueueJobTx(tx, {
        locationId: input.locationId,
        type: "PREPARE_WEBSITE_ORDER",
        payload: {
          taskId: agentTask.id,
          queuedById: input.userId,
        },
      });

      await createAuditLogTx(tx, {
        locationId: input.locationId,
        userId: input.userId,
        action: "bot.website_order_task_queued",
        entityType: "agentTask",
        entityId: agentTask.id,
        details: {
          purchaseOrderId: input.purchaseOrderId,
        },
      });
    });
  } else {
    await db.$transaction(async (tx) => {
      await tx.supplierCommunication.create({
        data: {
          supplierId: input.supplier.id,
          purchaseOrderId: input.purchaseOrderId,
          channel: input.supplier.orderingMode,
          direction: CommunicationDirection.OUTBOUND,
          subject: draft?.subject ?? `PO ${currentPurchaseOrder.orderNumber} manual draft`,
          body:
            draft?.body ??
            `Manual supplier workflow draft created from bot command for ${line.quantity} ${line.unit} of ${line.description}.`,
          status: CommunicationStatus.DRAFT,
        },
      });

      await createAuditLogTx(tx, {
        locationId: input.locationId,
        userId: input.userId,
        action: "bot.manual_supplier_draft_created",
        entityType: "purchaseOrder",
        entityId: input.purchaseOrderId,
      });
    });
  }

  return db.purchaseOrder.findUniqueOrThrow({
    where: {
      id: input.purchaseOrderId,
    },
  });
}

function pickSupplierContext(item: {
  primarySupplier: {
    id: string;
    name: string;
    email: string | null;
    website: string | null;
    orderingMode: SupplierOrderingMode;
    minimumOrderQuantity: number;
  } | null;
  supplierItems: Array<{
    packSizeBase: number;
    minimumOrderQuantity: number;
    supplier: {
      id: string;
      name: string;
      email: string | null;
      website: string | null;
      orderingMode: SupplierOrderingMode;
      minimumOrderQuantity: number;
    };
  }>;
  packSizeBase: number;
  minimumOrderQuantity: number;
}) {
  const preferredSupplierItem = item.supplierItems[0];

  if (preferredSupplierItem) {
    return {
      supplier: preferredSupplierItem.supplier,
      packSizeBase: preferredSupplierItem.packSizeBase,
      minimumOrderQuantity: preferredSupplierItem.minimumOrderQuantity,
    };
  }

  if (!item.primarySupplier) {
    return null;
  }

  return {
    supplier: item.primarySupplier,
    packSizeBase: item.packSizeBase,
    minimumOrderQuantity: Math.max(
      item.minimumOrderQuantity,
      item.primarySupplier.minimumOrderQuantity
    ),
  };
}

async function findManagerContext(channel: ManagerBotChannel, senderId: string) {
  if (channel === "WHATSAPP") {
    const normalizedPhoneNumber = normalizePhoneNumber(senderId);
    if (!normalizedPhoneNumber) {
      return null;
    }

    return db.userLocationRole.findFirst({
      where: {
        role: Role.MANAGER,
        user: {
          phoneNumber: normalizedPhoneNumber,
        },
      },
      select: {
        locationId: true,
        userId: true,
      },
    });
  }

  return db.userLocationRole.findFirst({
    where: {
      role: Role.MANAGER,
      user: {
        telegramChatId: senderId,
      },
    },
    select: {
      locationId: true,
      userId: true,
    },
  });
}

function buildBotReply(input: {
  itemName: string;
  displayUnit: string;
  itemPackSizeBase: number;
  reportedOnHandBase: number;
  parLevelBase: number;
  orderedQuantityBase: number;
  orderedPackCount: number;
  purchaseUnit: string;
  supplierName: string;
  supplierOrderingMode: SupplierOrderingMode;
  purchaseOrderId: string;
  orderNumber: string;
  status: PurchaseOrderStatus;
  lastError: string | null;
}) {
  const countLine = `I logged ${input.itemName} at ${formatQuantityBase(
    input.reportedOnHandBase,
    input.displayUnit as never,
    input.itemPackSizeBase
  )}. Par is ${formatQuantityBase(
    input.parLevelBase,
    input.displayUnit as never,
    input.itemPackSizeBase
  )}.`;
  const orderLine = `That means I needed ${formatQuantityBase(
    input.parLevelBase - input.reportedOnHandBase,
    input.displayUnit as never,
    input.itemPackSizeBase
  )}, so I created ${input.orderNumber} for ${input.orderedPackCount} ${input.purchaseUnit.toLowerCase()} (${formatQuantityBase(
    input.orderedQuantityBase,
    input.displayUnit as never,
    input.itemPackSizeBase
  )}) from ${input.supplierName}.`;

  if (input.status === PurchaseOrderStatus.SENT) {
    return `${countLine} ${orderLine} I sent the supplier email automatically.`;
  }

  if (input.status === PurchaseOrderStatus.FAILED) {
    return `${countLine} ${orderLine} I created the order, but sending it failed: ${input.lastError ?? "unknown delivery error"}.`;
  }

  if (input.supplierOrderingMode === SupplierOrderingMode.WEBSITE) {
    return `${countLine} ${orderLine} I queued the website ordering workflow for review before final checkout.`;
  }

  if (input.supplierOrderingMode === SupplierOrderingMode.MANUAL) {
    return `${countLine} ${orderLine} I created a manual supplier draft for follow-up inside StockPilot.`;
  }

  return `${countLine} ${orderLine} The order is ready in StockPilot.`;
}

function readPurchaseOrderFailure(metadata: Prisma.JsonValue | null | undefined) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const error = (metadata as Record<string, unknown>).error;
  return typeof error === "string" ? error : null;
}

function normalizePhoneNumber(value: string) {
  const normalized = value.replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");
  if (!normalized) {
    return null;
  }

  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

function toBotChannel(channel: ManagerBotChannel) {
  return channel === "TELEGRAM" ? BotChannel.TELEGRAM : BotChannel.WHATSAPP;
}

function mapPurchaseOrderReplyScenario(input: {
  supplierOrderingMode: SupplierOrderingMode;
  status: PurchaseOrderStatus;
}) {
  if (input.status === PurchaseOrderStatus.SENT) {
    return "restock_order_sent";
  }

  if (input.status === PurchaseOrderStatus.FAILED) {
    return "restock_order_failed";
  }

  if (input.supplierOrderingMode === SupplierOrderingMode.WEBSITE) {
    return "restock_website_review";
  }

  if (input.supplierOrderingMode === SupplierOrderingMode.MANUAL) {
    return "restock_manual_draft";
  }

  return "restock_order_ready";
}

function nextOrderNumber() {
  return `PO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function appendOperationalNote(existing: string | null | undefined, next: string | null | undefined) {
  const normalized = next?.trim();

  if (!normalized) {
    return existing ?? undefined;
  }

  return existing ? `${existing}\n${normalized}` : normalized;
}

function toInputJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function extractPendingContext(metadata: Prisma.JsonValue | null | undefined): BotPendingContext | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const m = metadata as Record<string, unknown>;
  if (m.replyScenario !== "clarification") return undefined;
  const facts = m.replyFacts;
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) return undefined;
  const interp = (facts as Record<string, unknown>).interpretation;
  if (!interp || typeof interp !== "object" || Array.isArray(interp)) return undefined;
  const i = interp as Record<string, unknown>;
  const clarificationQuestion = typeof i.clarificationQuestion === "string" ? i.clarificationQuestion : "";
  if (!clarificationQuestion) return undefined;
  return {
    intent: typeof i.intent === "string" ? i.intent : "UNKNOWN",
    inventoryItemId: typeof i.inventoryItemId === "string" ? i.inventoryItemId : null,
    inventoryItemName: typeof i.inventoryItemName === "string" ? i.inventoryItemName : null,
    reportedOnHand: typeof i.reportedOnHand === "number" ? i.reportedOnHand : null,
    clarificationQuestion,
  };
}
