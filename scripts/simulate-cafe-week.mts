// Realistic 7-day café simulation against the production DB for my
// E2E test account. Seeds one week of actual movement:
//   Day 0: setup (6 items with real prices + 2 suppliers)
//   Day 1-7: realistic POS depletion + one ordered delivery that
//            came in over estimate + one stock count showing
//            shrinkage
//
// Running this populates the dashboard with the real signals that
// prove the product actually works at the scale of a small café:
//   - Money Pulse shows $X spent + N orders + auto-approve count
//     + price-jump alert
//   - Running Low surfaces critical items
//   - Variance report has real shrinkage numbers
//
// The script is idempotent-ish: it looks for the test account by
// email and wipes + reseeds inventory/suppliers/orders under it
// each run. Other accounts are untouched.

process.env.N8N_WEBHOOK_SECRET =
  process.env.N8N_WEBHOOK_SECRET ?? "test-simulate-cafe-secret";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-simulate-cafe-session";
process.env.DEFAULT_EMAIL_PROVIDER = "console";

import { PrismaClient } from "../src/generated/prisma-postgres/client.js";

const { postStockMovementTx } = await import(
  "../src/modules/inventory/ledger.ts"
);

const db = new PrismaClient();
const TEST_EMAIL = "e2e-test-1@stockpilot.test";

async function main() {
  const user = await db.user.findUnique({
    where: { email: TEST_EMAIL },
    select: {
      id: true,
      roles: { select: { locationId: true } },
    },
  });
  if (!user || user.roles.length === 0) {
    console.error(`❌ No test account found for ${TEST_EMAIL}. Sign up first.`);
    process.exit(1);
  }
  const locationId = user.roles[0].locationId;
  const userId = user.id;
  console.log(`📍 Seeding simulation into location ${locationId}`);

  // ── Wipe previous simulation data for this location ──────────
  // Keep the account itself (business/location/user) so /signup
  // state stays stable.
  console.log("🧹 Wiping previous simulation rows…");
  await db.purchaseOrderLine.deleteMany({
    where: { purchaseOrder: { locationId } },
  });
  await db.supplierCommunication.deleteMany({
    where: { purchaseOrder: { locationId } },
  });
  await db.purchaseOrder.deleteMany({ where: { locationId } });
  await db.reorderRecommendation.deleteMany({ where: { locationId } });
  await db.stockMovement.deleteMany({ where: { locationId } });
  await db.stockCountEntry.deleteMany({
    where: { session: { locationId } },
  });
  await db.stockCountSession.deleteMany({ where: { locationId } });
  await db.inventorySnapshot.deleteMany({ where: { locationId } });
  await db.supplierItem.deleteMany({
    where: { supplier: { locationId } },
  });
  await db.inventoryItem.deleteMany({ where: { locationId } });
  await db.supplier.deleteMany({ where: { locationId } });
  await db.auditLog.deleteMany({ where: { locationId } });

  // ── Suppliers ───────────────────────────────────────────────
  console.log("🏪 Creating suppliers…");
  const sysco = await db.supplier.create({
    data: {
      locationId,
      name: "Sysco",
      orderingMode: "EMAIL",
      email: "orders@test-sysco.example",
      contactName: "Maria — Sysco rep",
      leadTimeDays: 2,
      minimumOrderQuantity: 1,
    },
  });
  const costco = await db.supplier.create({
    data: {
      locationId,
      name: "Costco",
      orderingMode: "WEBSITE",
      website: "https://www.costco.com",
      leadTimeDays: 1,
      minimumOrderQuantity: 1,
    },
  });

  // ── Inventory (6 items, realistic for a café) ───────────────
  console.log("📦 Creating inventory items…");
  type ItemSeed = {
    name: string;
    category: string;
    baseUnit: "GRAM" | "MILLILITER" | "COUNT";
    packSizeBase: number;
    parLevelBase: number;
    stockOnHandBase: number;
    lowStockThresholdBase: number;
    priceCents: number;
    supplier: { id: string };
  };
  // Opening stock sized so a 6-day simulation (~87 drinks/day)
  // doesn't drain any item below zero without a restock. Real cafés
  // carry ~1.5× weekly usage as a buffer.
  const seeds: ItemSeed[] = [
    {
      name: "Whole Milk 2L",
      category: "DAIRY",
      baseUnit: "MILLILITER",
      packSizeBase: 2000,
      parLevelBase: 80000,
      stockOnHandBase: 88000,
      lowStockThresholdBase: 20000,
      priceCents: 450,
      supplier: sysco,
    },
    {
      name: "Oat Milk Original 1L",
      category: "ALT_DAIRY",
      baseUnit: "MILLILITER",
      packSizeBase: 1000,
      parLevelBase: 45000,
      stockOnHandBase: 50000,
      lowStockThresholdBase: 12000,
      priceCents: 380,
      supplier: sysco,
    },
    {
      name: "Espresso Beans 1kg",
      category: "COFFEE",
      baseUnit: "GRAM",
      packSizeBase: 1000,
      parLevelBase: 12000,
      stockOnHandBase: 14000,
      lowStockThresholdBase: 4000,
      priceCents: 2400,
      supplier: sysco,
    },
    {
      name: "Ground Coffee 1kg",
      category: "COFFEE",
      baseUnit: "GRAM",
      packSizeBase: 1000,
      parLevelBase: 3000,
      stockOnHandBase: 1200, // intentionally below threshold → Running Low signal
      lowStockThresholdBase: 1500,
      priceCents: 2100,
      supplier: sysco,
    },
    {
      name: "Paper Cups 12oz (50ct)",
      category: "PACKAGING",
      baseUnit: "COUNT",
      packSizeBase: 50,
      parLevelBase: 700,
      stockOnHandBase: 800,
      lowStockThresholdBase: 200,
      priceCents: 1200,
      supplier: costco,
    },
    {
      name: "Vanilla Syrup 750ml",
      category: "SYRUP",
      baseUnit: "MILLILITER",
      packSizeBase: 750,
      parLevelBase: 3000,
      stockOnHandBase: 2400,
      lowStockThresholdBase: 1500,
      priceCents: 890,
      supplier: sysco,
    },
  ];

  const items: Array<{
    id: string;
    name: string;
    packSizeBase: number;
    priceCents: number;
    supplierId: string;
  }> = [];

  for (const [i, s] of seeds.entries()) {
    const sku = `SIM-${Date.now().toString(36)}-${i}`;
    const item = await db.inventoryItem.create({
      data: {
        locationId,
        name: s.name,
        sku,
        category: s.category as never,
        baseUnit: s.baseUnit as never,
        displayUnit: s.baseUnit as never,
        countUnit: s.baseUnit as never,
        purchaseUnit: s.baseUnit as never,
        packSizeBase: s.packSizeBase,
        stockOnHandBase: s.stockOnHandBase,
        parLevelBase: s.parLevelBase,
        safetyStockBase: Math.round(s.parLevelBase * 0.2),
        lowStockThresholdBase: s.lowStockThresholdBase,
        primarySupplierId: s.supplier.id,
      },
    });
    await db.supplierItem.create({
      data: {
        supplierId: s.supplier.id,
        inventoryItemId: item.id,
        packSizeBase: s.packSizeBase,
        minimumOrderQuantity: 1,
        preferred: true,
        lastUnitCostCents: s.priceCents,
      },
    });
    items.push({
      id: item.id,
      name: s.name,
      packSizeBase: s.packSizeBase,
      priceCents: s.priceCents,
      supplierId: s.supplier.id,
    });
  }

  // ── Day 1-6: POS depletion (realistic sales) ───────────────
  // Small café: ~80 drinks/day. Each latte uses 200ml milk + 18g
  // espresso + 1 cup. Simulated as daily depletion batches.
  console.log("☕ Simulating 6 days of sales…");
  const now = new Date();
  const drinksPerDay = [70, 85, 92, 68, 95, 110]; // light + heavy days
  const whole = items.find((i) => i.name.includes("Whole Milk"))!;
  const oat = items.find((i) => i.name.includes("Oat Milk"))!;
  const espresso = items.find((i) => i.name.includes("Espresso"))!;
  const ground = items.find((i) => i.name.includes("Ground Coffee"))!;
  const cups = items.find((i) => i.name.includes("Paper Cups"))!;
  const syrup = items.find((i) => i.name.includes("Vanilla"))!;

  for (let day = 6; day >= 1; day -= 1) {
    const drinks = drinksPerDay[6 - day];
    const performedAt = new Date(now.getTime() - day * 24 * 60 * 60 * 1000);

    // 60% whole milk lattes, 35% oat milk, 5% black coffee
    const wholeDrinks = Math.round(drinks * 0.6);
    const oatDrinks = Math.round(drinks * 0.35);
    const blackDrinks = drinks - wholeDrinks - oatDrinks;

    // Milk: 200ml per milk drink
    await db.$transaction(async (tx) => {
      await postStockMovementTx(tx, {
        locationId,
        inventoryItemId: whole.id,
        quantityDeltaBase: -wholeDrinks * 200,
        movementType: "POS_DEPLETION",
        sourceType: "simulated_sales",
        sourceId: `sim-day${day}-whole`,
        userId,
        performedAt,
        metadata: { day, drinks: wholeDrinks },
      });
      await postStockMovementTx(tx, {
        locationId,
        inventoryItemId: oat.id,
        quantityDeltaBase: -oatDrinks * 200,
        movementType: "POS_DEPLETION",
        sourceType: "simulated_sales",
        sourceId: `sim-day${day}-oat`,
        userId,
        performedAt,
        metadata: { day, drinks: oatDrinks },
      });
      // Espresso: 18g per drink (including black)
      await postStockMovementTx(tx, {
        locationId,
        inventoryItemId: espresso.id,
        quantityDeltaBase: -drinks * 18,
        movementType: "POS_DEPLETION",
        sourceType: "simulated_sales",
        sourceId: `sim-day${day}-espresso`,
        userId,
        performedAt,
        metadata: { day, drinks },
      });
      // Drip coffee: 30g for every 4 black drinks (one brew)
      await postStockMovementTx(tx, {
        locationId,
        inventoryItemId: ground.id,
        quantityDeltaBase: -blackDrinks * 30,
        movementType: "POS_DEPLETION",
        sourceType: "simulated_sales",
        sourceId: `sim-day${day}-ground`,
        userId,
        performedAt,
        metadata: { day, drinks: blackDrinks },
      });
      // Cups: 1 per drink
      await postStockMovementTx(tx, {
        locationId,
        inventoryItemId: cups.id,
        quantityDeltaBase: -drinks,
        movementType: "POS_DEPLETION",
        sourceType: "simulated_sales",
        sourceId: `sim-day${day}-cups`,
        userId,
        performedAt,
        metadata: { day, drinks },
      });
      // Vanilla syrup: 15ml on ~20% of drinks
      const vanillaDrinks = Math.round(drinks * 0.2);
      await postStockMovementTx(tx, {
        locationId,
        inventoryItemId: syrup.id,
        quantityDeltaBase: -vanillaDrinks * 15,
        movementType: "POS_DEPLETION",
        sourceType: "simulated_sales",
        sourceId: `sim-day${day}-syrup`,
        userId,
        performedAt,
        metadata: { day, drinks: vanillaDrinks },
      });
    });
  }

  // ── Day 4: one ordered delivery came in over estimate ────────
  // Oat milk order for 12 × 1L at $3.80 estimated; received at
  // $4.35 actual = 14.5% price jump. This triggers the variance
  // audit → Money Pulse price-alert row.
  console.log("📮 Posting one over-estimate delivery (Day 4)…");
  const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
  const po = await db.purchaseOrder.create({
    data: {
      locationId,
      supplierId: oat.supplierId,
      orderNumber: `PO-SIM-${Date.now().toString(36)}`,
      status: "DELIVERED",
      totalLines: 1,
      placedById: userId,
      approvedById: userId,
      approvedAt: fourDaysAgo,
      sentAt: fourDaysAgo,
      deliveredAt: fourDaysAgo,
      lines: {
        create: {
          inventoryItemId: oat.id,
          description: "Oat Milk Original 1L",
          quantityOrdered: 12,
          expectedQuantityBase: 12000,
          actualQuantityBase: 12000,
          purchaseUnit: "MILLILITER",
          packSizeBase: 1000,
          latestCostCents: 380, // estimate
          actualUnitCostCents: 435, // actual = 14.5% over
        },
      },
    },
  });
  await db.supplierCommunication.create({
    data: {
      supplierId: oat.supplierId,
      purchaseOrderId: po.id,
      channel: "EMAIL",
      direction: "OUTBOUND",
      subject: `PO ${po.orderNumber}`,
      body: "Please ship 12 × Oat Milk Original 1L. Thanks.",
      status: "SENT",
      sentAt: fourDaysAgo,
    },
  });
  // Post the receiving ledger entry with actual cost
  await db.$transaction(async (tx) => {
    const line = await tx.purchaseOrderLine.findFirstOrThrow({
      where: { purchaseOrderId: po.id },
    });
    await postStockMovementTx(tx, {
      locationId,
      inventoryItemId: oat.id,
      quantityDeltaBase: 12000,
      movementType: "RECEIVING",
      sourceType: "purchase_order",
      sourceId: po.id,
      userId,
      performedAt: fourDaysAgo,
      metadata: {
        purchaseOrderLineId: line.id,
        orderNumber: po.orderNumber,
        actualUnitCostCents: 435,
      },
    });
  });
  // Write the variance audit row that Money Pulse reads
  await db.auditLog.create({
    data: {
      locationId,
      userId,
      action: "purchaseOrder.priceVariance.review",
      entityType: "purchaseOrderLine",
      entityId: po.id,
      createdAt: fourDaysAgo,
      details: {
        orderNumber: po.orderNumber,
        description: oat.name,
        expectedCents: 380,
        actualCents: 435,
        deltaPct: 0.1447,
      },
    },
  });

  // ── Day 6: stock count that reveals shrinkage ────────────────
  // Manager counts oat milk: only has 1100ml on hand, but the
  // ledger (after sales + receiving) thinks there's 1500ml → 400ml
  // unexplained loss (~$1.74). This is the "shrinkage detector"
  // signal we want to surface.
  console.log("📋 Posting a stock count with 400ml unexplained loss…");
  const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
  const oatFresh = await db.inventoryItem.findUniqueOrThrow({
    where: { id: oat.id },
    select: { stockOnHandBase: true },
  });
  // The count adjustment is (counted - ledger). Negative = shrinkage.
  const countedBase = Math.max(0, oatFresh.stockOnHandBase - 400);
  await db.$transaction(async (tx) => {
    await postStockMovementTx(tx, {
      locationId,
      inventoryItemId: oat.id,
      quantityDeltaBase: countedBase - oatFresh.stockOnHandBase,
      movementType: "MANUAL_COUNT_ADJUSTMENT",
      sourceType: "simulated_count",
      sourceId: `sim-count-oat`,
      userId,
      performedAt: oneDayAgo,
      metadata: { counted: countedBase, ledgerWas: oatFresh.stockOnHandBase },
    });
  });

  // ── Summary ──────────────────────────────────────────────────
  const finalItems = await db.inventoryItem.findMany({
    where: { locationId },
    select: { name: true, stockOnHandBase: true, lowStockThresholdBase: true },
  });
  console.log("\n✅ Simulation complete. Final state:");
  for (const item of finalItems) {
    const urgent = item.stockOnHandBase <= 0 ? "🔴 OUT" : item.stockOnHandBase <= item.lowStockThresholdBase ? "🟡 LOW" : "✅ OK";
    console.log(
      `  ${urgent}  ${item.name} — ${item.stockOnHandBase} / ${item.lowStockThresholdBase}+`
    );
  }
  console.log(`\n🌐 Visit https://stockpilot-production-c037.up.railway.app/dashboard`);
  console.log("    to see the Money Pulse + Running Low + Variance signals.");
}

try {
  await main();
} finally {
  await db.$disconnect();
}
