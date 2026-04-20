import {
  AlertSeverity,
  AlertStatus,
  AlertType,
  MappingStatus,
  MovementType,
  RecommendationStatus,
  SaleProcessingStatus,
} from "@/lib/prisma";
import type { Prisma } from "@/lib/prisma";

import { createAuditLogTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { parseDeliveryDays } from "@/lib/delivery-days";
import {
  calculateAverageDailyUsage,
  calculateDaysLeft,
  classifyUrgency,
  projectRunoutDate,
} from "@/modules/forecast/forecast";
import { isCountStale, isHighUsageSpike } from "@/modules/forecast/anomalies";
import { queueManagerEmailNotificationsTx } from "@/modules/notifications/service";
import { buildRecommendationSummary, calculateRecommendedOrder } from "@/modules/purchasing/reorder";
import { applyDelta, calculateCountAdjustment } from "@/modules/inventory/units";
import {
  USAGE_SIGNAL_MOVEMENT_TYPES,
  clampConfidenceScore,
  componentMatchesModifierKey,
  componentMatchesServiceMode,
  extractModifierKeys,
  sumNegativeUsageBase,
} from "@/modules/inventory/ledger-primitives";
import { inferModifierKeysFromVariationName } from "@/modules/recipes/consolidation";

export async function postStockMovementTx(
  tx: Prisma.TransactionClient,
  input: {
    locationId: string;
    inventoryItemId: string;
    quantityDeltaBase: number;
    movementType: MovementType;
    sourceType: string;
    sourceId: string;
    notes?: string;
    metadata?: Prisma.InputJsonValue;
    userId?: string | null;
  }
) {
  const item = await tx.inventoryItem.findUniqueOrThrow({
    where: {
      id: input.inventoryItemId,
    },
  });

  const balances = applyDelta(item.stockOnHandBase, input.quantityDeltaBase);

  await tx.inventoryItem.update({
    where: {
      id: input.inventoryItemId,
    },
    data: {
      stockOnHandBase: balances.afterBalanceBase,
    },
  });

  return tx.stockMovement.create({
    data: {
      locationId: input.locationId,
      inventoryItemId: input.inventoryItemId,
      quantityDeltaBase: input.quantityDeltaBase,
      movementType: input.movementType,
      beforeBalanceBase: balances.beforeBalanceBase,
      afterBalanceBase: balances.afterBalanceBase,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      notes: input.notes,
      metadata: input.metadata,
      userId: input.userId ?? undefined,
    },
  });
}

export async function refreshInventorySnapshotTx(
  tx: Prisma.TransactionClient,
  inventoryItemId: string
) {
  const item = await tx.inventoryItem.findUniqueOrThrow({
    where: {
      id: inventoryItemId,
    },
  });

  const recentMovements = await tx.stockMovement.findMany({
    where: {
      inventoryItemId,
      performedAt: {
        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
    },
  });

  const totalConsumedBase = sumNegativeUsageBase(recentMovements);
  const averageDailyUsageBase = calculateAverageDailyUsage(totalConsumedBase, 7);
  const daysLeft = calculateDaysLeft(item.stockOnHandBase, averageDailyUsageBase);
  const projectedRunoutAt = projectRunoutDate(daysLeft);
  const safetyDays =
    averageDailyUsageBase > 0 ? item.safetyStockBase / averageDailyUsageBase : 2;
  const urgency = classifyUrgency({
    daysLeft,
    leadTimeDays: item.leadTimeDays,
    safetyDays,
  });
  const recentReceivingCount = recentMovements.filter(
    (movement) =>
      movement.movementType === MovementType.RECEIVING && movement.quantityDeltaBase > 0
  ).length;
  const recentCorrectionMagnitudeBase = recentMovements
    .filter((movement) =>
      movement.movementType === MovementType.MANUAL_COUNT_ADJUSTMENT ||
      movement.movementType === MovementType.CORRECTION
    )
    .reduce((sum, movement) => sum + Math.abs(movement.quantityDeltaBase), 0);
  const correctionPenalty =
    recentCorrectionMagnitudeBase > 0
      ? Math.min(
          0.28,
          recentCorrectionMagnitudeBase /
            Math.max(item.lowStockThresholdBase, item.packSizeBase, 1) /
            10
        )
      : 0;
  const receivingBoost = recentReceivingCount > 0 ? 0.04 : 0;
  const confidenceScore = clampConfidenceScore(
    item.confidenceScore + receivingBoost - correctionPenalty
  );

  return tx.inventorySnapshot.upsert({
    where: {
      inventoryItemId,
    },
    update: {
      locationId: item.locationId,
      stockOnHandBase: item.stockOnHandBase,
      averageDailyUsageBase,
      daysLeft,
      projectedRunoutAt,
      urgency,
      confidenceScore,
      lastCalculatedAt: new Date(),
    },
    create: {
      locationId: item.locationId,
      inventoryItemId,
      stockOnHandBase: item.stockOnHandBase,
      averageDailyUsageBase,
      daysLeft,
      projectedRunoutAt,
      urgency,
      confidenceScore,
    },
  });
}

export async function syncAlertsAndRecommendationsTx(
  tx: Prisma.TransactionClient,
  inventoryItemId: string
) {
  const now = new Date();
  const item = await tx.inventoryItem.findUniqueOrThrow({
    where: {
      id: inventoryItemId,
    },
    include: {
      supplierItems: {
        where: {
          preferred: true,
        },
        include: {
          supplier: true,
        },
      },
      snapshot: true,
    },
  });

  const [latestCountEntry, recentUsageMovements, baselineUsageMovements] = await Promise.all([
    tx.stockCountEntry.findFirst({
      where: {
        inventoryItemId,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    tx.stockMovement.findMany({
      where: {
        inventoryItemId,
        movementType: {
          in: [...USAGE_SIGNAL_MOVEMENT_TYPES],
        },
        performedAt: {
          gte: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        },
      },
    }),
    tx.stockMovement.findMany({
      where: {
        inventoryItemId,
        movementType: {
          in: [...USAGE_SIGNAL_MOVEMENT_TYPES],
        },
        performedAt: {
          gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          lt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        },
      },
    }),
  ]);

  if (!item.snapshot) {
    return;
  }

  const shouldAlert =
    item.stockOnHandBase <= item.lowStockThresholdBase ||
    item.snapshot.urgency === AlertSeverity.CRITICAL;

  const stockAlertType =
    item.snapshot.urgency === AlertSeverity.CRITICAL
      ? AlertType.IMMINENT_STOCKOUT
      : AlertType.LOW_STOCK;
  const stockAlertTitle =
    item.snapshot.urgency === AlertSeverity.CRITICAL
      ? `${item.name} may run out before the next delivery window`
      : `${item.name} is below its low-stock threshold`;
  const stockAlertMessage =
    item.snapshot.urgency === AlertSeverity.CRITICAL
      ? `Projected runout is ${item.snapshot.projectedRunoutAt?.toISOString() ?? "unknown"}, so reorder review should happen now.`
      : `Current stock is ${item.stockOnHandBase} base units with ${item.snapshot.daysLeft?.toFixed(1) ?? "unknown"} days left.`;

  const openStockAlerts = await tx.alert.findMany({
    where: {
      inventoryItemId,
      status: AlertStatus.OPEN,
      type: {
        in: [AlertType.LOW_STOCK, AlertType.IMMINENT_STOCKOUT],
      },
    },
  });

  if (shouldAlert) {
    const matchingStockAlert = openStockAlerts.find((alert) => alert.type === stockAlertType);

    if (matchingStockAlert) {
      await tx.alert.update({
        where: { id: matchingStockAlert.id },
        data: {
          severity: item.snapshot.urgency,
          title: stockAlertTitle,
          message: stockAlertMessage,
          metadata: {
            projectedRunoutAt: item.snapshot.projectedRunoutAt?.toISOString() ?? null,
            daysLeft: item.snapshot.daysLeft ?? null,
          },
        },
      });
    } else {
      const alert = await tx.alert.create({
        data: {
          locationId: item.locationId,
          inventoryItemId,
          type: stockAlertType,
          severity: item.snapshot.urgency,
          title: stockAlertTitle,
          message: stockAlertMessage,
          metadata: {
            projectedRunoutAt: item.snapshot.projectedRunoutAt?.toISOString() ?? null,
            daysLeft: item.snapshot.daysLeft ?? null,
          },
        },
      });

      await queueManagerEmailNotificationsTx(tx, {
        locationId: item.locationId,
        alertId: alert.id,
        subject: alert.title,
        body: `${alert.message}\n\nItem: ${item.name}`,
      });
    }

    const staleStockAlertIds = openStockAlerts
      .filter((alert) => alert.type !== stockAlertType)
      .map((alert) => alert.id);

    if (staleStockAlertIds.length > 0) {
      await tx.alert.updateMany({
        where: {
          id: {
            in: staleStockAlertIds,
          },
        },
        data: {
          status: AlertStatus.RESOLVED,
          resolvedAt: new Date(),
        },
      });
    }
  } else if (openStockAlerts.length > 0) {
    await tx.alert.updateMany({
      where: {
        id: {
          in: openStockAlerts.map((alert) => alert.id),
        },
      },
      data: {
        status: AlertStatus.RESOLVED,
        resolvedAt: new Date(),
      },
    });
  }

  const countAlertSeverity =
    item.snapshot.urgency === AlertSeverity.CRITICAL
      ? AlertSeverity.CRITICAL
      : AlertSeverity.WARNING;
  const countAlertTitle = `Count verification needed for ${item.name}`;
  const countAlertMessage = latestCountEntry
    ? `${item.name} has not been counted recently enough for its current risk level.`
    : `${item.name} does not have a recent physical count on record.`;

  const openMissingCountAlert = await tx.alert.findFirst({
    where: {
      inventoryItemId,
      status: AlertStatus.OPEN,
      type: AlertType.MISSING_COUNT,
    },
  });

  const shouldAlertMissingCount =
    item.snapshot.urgency !== AlertSeverity.INFO &&
    isCountStale(latestCountEntry?.createdAt, 3, now);

  if (shouldAlertMissingCount) {
    if (openMissingCountAlert) {
      await tx.alert.update({
        where: { id: openMissingCountAlert.id },
        data: {
          severity: countAlertSeverity,
          title: countAlertTitle,
          message: countAlertMessage,
        },
      });
    } else {
      const alert = await tx.alert.create({
        data: {
          locationId: item.locationId,
          inventoryItemId,
          type: AlertType.MISSING_COUNT,
          severity: countAlertSeverity,
          title: countAlertTitle,
          message: countAlertMessage,
          metadata: {
            lastCountedAt: latestCountEntry?.createdAt?.toISOString() ?? null,
          },
        },
      });

      await queueManagerEmailNotificationsTx(tx, {
        locationId: item.locationId,
        alertId: alert.id,
        subject: alert.title,
        body: alert.message,
      });
    }
  } else if (openMissingCountAlert) {
    await tx.alert.update({
      where: { id: openMissingCountAlert.id },
      data: {
        status: AlertStatus.RESOLVED,
        resolvedAt: now,
      },
    });
  }

  const recentUsageBase = sumNegativeUsageBase(recentUsageMovements);
  const baselineUsageBase = sumNegativeUsageBase(baselineUsageMovements);
  const recentAverageDailyUsageBase = calculateAverageDailyUsage(recentUsageBase, 2);
  const baselineAverageDailyUsageBase = calculateAverageDailyUsage(baselineUsageBase, 5);
  const highUsageAlertTitle = `${item.name} usage is trending unusually high`;
  const highUsageAlertMessage = `${item.name} is consuming faster than its recent baseline and should be reviewed before the next supplier window.`;

  const openHighUsageAlert = await tx.alert.findFirst({
    where: {
      inventoryItemId,
      status: AlertStatus.OPEN,
      type: AlertType.HIGH_USAGE,
    },
  });

  const shouldAlertHighUsage = isHighUsageSpike({
    recentAverageDailyUsageBase,
    baselineAverageDailyUsageBase,
    multiplier: 1.45,
    minimumDeltaBase: item.baseUnit === "COUNT" ? 3 : 30,
  });

  if (shouldAlertHighUsage) {
    if (openHighUsageAlert) {
      await tx.alert.update({
        where: { id: openHighUsageAlert.id },
        data: {
          severity:
            item.snapshot.urgency === AlertSeverity.CRITICAL
              ? AlertSeverity.CRITICAL
              : AlertSeverity.WARNING,
          title: highUsageAlertTitle,
          message: highUsageAlertMessage,
          metadata: {
            recentAverageDailyUsageBase,
            baselineAverageDailyUsageBase,
          },
        },
      });
    } else {
      const alert = await tx.alert.create({
        data: {
          locationId: item.locationId,
          inventoryItemId,
          type: AlertType.HIGH_USAGE,
          severity:
            item.snapshot.urgency === AlertSeverity.CRITICAL
              ? AlertSeverity.CRITICAL
              : AlertSeverity.WARNING,
          title: highUsageAlertTitle,
          message: highUsageAlertMessage,
          metadata: {
            recentAverageDailyUsageBase,
            baselineAverageDailyUsageBase,
          },
        },
      });

      await queueManagerEmailNotificationsTx(tx, {
        locationId: item.locationId,
        alertId: alert.id,
        subject: alert.title,
        body: alert.message,
      });
    }
  } else if (openHighUsageAlert) {
    await tx.alert.update({
      where: { id: openHighUsageAlert.id },
      data: {
        status: AlertStatus.RESOLVED,
        resolvedAt: now,
      },
    });
  }

  const supplierItem = item.supplierItems[0];
  const existingRecommendation = await tx.reorderRecommendation.findFirst({
    where: {
      inventoryItemId,
      status: RecommendationStatus.PENDING_APPROVAL,
    },
  });
  const existingOrderAlert = await tx.alert.findFirst({
    where: {
      inventoryItemId,
      status: AlertStatus.OPEN,
      type: AlertType.ORDER_APPROVAL,
    },
  });

  // Two signals fire a reorder recommendation:
  //
  //   1. `snapshot.urgency` is WARNING or CRITICAL — the usage-
  //      projection says we'll be short before the next delivery.
  //      Needs recent usage history to work.
  //
  //   2. `stockOnHandBase <= lowStockThresholdBase` — the operator
  //      set an explicit floor and we've crossed it. Doesn't need
  //      usage history. THIS IS THE NEW ONE — previously the gate
  //      below only checked urgency, so brand-new items with no
  //      usage history would get a LOW_STOCK alert (fires on the
  //      same threshold) but NO reorder recommendation, forcing the
  //      operator to build the PO by hand even though they'd told
  //      us exactly when they wanted to reorder.
  //
  // Either signal fires the recommendation; we fall back to the
  // supplier's lead time (or 2 days default) when no urgency was
  // derived, so calculateRecommendedOrder still produces a sensible
  // pack-rounded quantity.
  const belowExplicitFloor =
    item.stockOnHandBase <= item.lowStockThresholdBase;
  const snapshotSaysReorder =
    item.snapshot.urgency !== AlertSeverity.INFO;
  const shouldRecommend = !!supplierItem && (belowExplicitFloor || snapshotSaysReorder);

  if (!shouldRecommend) {
    if (existingRecommendation) {
      await tx.reorderRecommendation.update({
        where: { id: existingRecommendation.id },
        data: {
          status: RecommendationStatus.DEFERRED,
          dismissedAt: new Date(),
        },
      });
    }

    if (existingOrderAlert) {
      await tx.alert.update({
        where: { id: existingOrderAlert.id },
        data: {
          status: AlertStatus.RESOLVED,
          resolvedAt: new Date(),
        },
      });
    }

    return;
  }

  const supplierDeliveryDays = parseDeliveryDays(supplierItem.deliveryDays);
  const itemDeliveryDays = parseDeliveryDays(item.deliveryDays);

  // If the snapshot can't give us a lead time, fall back to the
  // supplier's — otherwise a new item with leadTimeDays=0 (schema
  // default) bricks the urgency classifier and makes demand-cover
  // math zero-out. Using 2 days as a last-ditch floor so a wholly
  // unconfigured item still produces a sensible reorder quantity.
  const effectiveLeadTimeDays =
    supplierItem.leadTimeDays != null && supplierItem.leadTimeDays > 0
      ? supplierItem.leadTimeDays
      : item.leadTimeDays > 0
        ? item.leadTimeDays
        : 2;

  const order = calculateRecommendedOrder({
    stockOnHandBase: item.stockOnHandBase,
    averageDailyUsageBase: item.snapshot.averageDailyUsageBase,
    parLevelBase: item.parLevelBase,
    safetyStockBase: item.safetyStockBase,
    leadTimeDays: effectiveLeadTimeDays,
    deliveryDays: supplierDeliveryDays.length
      ? supplierDeliveryDays
      : itemDeliveryDays,
    packSizeBase: supplierItem.packSizeBase,
    minimumOrderQuantity: supplierItem.minimumOrderQuantity,
  });

  // If the urgency snapshot is INFO but we triggered on the explicit
  // threshold, synthesize WARNING so the recommendation's metadata,
  // UI badges, and rationale copy read correctly ("needs attention"
  // instead of "no issue").
  const effectiveUrgency =
    item.snapshot.urgency === AlertSeverity.INFO && belowExplicitFloor
      ? AlertSeverity.WARNING
      : item.snapshot.urgency;

  const rationale = buildRecommendationSummary({
    inventoryName: item.name,
    recommendedPackCount: order.recommendedPackCount,
    purchaseUnit: item.purchaseUnit,
    supplierName: supplierItem.supplier.name,
    urgency: effectiveUrgency,
  });

  const recommendation = existingRecommendation
    ? await tx.reorderRecommendation.update({
        where: { id: existingRecommendation.id },
        data: {
          supplierId: supplierItem.supplierId,
          status: RecommendationStatus.PENDING_APPROVAL,
          recommendedOrderQuantityBase: order.recommendedOrderQuantityBase,
          recommendedPurchaseUnit: item.purchaseUnit,
          recommendedPackCount: order.recommendedPackCount,
          projectedStockoutAt: item.snapshot.projectedRunoutAt,
          urgency: effectiveUrgency,
          rationale,
          dismissedAt: null,
        },
      })
    : await tx.reorderRecommendation.create({
        data: {
          locationId: item.locationId,
          inventoryItemId,
          supplierId: supplierItem.supplierId,
          status: RecommendationStatus.PENDING_APPROVAL,
          recommendedOrderQuantityBase: order.recommendedOrderQuantityBase,
          recommendedPurchaseUnit: item.purchaseUnit,
          recommendedPackCount: order.recommendedPackCount,
          projectedStockoutAt: item.snapshot.projectedRunoutAt,
          urgency: effectiveUrgency,
          rationale,
        },
      });

  const orderAlertTitle = `Approval needed for ${item.name} reorder`;
  const orderAlertMessage = `${rationale} Review and approve this recommendation before the next supplier window closes.`;

  if (existingOrderAlert) {
    await tx.alert.update({
      where: { id: existingOrderAlert.id },
      data: {
        severity: effectiveUrgency,
        title: orderAlertTitle,
        message: orderAlertMessage,
        metadata: {
          recommendationId: recommendation.id,
          supplierId: supplierItem.supplierId,
        },
      },
    });
  } else {
    const orderAlert = await tx.alert.create({
      data: {
        locationId: item.locationId,
        inventoryItemId,
        type: AlertType.ORDER_APPROVAL,
        severity: effectiveUrgency,
        title: orderAlertTitle,
        message: orderAlertMessage,
        metadata: {
          recommendationId: recommendation.id,
          supplierId: supplierItem.supplierId,
        },
      },
    });

    await queueManagerEmailNotificationsTx(tx, {
      locationId: item.locationId,
      alertId: orderAlert.id,
      subject: orderAlert.title,
      body: orderAlert.message,
    });
  }
}

export async function refreshOperationalState(
  locationId: string,
  inventoryItemIds: string[]
) {
  return db.$transaction(async (tx) => {
    const uniqueIds = [...new Set(inventoryItemIds)];

    for (const inventoryItemId of uniqueIds) {
      await refreshInventorySnapshotTx(tx, inventoryItemId);
      await syncAlertsAndRecommendationsTx(tx, inventoryItemId);
    }

    await createAuditLogTx(tx, {
      locationId,
      action: "inventory.refresh",
      entityType: "location",
      entityId: locationId,
      details: {
        inventoryItemIds: uniqueIds,
      },
    });
  });
}

export async function processSaleEventById(saleEventId: string, userId?: string) {
  const saleEvent = await db.posSaleEvent.findUnique({
    where: {
      id: saleEventId,
    },
    include: {
      lines: {
        include: {
          posVariation: {
            include: {
              mappings: {
                include: {
                  recipe: {
                    include: {
                      components: true,
                      // Hierarchical recipe tree: choice groups +
                      // options. Depletion walks this in addition to
                      // the flat components[] so old flat recipes
                      // keep working unchanged.
                      choiceGroups: {
                        include: { options: true },
                        orderBy: { sortOrder: "asc" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!saleEvent) {
    throw new Error("Sale event not found.");
  }

  const touchedItemIds = new Set<string>();

  await db.$transaction(async (tx) => {
    for (const line of saleEvent.lines) {
      const mapping = line.posVariation?.mappings[0];
      const explicitKeys = extractModifierKeys(line.modifierKeys, line.rawData);
      // Infer modifier keys from the variant name too. This is the
      // post-consolidation shim: a Square item named "Medium Iced
      // Vanilla Latte" arrives with NO modifier keys on the sale line,
      // but the merged recipe tree has size:medium + temp:iced +
      // syrup:vanilla options. We scan the name against those option
      // labels and union the matches with the explicit keys.
      const inferredKeys = mapping?.recipe
        ? inferModifierKeysFromVariationName(
            line.posVariation?.name,
            mapping.recipe.choiceGroups
          )
        : [];
      const lineModifierKeys = [
        ...new Set([...explicitKeys, ...inferredKeys]),
      ];

      if (!mapping || mapping.mappingStatus !== MappingStatus.READY || !mapping.recipe) {
        await tx.alert.create({
          data: {
            locationId: saleEvent.locationId,
            type: AlertType.RECIPE_GAP,
            severity: AlertSeverity.WARNING,
            title: "Recipe mapping gap blocked automatic depletion",
            message: `Variation ${line.posVariation?.name ?? line.externalLineId} needs manager review before depletion can continue.`,
          },
        });
        continue;
      }

      // Resolve size-scale factor for this sale. If the recipe has a
      // SIZE_SCALE choice group, pick the matching option's
      // sizeScaleFactor; otherwise 1.0. Applied uniformly to all base
      // components (liquids, cups, everything tracks menu size).
      const sizeGroup = mapping.recipe.choiceGroups.find(
        (g) => g.groupType === "SIZE_SCALE"
      );
      let sizeScale = 1.0;
      if (sizeGroup) {
        const chosen =
          sizeGroup.options.find((o) =>
            lineModifierKeys.includes(o.modifierKey)
          ) ?? sizeGroup.options.find((o) => o.isDefault) ?? null;
        if (chosen) sizeScale = chosen.sizeScaleFactor;
      }

      // 1. Walk base components (always-applied), scaled by size.
      for (const component of mapping.recipe.components) {
        if (!componentMatchesServiceMode(line.serviceMode, component.conditionServiceMode)) {
          continue;
        }

        if (!componentMatchesModifierKey(component.modifierKey, lineModifierKeys)) {
          continue;
        }

        // Only scale INGREDIENTS by size; packaging (cups/lids) size
        // is handled by the SIZE_SCALE group's per-size cup options.
        const effectiveQty =
          component.componentType === "INGREDIENT"
            ? component.quantityBase * sizeScale
            : component.quantityBase;
        const quantityDeltaBase = -1 * Math.round(effectiveQty) * line.quantity;
        if (quantityDeltaBase === 0) continue;
        touchedItemIds.add(component.inventoryItemId);

        await postStockMovementTx(tx, {
          locationId: saleEvent.locationId,
          inventoryItemId: component.inventoryItemId,
          quantityDeltaBase,
          movementType: MovementType.POS_DEPLETION,
          sourceType: "pos_sale_line",
          sourceId: line.id,
          metadata: {
            saleEventId: saleEvent.id,
            quantity: line.quantity,
            modifiers: lineModifierKeys,
            sizeScale,
            source: "base-component",
          },
          userId,
        });
      }

      // 2. Walk choice-group tree. For each group, pick matching
      //    option(s) from the line's modifier keys. SIZE_SCALE groups
      //    only deplete if the option has an inventoryItemId (e.g.
      //    a specific-sized cup); otherwise they're pure multipliers.
      for (const group of mapping.recipe.choiceGroups) {
        const matched: Array<(typeof group.options)[number]> = [];
        if (group.groupType === "SINGLE_SELECT" || group.groupType === "SIZE_SCALE") {
          const choice =
            group.options.find((o) =>
              lineModifierKeys.includes(o.modifierKey)
            ) ?? group.options.find((o) => o.isDefault) ?? null;
          if (choice) matched.push(choice);
        } else if (group.groupType === "MULTI_SELECT") {
          for (const o of group.options) {
            if (lineModifierKeys.includes(o.modifierKey)) matched.push(o);
          }
        }

        for (const option of matched) {
          if (!option.inventoryItemId || option.quantityBase <= 0) continue;
          // SINGLE_SELECT options (like milk) get size-scaled too —
          // a large oat milk latte uses more oat milk than a small.
          const effectiveQty =
            group.groupType === "SINGLE_SELECT"
              ? option.quantityBase * sizeScale
              : option.quantityBase;
          const quantityDeltaBase =
            -1 * Math.round(effectiveQty) * line.quantity;
          if (quantityDeltaBase === 0) continue;
          touchedItemIds.add(option.inventoryItemId);

          await postStockMovementTx(tx, {
            locationId: saleEvent.locationId,
            inventoryItemId: option.inventoryItemId,
            quantityDeltaBase,
            movementType: MovementType.POS_DEPLETION,
            sourceType: "pos_sale_line",
            sourceId: line.id,
            metadata: {
              saleEventId: saleEvent.id,
              quantity: line.quantity,
              modifiers: lineModifierKeys,
              sizeScale,
              source: "choice-option",
              groupName: group.name,
              optionLabel: option.label,
            },
            userId,
          });
        }
      }
    }

    await tx.posSaleEvent.update({
      where: {
        id: saleEvent.id,
      },
      data: {
        processingStatus: SaleProcessingStatus.PROCESSED,
        processedAt: new Date(),
      },
    });
  });

  await refreshOperationalState(saleEvent.locationId, [...touchedItemIds]);
}

export async function submitCountEntry(input: {
  sessionId: string;
  inventoryItemId: string;
  countedBase: number;
  userId: string;
  notes?: string;
}) {
  const session = await db.stockCountSession.findUniqueOrThrow({
    where: {
      id: input.sessionId,
    },
  });

  const item = await db.inventoryItem.findUniqueOrThrow({
    where: {
      id: input.inventoryItemId,
    },
  });

  const adjustmentBase = calculateCountAdjustment(item.stockOnHandBase, input.countedBase);

  await db.$transaction(async (tx) => {
    await tx.stockCountEntry.create({
      data: {
        sessionId: session.id,
        inventoryItemId: item.id,
        createdById: input.userId,
        expectedBase: item.stockOnHandBase,
        countedBase: input.countedBase,
        adjustmentBase,
        notes: input.notes,
        disposition:
          adjustmentBase === 0
            ? "CONFIRMED"
            : input.countedBase === 0
            ? "OUT"
            : adjustmentBase < 0
            ? "LOW"
            : "ADJUSTED",
      },
    });

    if (adjustmentBase !== 0) {
      await postStockMovementTx(tx, {
        locationId: session.locationId,
        inventoryItemId: item.id,
        quantityDeltaBase: adjustmentBase,
        movementType: MovementType.MANUAL_COUNT_ADJUSTMENT,
        sourceType: "stock_count_session",
        sourceId: session.id,
        notes: input.notes,
        userId: input.userId,
      });
    }
  });

  await refreshOperationalState(session.locationId, [item.id]);
}

export async function logWasteEntry(input: {
  sessionId: string;
  inventoryItemId: string;
  wastedBase: number;
  userId: string;
  notes?: string;
}) {
  const session = await db.stockCountSession.findUniqueOrThrow({
    where: {
      id: input.sessionId,
    },
  });

  const item = await db.inventoryItem.findUniqueOrThrow({
    where: {
      id: input.inventoryItemId,
    },
  });

  const wasteBase = Math.max(0, Math.round(input.wastedBase));
  const resultingCountedBase = Math.max(0, item.stockOnHandBase - wasteBase);

  await db.$transaction(async (tx) => {
    await tx.stockCountEntry.create({
      data: {
        sessionId: session.id,
        inventoryItemId: item.id,
        createdById: input.userId,
        expectedBase: item.stockOnHandBase,
        countedBase: resultingCountedBase,
        adjustmentBase: -wasteBase,
        notes: input.notes,
        disposition: wasteBase > 0 ? "WASTE" : "CONFIRMED",
      },
    });

    if (wasteBase > 0) {
      await postStockMovementTx(tx, {
        locationId: session.locationId,
        inventoryItemId: item.id,
        quantityDeltaBase: -wasteBase,
        movementType: MovementType.WASTE,
        sourceType: "stock_count_session",
        sourceId: session.id,
        notes: input.notes,
        userId: input.userId,
      });
    }
  });

  await refreshOperationalState(session.locationId, [item.id]);
}

export async function skipCountEntry(input: {
  sessionId: string;
  inventoryItemId: string;
  userId: string;
  notes?: string;
}) {
  const session = await db.stockCountSession.findUniqueOrThrow({
    where: {
      id: input.sessionId,
    },
  });

  const item = await db.inventoryItem.findUniqueOrThrow({
    where: {
      id: input.inventoryItemId,
    },
  });

  await db.stockCountEntry.create({
    data: {
      sessionId: session.id,
      inventoryItemId: item.id,
      createdById: input.userId,
      expectedBase: item.stockOnHandBase,
      countedBase: null,
      adjustmentBase: null,
      notes: input.notes,
      disposition: "SKIPPED",
    },
  });
}

export async function recordInventoryMovement(input: {
  locationId: string;
  inventoryItemId: string;
  movementType: MovementType;
  quantityDeltaBase: number;
  userId: string;
  notes?: string;
  sourceType?: string;
  sourceId?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await db.$transaction(async (tx) => {
    await postStockMovementTx(tx, {
      locationId: input.locationId,
      inventoryItemId: input.inventoryItemId,
      quantityDeltaBase: input.quantityDeltaBase,
      movementType: input.movementType,
      sourceType: input.sourceType ?? "manual_inventory_adjustment",
      sourceId: input.sourceId ?? input.inventoryItemId,
      notes: input.notes,
      metadata: input.metadata,
      userId: input.userId,
    });

    await createAuditLogTx(tx, {
      locationId: input.locationId,
      userId: input.userId,
      action: "inventory.movement_recorded",
      entityType: "inventoryItem",
      entityId: input.inventoryItemId,
      details: {
        movementType: input.movementType,
        quantityDeltaBase: input.quantityDeltaBase,
        notes: input.notes ?? null,
      },
    });
  });

  await refreshOperationalState(input.locationId, [input.inventoryItemId]);
}

