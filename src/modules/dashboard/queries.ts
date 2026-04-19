import { AlertStatus, MappingStatus, RecipeStatus } from "@/lib/domain-enums";

import { db } from "@/lib/db";

export async function getDashboardData(locationId: string) {
  const [inventory, alerts, recommendations, recipes, tasks, jobs, purchaseOrders] =
    await Promise.all([
      db.inventoryItem.findMany({
        where: { locationId },
        include: { snapshot: true, primarySupplier: true },
        orderBy: { name: "asc" },
      }),
      db.alert.findMany({
        where: { locationId, status: AlertStatus.OPEN },
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        take: 6,
      }),
      db.reorderRecommendation.findMany({
        where: { locationId },
        include: { inventoryItem: true, supplier: true },
        orderBy: { createdAt: "desc" },
        take: 4,
      }),
      db.recipe.findMany({
        where: { locationId },
        include: { menuItemVariant: { include: { menuItem: true } } },
        orderBy: { updatedAt: "desc" },
        take: 4,
      }),
      db.agentTask.findMany({
        where: { locationId },
        include: { supplier: true },
        orderBy: { updatedAt: "desc" },
        take: 4,
      }),
      db.jobRun.findMany({
        where: { locationId },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      db.purchaseOrder.findMany({
        where: { locationId },
        include: { supplier: true, lines: true },
        orderBy: { createdAt: "desc" },
        take: 4,
      }),
    ]);

  const lowStockCount = inventory.filter(
    (item) => item.stockOnHandBase <= item.lowStockThresholdBase
  ).length;
  const criticalCount = inventory.filter(
    (item) => item.snapshot?.urgency === "CRITICAL"
  ).length;

  return {
    metrics: {
      inventoryCount: inventory.length,
      lowStockCount,
      criticalCount,
      pendingRecommendations: recommendations.filter(
        (recommendation) => recommendation.status === "PENDING_APPROVAL"
      ).length,
      pendingRecipes: recipes.filter((recipe) => recipe.status === RecipeStatus.DRAFT)
        .length,
    },
    inventory,
    alerts,
    recommendations,
    recipes,
    tasks,
    jobs,
    purchaseOrders,
  };
}

export async function getInventoryList(locationId: string) {
  return db.inventoryItem.findMany({
    where: { locationId },
    include: {
      snapshot: true,
      primarySupplier: true,
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}

export async function getInventoryItemDetail(locationId: string, itemId: string) {
  return db.inventoryItem.findFirstOrThrow({
    where: {
      id: itemId,
      locationId,
    },
    include: {
      snapshot: true,
      primarySupplier: true,
      stockMovements: {
        orderBy: { performedAt: "desc" },
        take: 12,
      },
      supplierItems: {
        include: { supplier: true },
      },
      reorderRecommendations: {
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { supplier: true },
      },
      alerts: {
        orderBy: { createdAt: "desc" },
        take: 6,
      },
    },
  });
}

export async function getStockCountPageData(locationId: string) {
  const [items, openSession] = await Promise.all([
    db.inventoryItem.findMany({
      where: { locationId },
      include: {
        snapshot: true,
        primarySupplier: true,
        stockCountEntries: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: [{ snapshot: { urgency: "desc" } }, { name: "asc" }],
    }),
    db.stockCountSession.findFirst({
      where: {
        locationId,
        status: "IN_PROGRESS",
      },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  return { items, openSession };
}

export async function getRecipesPageData(
  locationId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {},
) {
  return db.recipe.findMany({
    where: {
      locationId,
      ...(includeArchived ? {} : { status: { not: "ARCHIVED" } }),
    },
    include: {
      menuItemVariant: { include: { menuItem: true } },
      components: { include: { inventoryItem: true } },
      approvedBy: true,
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });
}

export async function getArchivedRecipeCount(locationId: string) {
  return db.recipe.count({
    where: { locationId, status: "ARCHIVED" },
  });
}

export async function getRecipeDetail(locationId: string, recipeId: string) {
  return db.recipe.findFirstOrThrow({
    where: {
      id: recipeId,
      locationId,
    },
    include: {
      menuItemVariant: { include: { menuItem: true } },
      components: { include: { inventoryItem: true } },
      mappings: {
        include: {
          posVariation: true,
        },
      },
    },
  });
}

export async function getPosMappingData(locationId: string) {
  return db.posVariationMapping.findMany({
    where: { locationId },
    include: {
      posVariation: { include: { catalogItem: true } },
      menuItemVariant: { include: { menuItem: true } },
      recipe: true,
    },
    orderBy: [{ mappingStatus: "asc" }, { updatedAt: "desc" }],
  });
}

export async function getPosMappingDetail(locationId: string, mappingId: string) {
  const [mapping, variants, recipes] = await Promise.all([
    db.posVariationMapping.findFirstOrThrow({
      where: {
        id: mappingId,
        locationId,
      },
      include: {
        posVariation: {
          include: {
            catalogItem: true,
          },
        },
        menuItemVariant: {
          include: {
            menuItem: true,
          },
        },
        recipe: {
          include: {
            menuItemVariant: {
              include: {
                menuItem: true,
              },
            },
          },
        },
      },
    }),
    db.menuItemVariant.findMany({
      where: {
        menuItem: {
          locationId,
        },
      },
      include: {
        menuItem: true,
      },
      orderBy: [{ menuItem: { name: "asc" } }, { name: "asc" }],
    }),
    db.recipe.findMany({
      where: {
        locationId,
      },
      include: {
        menuItemVariant: {
          include: {
            menuItem: true,
          },
        },
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    }),
  ]);

  return {
    mapping,
    variants,
    recipes,
  };
}

export async function getSuppliersPageData(locationId: string) {
  const suppliers = await db.supplier.findMany({
    where: { locationId },
    include: {
      supplierItems: { include: { inventoryItem: true } },
      purchaseOrders: {
        orderBy: { createdAt: "desc" },
        take: 3,
      },
    },
    orderBy: { name: "asc" },
  });
  // Annotate with credential status — computed server-side so the
  // list page can render a "Connected" / "Not connected" chip without
  // each Link re-running the decrypt.
  const { summariseStoredCredentials } = await import(
    "@/modules/suppliers/website-credentials"
  );
  return suppliers.map((s) => ({
    ...s,
    credentialsState: summariseStoredCredentials(s.websiteCredentials),
  }));
}

export async function getSupplierDetail(locationId: string, supplierId: string) {
  return db.supplier.findFirstOrThrow({
    where: {
      id: supplierId,
      locationId,
    },
    include: {
      supplierItems: { include: { inventoryItem: { include: { snapshot: true } } } },
      purchaseOrders: {
        include: { lines: true },
        orderBy: { createdAt: "desc" },
      },
      communications: {
        orderBy: { createdAt: "desc" },
      },
      agentTasks: {
        orderBy: { updatedAt: "desc" },
      },
    },
  });
}

/**
 * Money-pulse widget for the dashboard. The MarginEdge killer
 * feature in one card — what did this week cost, what's moving,
 * what's waiting. Read-only aggregation; cheap enough to run on
 * every dashboard load (a few indexed queries, no joins beyond
 * the PO row itself).
 *
 * All amounts in cents. Null-safe for brand-new locations with no
 * orders yet — returns zeros and an empty-state flag the card uses
 * to show a coaching message instead of fake stats.
 */
export async function getMoneyPulse(locationId: string): Promise<{
  weekSpentCents: number;
  weekOrderCount: number;
  autoApprovedCount: number;
  pendingCount: number;
  pendingTotalCents: number;
  priceAlert:
    | null
    | {
        itemName: string;
        oldCents: number;
        newCents: number;
        deltaPct: number;
      };
  isEmpty: boolean;
}> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [weekPos, pendingPos, autoApprovedLogs, variances] = await Promise.all([
    // Sent in the last 7 days — what we spent.
    db.purchaseOrder.findMany({
      where: {
        locationId,
        status: { in: ["SENT", "ACKNOWLEDGED", "DELIVERED"] },
        sentAt: { gte: weekAgo },
      },
      select: {
        id: true,
        lines: {
          select: {
            quantityOrdered: true,
            latestCostCents: true,
            actualUnitCostCents: true,
          },
        },
      },
    }),
    // Still waiting for a human tap.
    db.purchaseOrder.findMany({
      where: {
        locationId,
        status: { in: ["DRAFT", "AWAITING_APPROVAL"] },
      },
      select: {
        id: true,
        lines: {
          select: { quantityOrdered: true, latestCostCents: true },
        },
      },
    }),
    // Audit rows for bot auto-approvals this week.
    db.auditLog.findMany({
      where: {
        locationId,
        action: "bot.outbound_replied",
        createdAt: { gte: weekAgo },
      },
      select: { details: true },
      take: 100,
    }),
    // Price-jump alerts: look at the most recent variance-review
    // audit we wrote from deliverPurchaseOrder.
    db.auditLog.findFirst({
      where: {
        locationId,
        action: "purchaseOrder.priceVariance.review",
        createdAt: { gte: weekAgo },
      },
      orderBy: { createdAt: "desc" },
      select: { details: true },
    }),
  ]);

  const sumLines = (
    lines: Array<{
      quantityOrdered: number;
      latestCostCents?: number | null;
      actualUnitCostCents?: number | null;
    }>
  ) =>
    lines.reduce((sum, l) => {
      const unit = l.actualUnitCostCents ?? l.latestCostCents ?? 0;
      return sum + unit * l.quantityOrdered;
    }, 0);

  const weekSpentCents = weekPos.reduce((s, po) => s + sumLines(po.lines), 0);
  const pendingTotalCents = pendingPos.reduce((s, po) => s + sumLines(po.lines), 0);

  // Count auto-approved deliveries this week — the "bot sent it
  // while I slept" signal.
  const autoApprovedCount = autoApprovedLogs.filter((row) => {
    const d = row.details as { replyScenario?: string } | null;
    return d?.replyScenario === "order_auto_approved";
  }).length;

  let priceAlert: {
    itemName: string;
    oldCents: number;
    newCents: number;
    deltaPct: number;
  } | null = null;
  if (variances?.details) {
    const d = variances.details as {
      description?: string;
      expectedCents?: number;
      actualCents?: number;
      deltaPct?: number;
    };
    if (
      d.description &&
      typeof d.expectedCents === "number" &&
      typeof d.actualCents === "number" &&
      typeof d.deltaPct === "number"
    ) {
      priceAlert = {
        itemName: d.description,
        oldCents: d.expectedCents,
        newCents: d.actualCents,
        deltaPct: d.deltaPct,
      };
    }
  }

  return {
    weekSpentCents,
    weekOrderCount: weekPos.length,
    autoApprovedCount,
    pendingCount: pendingPos.length,
    pendingTotalCents,
    priceAlert,
    isEmpty:
      weekPos.length === 0 && pendingPos.length === 0 && priceAlert == null,
  };
}

export async function getPurchaseOrdersData(locationId: string) {
  const [recommendations, purchaseOrders] = await Promise.all([
    db.reorderRecommendation.findMany({
      where: { locationId },
      include: { inventoryItem: true, supplier: true },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    db.purchaseOrder.findMany({
      where: { locationId },
      include: { supplier: true, lines: { include: { inventoryItem: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return { recommendations, purchaseOrders };
}

export async function getPurchaseOrderDetail(locationId: string, purchaseOrderId: string) {
  const [purchaseOrder, auditLogs] = await Promise.all([
    db.purchaseOrder.findFirstOrThrow({
      where: {
        id: purchaseOrderId,
        locationId,
      },
      // The PO row carries the invoiceImage Bytes column which can
      // be several MB. Omitting it here keeps the SSR payload light;
      // the image is served separately via GET /api/purchase-orders
      // /[id]/invoice when the UI actually wants to display it. The
      // parsed JSON + parsedAt are kept — they're tiny and drive
      // the ReceivePanel's rehydration on page load.
      omit: { invoiceImage: true },
      include: {
        supplier: true,
        recommendation: {
          include: {
            inventoryItem: true,
          },
        },
        lines: {
          include: {
            inventoryItem: {
              include: {
                snapshot: true,
              },
            },
          },
        },
        communications: {
          orderBy: {
            createdAt: "desc",
          },
        },
        agentTasks: {
          orderBy: {
            updatedAt: "desc",
          },
        },
      },
    }),
    db.auditLog.findMany({
      where: {
        locationId,
        entityType: "purchaseOrder",
        entityId: purchaseOrderId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 20,
    }),
  ]);

  return {
    ...purchaseOrder,
    auditLogs,
  };
}

export async function getAlertsPageData(locationId: string) {
  return db.alert.findMany({
    where: { locationId },
    include: {
      inventoryItem: true,
      notifications: {
        orderBy: { createdAt: "desc" },
        take: 3,
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

export async function getNotificationsPageData(locationId: string) {
  return db.notification.findMany({
    where: { locationId },
    include: {
      alert: true,
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
}

export async function getAgentTasksData(locationId: string) {
  return db.agentTask.findMany({
    where: { locationId },
    include: { supplier: true, purchaseOrder: true },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getSettingsData(locationId: string) {
  const { describeSupplierOrderProvider } = await import(
    "@/providers/supplier-order-provider"
  );
  const [integration, jobs, auditLogs, emailProvider] = await Promise.all([
    db.posIntegration.findFirst({
      where: {
        locationId,
      },
    }),
    db.jobRun.findMany({
      where: { locationId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.auditLog.findMany({
      where: { locationId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    describeSupplierOrderProvider(locationId),
  ]);

  return { integration, jobs, auditLogs, emailProvider };
}

export async function getAssistantSummary(locationId: string) {
  const [alerts, recipes, anomalies] = await Promise.all([
    db.alert.findMany({
      where: {
        locationId,
        status: AlertStatus.OPEN,
      },
      include: { inventoryItem: true },
      take: 3,
    }),
    db.recipe.findMany({
      where: {
        locationId,
        status: RecipeStatus.DRAFT,
      },
      include: { menuItemVariant: true },
      take: 3,
    }),
    db.posVariationMapping.findMany({
      where: {
        locationId,
        mappingStatus: { in: [MappingStatus.RECIPE_DRAFT, MappingStatus.NEEDS_REVIEW] },
      },
      include: { posVariation: true },
      take: 3,
    }),
  ]);

  return {
    lowStockItems: alerts
      .map((alert) => alert.inventoryItem?.name)
      .filter(Boolean) as string[],
    pendingApprovals: recipes.map((recipe) => recipe.menuItemVariant.name),
    recentAnomalies: anomalies.map((mapping) => mapping.posVariation.name),
  };
}

export async function getAssistantPanelData(locationId: string) {
  const [alerts, recommendations, tasks] = await Promise.all([
    db.alert.findMany({
      where: {
        locationId,
        status: AlertStatus.OPEN,
      },
      include: {
        inventoryItem: true,
      },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: 3,
    }),
    db.reorderRecommendation.findMany({
      where: {
        locationId,
        status: "PENDING_APPROVAL",
      },
      include: {
        inventoryItem: true,
        supplier: true,
      },
      orderBy: [{ urgency: "desc" }, { createdAt: "desc" }],
      take: 3,
    }),
    db.agentTask.findMany({
      where: {
        locationId,
        status: {
          in: ["PENDING", "READY_FOR_REVIEW"],
        },
      },
      include: {
        supplier: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 3,
    }),
  ]);

  return {
    alerts,
    recommendations,
    tasks,
  };
}

