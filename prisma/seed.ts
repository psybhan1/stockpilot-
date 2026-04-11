import "dotenv/config";
import bcrypt from "bcryptjs";
import {
  AgentTaskStatus,
  AgentTaskType,
  AlertSeverity,
  AlertStatus,
  AlertType,
  CountSessionMode,
  CountSessionStatus,
  InventoryCategory,
  IntegrationStatus,
  JobStatus,
  JobType,
  MappingStatus,
  NotificationChannel,
  NotificationStatus,
  PosProviderType,
  PurchaseOrderStatus,
  RecommendationStatus,
  RecipeStatus,
  Role,
  ServiceMode,
  SupplierOrderingMode,
  createPrismaClient,
} from "../src/lib/prisma";
import type { Prisma } from "../src/lib/prisma";

const prisma = createPrismaClient();

function toDeliveryDaysJson(days: readonly number[]): Prisma.InputJsonValue {
  return [...days];
}

const catalog = [
  {
    externalItemId: "sq-item-espresso",
    name: "Espresso",
    category: "Coffee",
    imageUrl: "/inventory/espresso.svg",
    variations: [{ externalVariationId: "sq-var-espresso-single", name: "Espresso", serviceMode: ServiceMode.DINE_IN, priceCents: 350 }],
  },
  {
    externalItemId: "sq-item-americano",
    name: "Americano",
    category: "Coffee",
    imageUrl: "/inventory/americano.svg",
    variations: [{ externalVariationId: "sq-var-americano-medium", name: "Americano", serviceMode: ServiceMode.TO_GO, priceCents: 450 }],
  },
  {
    externalItemId: "sq-item-cappuccino",
    name: "Cappuccino",
    category: "Coffee",
    imageUrl: "/inventory/cappuccino.svg",
    variations: [{ externalVariationId: "sq-var-cappuccino-medium", name: "Cappuccino", serviceMode: ServiceMode.TO_GO, priceCents: 520 }],
  },
  {
    externalItemId: "sq-item-latte",
    name: "Latte",
    category: "Coffee",
    imageUrl: "/inventory/latte.svg",
    variations: [
      { externalVariationId: "sq-var-latte-medium", name: "Medium Latte", serviceMode: ServiceMode.TO_GO, priceCents: 560 },
      { externalVariationId: "sq-var-latte-iced-large", name: "Large Iced Vanilla Latte", serviceMode: ServiceMode.TO_GO, priceCents: 690 },
    ],
  },
  {
    externalItemId: "sq-item-matcha",
    name: "Matcha Latte",
    category: "Tea",
    imageUrl: "/inventory/matcha.svg",
    variations: [{ externalVariationId: "sq-var-matcha-medium", name: "Matcha Latte", serviceMode: ServiceMode.TO_GO, priceCents: 620 }],
  },
  {
    externalItemId: "sq-item-mocha",
    name: "Mocha",
    category: "Coffee",
    imageUrl: "/inventory/mocha.svg",
    variations: [{ externalVariationId: "sq-var-mocha-medium", name: "Mocha", serviceMode: ServiceMode.TO_GO, priceCents: 650 }],
  },
];

async function reset() {
  await prisma.notification.deleteMany();
  await prisma.agentTask.deleteMany();
  await prisma.supplierCommunication.deleteMany();
  await prisma.purchaseOrderLine.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.reorderRecommendation.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.posSaleLine.deleteMany();
  await prisma.posSaleEvent.deleteMany();
  await prisma.posVariationMapping.deleteMany();
  await prisma.recipeComponent.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.menuItemVariant.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.posCatalogVariation.deleteMany();
  await prisma.posCatalogItem.deleteMany();
  await prisma.posSyncRun.deleteMany();
  await prisma.posIntegration.deleteMany();
  await prisma.stockCountEntry.deleteMany();
  await prisma.stockCountSession.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.inventorySnapshot.deleteMany();
  await prisma.inventoryUnitConversion.deleteMany();
  await prisma.supplierItem.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.jobRun.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.userLocationRole.deleteMany();
  await prisma.location.deleteMany();
  await prisma.business.deleteMany();
  await prisma.user.deleteMany();
}

function componentsForVariation(name: string) {
  if (name === "Large Iced Vanilla Latte") {
    return [
      ["INV-BEANS-ESP", "INGREDIENT", 20, "GRAM"],
      ["INV-OAT-01", "INGREDIENT", 320, "MILLILITER"],
      ["INV-SYR-VAN", "INGREDIENT", 30, "MILLILITER"],
      ["INV-CUP-HOT-16", "PACKAGING", 1, "COUNT"],
      ["INV-LID-HOT-16", "PACKAGING", 1, "COUNT"],
    ] as const;
  }

  if (name === "Matcha Latte") {
    return [
      ["INV-MATCHA-01", "INGREDIENT", 12, "GRAM"],
      ["INV-MILK-DAIRY", "INGREDIENT", 240, "MILLILITER"],
      ["INV-CUP-HOT-16", "PACKAGING", 1, "COUNT"],
    ] as const;
  }

  if (name === "Mocha") {
    return [
      ["INV-BEANS-ESP", "INGREDIENT", 18, "GRAM"],
      ["INV-MILK-DAIRY", "INGREDIENT", 220, "MILLILITER"],
      ["INV-CHOC-01", "INGREDIENT", 35, "MILLILITER"],
      ["INV-CUP-HOT-16", "PACKAGING", 1, "COUNT"],
    ] as const;
  }

  if (name === "Espresso") {
    return [["INV-BEANS-ESP", "INGREDIENT", 18, "GRAM"]] as const;
  }

  return [
    ["INV-BEANS-ESP", "INGREDIENT", 18, "GRAM"],
    ["INV-MILK-DAIRY", "INGREDIENT", 220, "MILLILITER"],
    ["INV-CUP-HOT-16", "PACKAGING", 1, "COUNT"],
    ["INV-LID-HOT-16", "PACKAGING", 1, "COUNT"],
    ["INV-SLEEVE-01", "PACKAGING", 1, "COUNT"],
  ] as const;
}

async function main() {
  await reset();

  const business = await prisma.business.create({
    data: {
      name: "Northside Coffee",
      slug: "northside-coffee",
      locations: {
        create: {
          name: "Queen Street",
          timezone: "America/Toronto",
          isPrimary: true,
        },
      },
    },
    include: { locations: true },
  });

  const location = business.locations[0]!;
  const passwordHash = await bcrypt.hash("demo1234", 10);

  const [manager, supervisor, staff] = await Promise.all([
    prisma.user.create({
      data: {
        email: "manager@stockpilot.dev",
        name: "Maya Manager",
        phoneNumber: "+15555550123",
        telegramChatId: "700100200",
        telegramUsername: "maya_manager",
        passwordHash,
      },
    }),
    prisma.user.create({
      data: {
        email: "supervisor@stockpilot.dev",
        name: "Sam Supervisor",
        passwordHash,
      },
    }),
    prisma.user.create({
      data: {
        email: "staff@stockpilot.dev",
        name: "Tori Staff",
        passwordHash,
      },
    }),
  ]);

  await prisma.userLocationRole.createMany({
    data: [
      { userId: manager.id, locationId: location.id, role: Role.MANAGER },
      { userId: supervisor.id, locationId: location.id, role: Role.SUPERVISOR },
      { userId: staff.id, locationId: location.id, role: Role.STAFF },
    ],
  });

  const suppliers = {
    dairy: await prisma.supplier.create({
      data: {
        locationId: location.id,
        name: "DairyFlow Wholesale",
        contactName: "Nadia Singh",
        email: "orders@dairyflow.test",
        phone: "+1-416-555-0181",
        website: "https://dairyflow.example",
        orderingMode: SupplierOrderingMode.EMAIL,
        leadTimeDays: 2,
        deliveryDays: toDeliveryDaysJson([1, 4]),
        minimumOrderQuantity: 1,
        notes: "Tuesday and Friday dairy drops.",
      },
    }),
    packaging: await prisma.supplier.create({
      data: {
        locationId: location.id,
        name: "PackStreet Supply",
        contactName: "Chris Vega",
        email: "ops@packstreet.test",
        website: "https://portal.packstreet.example",
        orderingMode: SupplierOrderingMode.WEBSITE,
        leadTimeDays: 3,
        deliveryDays: toDeliveryDaysJson([2, 5]),
        minimumOrderQuantity: 1,
        credentialsConfigured: true,
        notes: "Website ordering only. Final checkout remains manager-approved.",
      },
    }),
    cleaning: await prisma.supplier.create({
      data: {
        locationId: location.id,
        name: "CleanWorks Depot",
        orderingMode: SupplierOrderingMode.MANUAL,
        leadTimeDays: 4,
        deliveryDays: toDeliveryDaysJson([3]),
        minimumOrderQuantity: 1,
      },
    }),
  };

  const inventorySeed = [
    { name: "Espresso Beans", sku: "INV-BEANS-ESP", category: InventoryCategory.COFFEE, imageUrl: "/inventory/espresso.svg", baseUnit: "GRAM", countUnit: "GRAM", displayUnit: "KILOGRAM", purchaseUnit: "BAG", stockOnHandBase: 12000, parLevelBase: 14000, lowStockThresholdBase: 7000, safetyStockBase: 4000, primarySupplierId: suppliers.dairy.id, leadTimeDays: 3, deliveryDays: [1, 4], minimumOrderQuantity: 2, packSizeBase: 1000, latestCostNote: "$26.50 / kg", confidenceScore: 0.93 },
    { name: "Whole Milk", sku: "INV-MILK-DAIRY", category: InventoryCategory.DAIRY, imageUrl: "/inventory/milk.svg", baseUnit: "MILLILITER", countUnit: "MILLILITER", displayUnit: "LITER", purchaseUnit: "CASE", stockOnHandBase: 16000, parLevelBase: 22000, lowStockThresholdBase: 8000, safetyStockBase: 6000, primarySupplierId: suppliers.dairy.id, leadTimeDays: 2, deliveryDays: [1, 4], minimumOrderQuantity: 1, packSizeBase: 12000, latestCostNote: "$29 / case", confidenceScore: 0.88 },
    { name: "Oat Milk", sku: "INV-OAT-01", category: InventoryCategory.ALT_DAIRY, imageUrl: "/inventory/oat-milk.svg", baseUnit: "MILLILITER", countUnit: "MILLILITER", displayUnit: "LITER", purchaseUnit: "CASE", stockOnHandBase: 3500, parLevelBase: 12000, lowStockThresholdBase: 4000, safetyStockBase: 3000, primarySupplierId: suppliers.dairy.id, leadTimeDays: 2, deliveryDays: [1, 4], minimumOrderQuantity: 1, packSizeBase: 8000, latestCostNote: "$34 / case", confidenceScore: 0.72 },
    { name: "Vanilla Syrup", sku: "INV-SYR-VAN", category: InventoryCategory.SYRUP, imageUrl: "/inventory/vanilla.svg", baseUnit: "MILLILITER", countUnit: "MILLILITER", displayUnit: "LITER", purchaseUnit: "BOTTLE", stockOnHandBase: 2200, parLevelBase: 3000, lowStockThresholdBase: 1200, safetyStockBase: 700, primarySupplierId: suppliers.dairy.id, leadTimeDays: 4, deliveryDays: [2], minimumOrderQuantity: 1, packSizeBase: 1000, latestCostNote: "$14 / bottle", confidenceScore: 0.84 },
    { name: "16 oz Hot Cups", sku: "INV-CUP-HOT-16", category: InventoryCategory.PACKAGING, imageUrl: "/inventory/cup.svg", baseUnit: "COUNT", countUnit: "COUNT", displayUnit: "COUNT", purchaseUnit: "CASE", stockOnHandBase: 180, parLevelBase: 360, lowStockThresholdBase: 80, safetyStockBase: 60, primarySupplierId: suppliers.packaging.id, leadTimeDays: 3, deliveryDays: [2, 5], minimumOrderQuantity: 2, packSizeBase: 100, latestCostNote: "$52 / case", confidenceScore: 0.78 },
    { name: "16 oz Hot Lids", sku: "INV-LID-HOT-16", category: InventoryCategory.PACKAGING, imageUrl: "/inventory/lid.svg", baseUnit: "COUNT", countUnit: "COUNT", displayUnit: "COUNT", purchaseUnit: "CASE", stockOnHandBase: 140, parLevelBase: 360, lowStockThresholdBase: 80, safetyStockBase: 60, primarySupplierId: suppliers.packaging.id, leadTimeDays: 3, deliveryDays: [2, 5], minimumOrderQuantity: 2, packSizeBase: 100, latestCostNote: "$34 / case", confidenceScore: 0.78 },
    { name: "Cup Sleeves", sku: "INV-SLEEVE-01", category: InventoryCategory.PACKAGING, imageUrl: "/inventory/sleeve.svg", baseUnit: "COUNT", countUnit: "COUNT", displayUnit: "COUNT", purchaseUnit: "CASE", stockOnHandBase: 90, parLevelBase: 240, lowStockThresholdBase: 40, safetyStockBase: 40, primarySupplierId: suppliers.packaging.id, leadTimeDays: 3, deliveryDays: [2, 5], minimumOrderQuantity: 1, packSizeBase: 100, latestCostNote: "$17 / case", confidenceScore: 0.76 },
    { name: "Matcha Powder", sku: "INV-MATCHA-01", category: InventoryCategory.SEASONAL, imageUrl: "/inventory/matcha.svg", baseUnit: "GRAM", countUnit: "GRAM", displayUnit: "GRAM", purchaseUnit: "BAG", stockOnHandBase: 800, parLevelBase: 1000, lowStockThresholdBase: 300, safetyStockBase: 250, primarySupplierId: suppliers.dairy.id, leadTimeDays: 4, deliveryDays: [2], minimumOrderQuantity: 1, packSizeBase: 500, latestCostNote: "$36 / bag", confidenceScore: 0.8 },
    { name: "Chocolate Sauce", sku: "INV-CHOC-01", category: InventoryCategory.SYRUP, imageUrl: "/inventory/mocha.svg", baseUnit: "MILLILITER", countUnit: "MILLILITER", displayUnit: "MILLILITER", purchaseUnit: "BOTTLE", stockOnHandBase: 1600, parLevelBase: 2000, lowStockThresholdBase: 600, safetyStockBase: 400, primarySupplierId: suppliers.dairy.id, leadTimeDays: 4, deliveryDays: [2], minimumOrderQuantity: 1, packSizeBase: 1000, latestCostNote: "$18 / bottle", confidenceScore: 0.73 },
    { name: "Pastry Boxes", sku: "INV-PASTRY-BOX", category: InventoryCategory.PACKAGING, imageUrl: "/inventory/box.svg", baseUnit: "COUNT", countUnit: "COUNT", displayUnit: "COUNT", purchaseUnit: "BOX", stockOnHandBase: 40, parLevelBase: 120, lowStockThresholdBase: 18, safetyStockBase: 20, primarySupplierId: suppliers.packaging.id, leadTimeDays: 3, deliveryDays: [2, 5], minimumOrderQuantity: 1, packSizeBase: 50, latestCostNote: "$21 / carton", confidenceScore: 0.82 },
    { name: "Espresso Cleaner", sku: "INV-CLEAN-ESP", category: InventoryCategory.CLEANING, imageUrl: "/inventory/cleaner.svg", baseUnit: "COUNT", countUnit: "COUNT", displayUnit: "COUNT", purchaseUnit: "BOX", stockOnHandBase: 3, parLevelBase: 24, lowStockThresholdBase: 4, safetyStockBase: 4, primarySupplierId: suppliers.cleaning.id, leadTimeDays: 4, deliveryDays: [3], minimumOrderQuantity: 1, packSizeBase: 6, latestCostNote: "$48 / box", confidenceScore: 0.9 },
  ] as const;

  const inventoryBySku: Record<string, { id: string }> = {};
  for (const row of inventorySeed) {
    const item = await prisma.inventoryItem.create({
      data: {
        locationId: location.id,
        primarySupplierId: row.primarySupplierId,
        name: row.name,
        sku: row.sku,
        category: row.category,
        imageUrl: row.imageUrl,
        baseUnit: row.baseUnit,
        countUnit: row.countUnit,
        displayUnit: row.displayUnit,
        purchaseUnit: row.purchaseUnit,
        stockOnHandBase: row.stockOnHandBase,
        parLevelBase: row.parLevelBase,
        lowStockThresholdBase: row.lowStockThresholdBase,
        safetyStockBase: row.safetyStockBase,
        leadTimeDays: row.leadTimeDays,
        deliveryDays: toDeliveryDaysJson(row.deliveryDays),
        minimumOrderQuantity: row.minimumOrderQuantity,
        packSizeBase: row.packSizeBase,
        latestCostNote: row.latestCostNote,
        confidenceScore: row.confidenceScore,
      },
    });
    inventoryBySku[row.sku] = { id: item.id };
  }

  await prisma.supplierItem.createMany({
    data: [
      { supplierId: suppliers.dairy.id, inventoryItemId: inventoryBySku["INV-BEANS-ESP"].id, packSizeBase: 1000, minimumOrderQuantity: 2, lastUnitCostCents: 2650, deliveryDays: toDeliveryDaysJson([1, 4]) },
      { supplierId: suppliers.dairy.id, inventoryItemId: inventoryBySku["INV-MILK-DAIRY"].id, packSizeBase: 12000, minimumOrderQuantity: 1, lastUnitCostCents: 2900, deliveryDays: toDeliveryDaysJson([1, 4]) },
      { supplierId: suppliers.dairy.id, inventoryItemId: inventoryBySku["INV-OAT-01"].id, packSizeBase: 8000, minimumOrderQuantity: 1, lastUnitCostCents: 3400, deliveryDays: toDeliveryDaysJson([1, 4]) },
      { supplierId: suppliers.packaging.id, inventoryItemId: inventoryBySku["INV-CUP-HOT-16"].id, packSizeBase: 100, minimumOrderQuantity: 2, lastUnitCostCents: 5200, deliveryDays: toDeliveryDaysJson([2, 5]) },
      { supplierId: suppliers.packaging.id, inventoryItemId: inventoryBySku["INV-LID-HOT-16"].id, packSizeBase: 100, minimumOrderQuantity: 2, lastUnitCostCents: 3400, deliveryDays: toDeliveryDaysJson([2, 5]) },
      { supplierId: suppliers.packaging.id, inventoryItemId: inventoryBySku["INV-SLEEVE-01"].id, packSizeBase: 100, minimumOrderQuantity: 1, lastUnitCostCents: 1700, deliveryDays: toDeliveryDaysJson([2, 5]) },
    ],
  });

  const integration = await prisma.posIntegration.create({
    data: {
      locationId: location.id,
      provider: PosProviderType.SQUARE,
      status: IntegrationStatus.CONNECTED,
      sandbox: true,
      lastSyncedAt: new Date("2026-04-08T12:00:00.000Z"),
    },
  });

  for (const item of catalog) {
    const posItem = await prisma.posCatalogItem.create({
      data: {
        integrationId: integration.id,
        externalId: item.externalItemId,
        name: item.name,
        category: item.category,
        imageUrl: item.imageUrl,
        rawData: item,
      },
    });
    const menuItem = await prisma.menuItem.create({
      data: {
        locationId: location.id,
        name: item.name,
        category: item.category,
        imageUrl: item.imageUrl,
        source: PosProviderType.SQUARE,
      },
    });

    for (const variation of item.variations) {
      const posVariation = await prisma.posCatalogVariation.create({
        data: {
          catalogItemId: posItem.id,
          externalId: variation.externalVariationId,
          name: variation.name,
          serviceMode: variation.serviceMode,
          priceCents: variation.priceCents,
          rawData: variation,
        },
      });
      const menuItemVariant = await prisma.menuItemVariant.create({
        data: {
          menuItemId: menuItem.id,
          name: variation.name,
          serviceMode: variation.serviceMode,
        },
      });
      const recipe = await prisma.recipe.create({
        data: {
          locationId: location.id,
          menuItemVariantId: menuItemVariant.id,
          version: 1,
          status: variation.name === "Mocha" ? RecipeStatus.DRAFT : RecipeStatus.APPROVED,
          aiSuggestedBy: "mock-ai",
          aiSummary:
            variation.name === "Mocha"
              ? "Chocolate sauce usage is still awaiting manager confirmation."
              : "Approved base recipe from initial onboarding.",
          approvedById: variation.name === "Mocha" ? undefined : manager.id,
          approvedAt: variation.name === "Mocha" ? undefined : new Date("2026-04-07T15:00:00.000Z"),
          completenessScore: variation.name === "Mocha" ? 0.72 : 0.9,
          confidenceScore: variation.name === "Mocha" ? 0.69 : 0.84,
        },
      });

      await prisma.posVariationMapping.create({
        data: {
          locationId: location.id,
          posVariationId: posVariation.id,
          menuItemVariantId: menuItemVariant.id,
          recipeId: recipe.id,
          mappingStatus: variation.name === "Mocha" ? MappingStatus.RECIPE_DRAFT : MappingStatus.READY,
          packagingMode: variation.serviceMode,
        },
      });

      for (const component of componentsForVariation(variation.name)) {
        await prisma.recipeComponent.create({
          data: {
            recipeId: recipe.id,
            inventoryItemId: inventoryBySku[component[0]].id,
            componentType: component[1],
            quantityBase: component[2],
            displayUnit: component[3],
            confidenceScore: variation.name === "Mocha" ? 0.7 : 0.84,
            conditionServiceMode: component[1] === "PACKAGING" ? ServiceMode.TO_GO : undefined,
          },
        });
      }
    }
  }

  await prisma.inventorySnapshot.createMany({
    data: [
      { locationId: location.id, inventoryItemId: inventoryBySku["INV-OAT-01"].id, stockOnHandBase: 3500, averageDailyUsageBase: 1300, daysLeft: 2.7, projectedRunoutAt: new Date("2026-04-11T14:00:00.000Z"), urgency: AlertSeverity.CRITICAL, confidenceScore: 0.72 },
      { locationId: location.id, inventoryItemId: inventoryBySku["INV-CUP-HOT-16"].id, stockOnHandBase: 180, averageDailyUsageBase: 42, daysLeft: 4.3, projectedRunoutAt: new Date("2026-04-12T17:00:00.000Z"), urgency: AlertSeverity.WARNING, confidenceScore: 0.78 },
      { locationId: location.id, inventoryItemId: inventoryBySku["INV-LID-HOT-16"].id, stockOnHandBase: 140, averageDailyUsageBase: 38, daysLeft: 3.7, projectedRunoutAt: new Date("2026-04-12T09:00:00.000Z"), urgency: AlertSeverity.WARNING, confidenceScore: 0.78 },
      { locationId: location.id, inventoryItemId: inventoryBySku["INV-CLEAN-ESP"].id, stockOnHandBase: 3, averageDailyUsageBase: 1, daysLeft: 3, projectedRunoutAt: new Date("2026-04-12T13:00:00.000Z"), urgency: AlertSeverity.CRITICAL, confidenceScore: 0.9 },
      { locationId: location.id, inventoryItemId: inventoryBySku["INV-MILK-DAIRY"].id, stockOnHandBase: 16000, averageDailyUsageBase: 2200, daysLeft: 7.3, projectedRunoutAt: new Date("2026-04-15T10:00:00.000Z"), urgency: AlertSeverity.INFO, confidenceScore: 0.88 },
    ],
  });

  await prisma.stockMovement.createMany({
    data: [
      { locationId: location.id, inventoryItemId: inventoryBySku["INV-OAT-01"].id, movementType: "POS_DEPLETION", quantityDeltaBase: -2240, beforeBalanceBase: 5740, afterBalanceBase: 3500, sourceType: "pos_sale_event", sourceId: "sq-order-demo-001", notes: "Synced from sample Square order" },
      { locationId: location.id, inventoryItemId: inventoryBySku["INV-CUP-HOT-16"].id, movementType: "POS_DEPLETION", quantityDeltaBase: -20, beforeBalanceBase: 200, afterBalanceBase: 180, sourceType: "pos_sale_event", sourceId: "sq-order-demo-001" },
      { locationId: location.id, inventoryItemId: inventoryBySku["INV-LID-HOT-16"].id, movementType: "POS_DEPLETION", quantityDeltaBase: -16, beforeBalanceBase: 156, afterBalanceBase: 140, sourceType: "pos_sale_event", sourceId: "sq-order-demo-001" },
    ],
  });

  const session = await prisma.stockCountSession.create({
    data: {
      locationId: location.id,
      createdById: staff.id,
      status: CountSessionStatus.IN_PROGRESS,
      mode: CountSessionMode.SWIPE,
      notes: "End-of-shift packaging verification",
    },
  });

  await prisma.stockCountEntry.create({
    data: {
      sessionId: session.id,
      inventoryItemId: inventoryBySku["INV-OAT-01"].id,
      createdById: staff.id,
      expectedBase: 3500,
      countedBase: 3200,
      adjustmentBase: -300,
      notes: "Partial carton left open in walk-in",
      disposition: "LOW",
    },
  });

  const oatAlert = await prisma.alert.create({
    data: {
      locationId: location.id,
      inventoryItemId: inventoryBySku["INV-OAT-01"].id,
      type: AlertType.IMMINENT_STOCKOUT,
      severity: AlertSeverity.CRITICAL,
      title: "Oat milk may run out before Friday delivery",
      message: "Recent iced latte sales accelerated oat milk depletion.",
      status: AlertStatus.OPEN,
    },
  });

  await prisma.alert.createMany({
    data: [
      { locationId: location.id, inventoryItemId: inventoryBySku["INV-CUP-HOT-16"].id, type: AlertType.LOW_STOCK, severity: AlertSeverity.WARNING, title: "Hot cup inventory is below par", message: "Packaging velocity will breach safety stock before the next website supplier slot.", status: AlertStatus.OPEN },
      { locationId: location.id, inventoryItemId: inventoryBySku["INV-CLEAN-ESP"].id, type: AlertType.LOW_STOCK, severity: AlertSeverity.CRITICAL, title: "Espresso cleaner is critically low", message: "Cleaning stock will run out before the next CleanWorks delivery day unless a manual reorder is approved.", status: AlertStatus.OPEN },
      { locationId: location.id, type: AlertType.RECIPE_GAP, severity: AlertSeverity.WARNING, title: "Mocha recipe needs approval", message: "Chocolate sauce usage is still awaiting manager confirmation.", status: AlertStatus.OPEN },
    ],
  });

  const oatRecommendation = await prisma.reorderRecommendation.create({
    data: {
      locationId: location.id,
      inventoryItemId: inventoryBySku["INV-OAT-01"].id,
      supplierId: suppliers.dairy.id,
      status: RecommendationStatus.PENDING_APPROVAL,
      recommendedOrderQuantityBase: 8000,
      recommendedPurchaseUnit: "CASE",
      recommendedPackCount: 1,
      projectedStockoutAt: new Date("2026-04-11T14:00:00.000Z"),
      urgency: AlertSeverity.CRITICAL,
      rationale: "Order 1 case of oat milk from DairyFlow Wholesale. Current projected stockout is Friday afternoon before the next confirmed delivery window.",
    },
  });

  await prisma.reorderRecommendation.create({
    data: {
      locationId: location.id,
      inventoryItemId: inventoryBySku["INV-CUP-HOT-16"].id,
      supplierId: suppliers.packaging.id,
      status: RecommendationStatus.PENDING_APPROVAL,
      recommendedOrderQuantityBase: 200,
      recommendedPurchaseUnit: "CASE",
      recommendedPackCount: 2,
      projectedStockoutAt: new Date("2026-04-12T17:00:00.000Z"),
      urgency: AlertSeverity.WARNING,
      rationale: "Order 2 cases of 16 oz hot cups from PackStreet Supply so stock stays above safety stock before the Tuesday site order cutoff.",
    },
  });

  const cleanerRecommendation = await prisma.reorderRecommendation.create({
    data: {
      locationId: location.id,
      inventoryItemId: inventoryBySku["INV-CLEAN-ESP"].id,
      supplierId: suppliers.cleaning.id,
      status: RecommendationStatus.PENDING_APPROVAL,
      recommendedOrderQuantityBase: 6,
      recommendedPurchaseUnit: "BOX",
      recommendedPackCount: 1,
      projectedStockoutAt: new Date("2026-04-12T13:00:00.000Z"),
      urgency: AlertSeverity.CRITICAL,
      rationale: "Order 1 box of espresso cleaner from CleanWorks Depot. This supplier uses an internal/manual workflow, so approval should happen before Wednesday's service window.",
    },
  });

  await prisma.alert.create({
    data: {
      locationId: location.id,
      inventoryItemId: inventoryBySku["INV-OAT-01"].id,
      type: AlertType.ORDER_APPROVAL,
      severity: AlertSeverity.CRITICAL,
      title: "Approval needed for oat milk reorder",
      message: "Order 1 case of oat milk from DairyFlow Wholesale before Friday delivery risk becomes a stockout.",
      status: AlertStatus.OPEN,
      metadata: { recommendationId: oatRecommendation.id },
    },
  });

  await prisma.alert.create({
    data: {
      locationId: location.id,
      inventoryItemId: inventoryBySku["INV-CLEAN-ESP"].id,
      type: AlertType.ORDER_APPROVAL,
      severity: AlertSeverity.CRITICAL,
      title: "Approval needed for espresso cleaner reorder",
      message: "Approve the CleanWorks manual reorder before cleaning supplies stock out.",
      status: AlertStatus.OPEN,
      metadata: { recommendationId: cleanerRecommendation.id },
    },
  });

  const po = await prisma.purchaseOrder.create({
    data: {
      locationId: location.id,
      supplierId: suppliers.dairy.id,
      recommendationId: oatRecommendation.id,
      orderNumber: "PO-2026-0042",
      status: PurchaseOrderStatus.AWAITING_APPROVAL,
      totalLines: 1,
      notes: "Auto-drafted from critical oat milk recommendation.",
      placedById: manager.id,
    },
  });

  await prisma.purchaseOrderLine.create({
    data: {
      purchaseOrderId: po.id,
      inventoryItemId: inventoryBySku["INV-OAT-01"].id,
      description: "Oat Milk",
      quantityOrdered: 1,
      expectedQuantityBase: 8000,
      purchaseUnit: "CASE",
      packSizeBase: 8000,
      latestCostCents: 3400,
    },
  });

  await prisma.agentTask.create({
    data: {
      locationId: location.id,
      supplierId: suppliers.packaging.id,
      type: AgentTaskType.WEBSITE_ORDER_PREP,
      status: AgentTaskStatus.READY_FOR_REVIEW,
      title: "Prepare PackStreet packaging reorder",
      description: "Browser task draft is ready for a manager to review before final site submission.",
      requiresApproval: true,
      input: { supplier: suppliers.packaging.name, website: suppliers.packaging.website, lines: [{ sku: "INV-CUP-HOT-16", quantity: 2, unit: "case" }] },
    },
  });

  await prisma.notification.create({
    data: {
      locationId: location.id,
      alertId: oatAlert.id,
      channel: NotificationChannel.EMAIL,
      recipient: manager.email,
      status: NotificationStatus.SENT,
      subject: "Critical stock alert: oat milk",
      body: "Oat milk is projected to stock out before Friday delivery unless an order is approved.",
      sentAt: new Date("2026-04-08T12:20:00.000Z"),
    },
  });

  await prisma.jobRun.createMany({
    data: [
      { locationId: location.id, type: JobType.SYNC_CATALOG, status: JobStatus.COMPLETED, payload: { integrationId: integration.id } },
      { locationId: location.id, type: JobType.SYNC_SALES, status: JobStatus.PENDING, payload: { integrationId: integration.id, userId: manager.id } },
    ],
  });

  await prisma.auditLog.createMany({
    data: [
      { locationId: location.id, userId: manager.id, action: "integration.square.catalog_synced", entityType: "posIntegration", entityId: integration.id, details: { count: catalog.length } },
      { locationId: location.id, userId: manager.id, action: "pos.sales.processed", entityType: "posSaleEvent", entityId: "sq-order-demo-001", details: { lowStockSku: "INV-OAT-01" } },
    ],
  });

  console.info("Seed completed for StockPilot demo scenario.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
