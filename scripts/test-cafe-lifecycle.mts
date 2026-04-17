// Full café lifecycle test — not mocks, not unit bits, the real flow
// a first-week customer would hit:
//
//   1. Setup: business, location, manager, 3 items with real unit
//      conventions, 1 supplier with SupplierItem links and prices.
//   2. Opening day: simulate 30 lattes sold (POS_DEPLETION posted
//      via the ledger). Verify stock-on-hand math is correct.
//   3. Below threshold: verify a reorder recommendation appeared
//      for the items that crossed threshold.
//   4. Approve: walk the recommendation → PO flow. Verify PO line,
//      status, email communication captured.
//   5. Deliver: receive the PO with actual cost 10% above quote.
//      Verify: actualUnitCostCents stored, SupplierItem updated,
//      inventory increased, variance audit row written.
//   6. Stock count: record a negative count adjustment.
//   7. Variance report: verify the shrinkage surfaces.
//   8. Pricing history: verify the price-delta surfaces.
//   9. Cleanup.
//
// If any of those land wrong, the user is right to be frustrated.
// This file is the truth: every assertion is a claim about a user-
// visible behavior that MUST work, not an internal implementation
// detail.

process.env.N8N_WEBHOOK_SECRET =
  process.env.N8N_WEBHOOK_SECRET ?? "test-cafe-lifecycle-secret";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-cafe-lifecycle-session";

import { PrismaClient } from "../src/generated/prisma-postgres/client.js";

const { recordInventoryMovement } = await import(
  "../src/modules/inventory/ledger.ts"
);
const { approveRecommendation, deliverPurchaseOrder } = await import(
  "../src/modules/purchasing/service.ts"
);
const { getVarianceReport } = await import("../src/modules/variance/report.ts");
const { getPricingDashboard } = await import(
  "../src/modules/pricing/history.ts"
);

const db = new PrismaClient();

// ── Harness ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: unknown, label: string, detail?: string) {
  if (cond) {
    passed += 1;
    console.log(`    ✅ ${label}`);
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`    ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function scenario(name: string, fn: () => Promise<void>) {
  console.log(`\n━━ ${name}`);
  try {
    await fn();
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`    ❌ THREW: ${msg}`);
    if (err instanceof Error && err.stack) {
      console.log(err.stack.split("\n").slice(1, 4).join("\n"));
    }
  }
}

const STAMP = Date.now().toString(36) + Math.random().toString(36).slice(2, 4);

// ── World setup ────────────────────────────────────────────────────

type World = {
  locationId: string;
  userId: string;
  supplierId: string;
  milkId: string;
  beansId: string;
  cupsId: string;
};

/**
 * Build "Cafe Millennial Grind" with realistic unit conventions:
 *  - Milk 2%: displayUnit=LITER, baseUnit=MILLILITER, packSize=4000ml
 *    (i.e. one "case" is 4L = 4000 base-unit-milliliters)
 *  - Espresso Beans: displayUnit=KILOGRAM, baseUnit=GRAM, packSize=1000g
 *  - Paper Cups 12oz: displayUnit=COUNT, baseUnit=COUNT, packSize=50
 *
 * Par levels:
 *  - Milk:   par=16000ml (4 cases), low threshold=8000ml (2 cases),
 *            safety=4000ml, starting stock=16000ml (full par)
 *  - Beans:  par=5000g (5kg), low=2000g, safety=1000g, starting=5000g
 *  - Cups:   par=400 (8 sleeves), low=150, safety=50, starting=400
 *
 * Cost on SupplierItem:
 *  - Milk:   $12.00/case
 *  - Beans:  $25.00/kg
 *  - Cups:   $10.00/sleeve
 */
async function buildCafe(): Promise<World> {
  const suffix = `${STAMP}-${Math.random().toString(36).slice(2, 6)}`;
  const biz = await db.business.create({
    data: { name: `Millennial Grind ${suffix}`, slug: `mill-${suffix}` },
  });
  const loc = await db.location.create({
    data: {
      businessId: biz.id,
      name: "Kingsway Cafe",
      timezone: "America/Toronto",
    },
  });
  const user = await db.user.create({
    data: {
      email: `manager-${suffix}@test.example`,
      name: "Anna Manager",
      passwordHash: "x",
      roles: { create: { locationId: loc.id, role: "MANAGER" } },
    },
  });
  const supplier = await db.supplier.create({
    data: {
      locationId: loc.id,
      name: "FreshCo Wholesale",
      orderingMode: "EMAIL",
      email: `freshco-${suffix}@test.example`,
      leadTimeDays: 2,
    },
  });

  const milk = await db.inventoryItem.create({
    data: {
      locationId: loc.id,
      name: "Milk 2%",
      sku: `MILK-${suffix}`,
      category: "DAIRY",
      displayUnit: "LITER",
      baseUnit: "MILLILITER",
      countUnit: "MILLILITER",
      purchaseUnit: "CASE",
      packSizeBase: 4000, // 4L per case
      parLevelBase: 16000,
      lowStockThresholdBase: 8000,
      safetyStockBase: 4000,
      stockOnHandBase: 16000,
      primarySupplierId: supplier.id,
    },
  });
  const beans = await db.inventoryItem.create({
    data: {
      locationId: loc.id,
      name: "Espresso Beans",
      sku: `BEANS-${suffix}`,
      category: "COFFEE",
      displayUnit: "KILOGRAM",
      baseUnit: "GRAM",
      countUnit: "GRAM",
      purchaseUnit: "KILOGRAM",
      packSizeBase: 1000,
      parLevelBase: 5000,
      lowStockThresholdBase: 2000,
      safetyStockBase: 1000,
      stockOnHandBase: 5000,
      primarySupplierId: supplier.id,
    },
  });
  const cups = await db.inventoryItem.create({
    data: {
      locationId: loc.id,
      name: "Paper Cups 12oz",
      sku: `CUPS-${suffix}`,
      category: "PACKAGING",
      displayUnit: "COUNT",
      baseUnit: "COUNT",
      countUnit: "COUNT",
      purchaseUnit: "CASE",
      packSizeBase: 50,
      parLevelBase: 400,
      lowStockThresholdBase: 150,
      safetyStockBase: 50,
      stockOnHandBase: 400,
      primarySupplierId: supplier.id,
    },
  });

  for (const [item, costCents] of [
    [milk, 1200],
    [beans, 2500],
    [cups, 1000],
  ] as const) {
    await db.supplierItem.create({
      data: {
        supplierId: supplier.id,
        inventoryItemId: item.id,
        packSizeBase: item.packSizeBase,
        lastUnitCostCents: costCents,
        preferred: true,
      },
    });
  }

  return {
    locationId: loc.id,
    userId: user.id,
    supplierId: supplier.id,
    milkId: milk.id,
    beansId: beans.id,
    cupsId: cups.id,
  };
}

async function cleanup() {
  const biz = await db.business.findMany({
    where: { slug: { startsWith: `mill-${STAMP}` } },
    select: { id: true, locations: { select: { id: true } } },
  });
  const locIds = biz.flatMap((b) => b.locations.map((l) => l.id));
  if (locIds.length > 0) {
    await db.supplierCommunication.deleteMany({
      where: { purchaseOrder: { locationId: { in: locIds } } },
    });
    await db.auditLog.deleteMany({ where: { locationId: { in: locIds } } });
    await db.stockMovement.deleteMany({
      where: { inventoryItem: { locationId: { in: locIds } } },
    });
    await db.alert.deleteMany({ where: { locationId: { in: locIds } } });
    await db.purchaseOrderLine.deleteMany({
      where: { purchaseOrder: { locationId: { in: locIds } } },
    });
    await db.purchaseOrder.deleteMany({
      where: { locationId: { in: locIds } },
    });
    await db.reorderRecommendation.deleteMany({
      where: { locationId: { in: locIds } },
    });
    await db.supplierItem.deleteMany({
      where: { supplier: { locationId: { in: locIds } } },
    });
    await db.inventoryItem.deleteMany({
      where: { locationId: { in: locIds } },
    });
    await db.supplier.deleteMany({ where: { locationId: { in: locIds } } });
    await db.userLocationRole.deleteMany({
      where: { locationId: { in: locIds } },
    });
    await db.location.deleteMany({ where: { id: { in: locIds } } });
  }
  await db.user.deleteMany({
    where: { email: { contains: `manager-${STAMP}` } },
  });
  await db.business.deleteMany({
    where: { slug: { startsWith: `mill-${STAMP}` } },
  });
}

// ── Scenarios ──────────────────────────────────────────────────────

await scenario("Setup is clean — 3 items, 1 supplier, 3 supplier-item rows, correct stock", async () => {
  const w = await buildCafe();
  const milk = await db.inventoryItem.findUnique({ where: { id: w.milkId } });
  assert(milk != null, "milk item exists");
  assert(milk?.stockOnHandBase === 16000, `milk stock=16000ml (got ${milk?.stockOnHandBase})`);
  assert(milk?.lowStockThresholdBase === 8000, `milk threshold=8000ml`);
  assert(milk?.packSizeBase === 4000, `milk pack=4000ml (one 4L case)`);
  const supplierItems = await db.supplierItem.findMany({
    where: { supplierId: w.supplierId },
  });
  assert(supplierItems.length === 3, `3 supplier items (got ${supplierItems.length})`);
  const milkSi = supplierItems.find((s) => s.inventoryItemId === w.milkId);
  assert(milkSi?.lastUnitCostCents === 1200, `milk price = $12/case`);
});

await scenario("Depleting stock below threshold generates a reorder recommendation", async () => {
  const w = await buildCafe();
  // 30 lattes × 150ml milk = 4500ml. Stock drops to 11500 — still
  // above threshold. Add another day: 40 lattes × 150ml = 6000ml.
  // Stock drops to 5500 — below threshold (8000).
  await recordInventoryMovement({
    locationId: w.locationId,
    inventoryItemId: w.milkId,
    movementType: "POS_DEPLETION",
    quantityDeltaBase: -4500,
    userId: w.userId,
    notes: "30 lattes x 150ml",
    sourceType: "pos_sale",
    sourceId: "day1",
  });
  await recordInventoryMovement({
    locationId: w.locationId,
    inventoryItemId: w.milkId,
    movementType: "POS_DEPLETION",
    quantityDeltaBase: -6000,
    userId: w.userId,
    notes: "40 lattes x 150ml",
    sourceType: "pos_sale",
    sourceId: "day2",
  });
  const milk = await db.inventoryItem.findUnique({ where: { id: w.milkId } });
  assert(
    milk?.stockOnHandBase === 5500,
    `milk stock after 10500ml sold = 5500ml`,
    `actual=${milk?.stockOnHandBase}`
  );
  const rec = await db.reorderRecommendation.findFirst({
    where: { inventoryItemId: w.milkId, status: "PENDING_APPROVAL" },
  });
  assert(rec != null, "reorder recommendation created when stock fell below threshold");
  if (rec) {
    assert(
      rec.recommendedPackCount != null && rec.recommendedPackCount > 0,
      `recommendation has a positive pack count (got ${rec.recommendedPackCount})`
    );
    // Par is 16L, we have 5.5L, gap is ~10.5L = rounded up to 3 cases
    // (safety includes). Exact number depends on engine math; require
    // non-zero + enough-to-cross-threshold.
    const orderedBase =
      rec.recommendedPackCount * 4000; // milk pack = 4000ml/case
    assert(
      milk!.stockOnHandBase + orderedBase >= milk!.lowStockThresholdBase,
      "order quantity would bring stock above the threshold"
    );
  }
});

await scenario("Approving a recommendation creates a PO, sends the email, and transitions to SENT", async () => {
  const w = await buildCafe();
  // Knock milk below threshold in one go.
  await recordInventoryMovement({
    locationId: w.locationId,
    inventoryItemId: w.milkId,
    movementType: "POS_DEPLETION",
    quantityDeltaBase: -10000,
    userId: w.userId,
    sourceType: "pos_sale",
    sourceId: "bulk",
  });
  const rec = await db.reorderRecommendation.findFirstOrThrow({
    where: { inventoryItemId: w.milkId, status: "PENDING_APPROVAL" },
  });
  const po = await approveRecommendation(rec.id, w.userId);
  assert(po != null, "PO returned from approveRecommendation");

  // For EMAIL-mode suppliers, approveRecommendation auto-transitions
  // to SENT after composing + delivering the email. Verify via a
  // fresh read (the returned `po` reflects pre-send state).
  const fresh = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
  assert(
    fresh.status === "SENT",
    `email supplier → PO auto-transitions to SENT (got ${fresh.status})`
  );
  assert(fresh.supplierId === w.supplierId, "PO linked to correct supplier");

  const lines = await db.purchaseOrderLine.findMany({
    where: { purchaseOrderId: po.id },
  });
  assert(lines.length === 1, `1 line on the PO (got ${lines.length})`);
  const line = lines[0];
  assert(line?.inventoryItemId === w.milkId, "line points at milk");
  assert(
    line?.quantityOrdered > 0,
    `line has positive qty (got ${line?.quantityOrdered})`
  );
  assert(
    line?.packSizeBase === 4000,
    `line pack size = 4000 (got ${line?.packSizeBase})`
  );

  // The email body must exist and make sense to a supplier.
  const comms = await db.supplierCommunication.findMany({
    where: { purchaseOrderId: po.id },
  });
  assert(
    comms.length >= 1,
    `supplier communication row written (got ${comms.length})`
  );
  const outbound = comms.find((c) => c.direction === "OUTBOUND");
  assert(outbound != null, "outbound communication exists");
  if (outbound) {
    assert(
      outbound.body != null && outbound.body.length > 20,
      `email body is non-trivial (${outbound.body?.length} chars)`
    );
    assert(
      outbound.body?.toLowerCase().includes("milk"),
      "email body mentions the item name"
    );
    assert(
      outbound.subject != null && outbound.subject.length > 0,
      "subject present"
    );
  }
});

await scenario("Delivering with actuals writes cost + price history + variance audit", async () => {
  const w = await buildCafe();
  await recordInventoryMovement({
    locationId: w.locationId,
    inventoryItemId: w.milkId,
    movementType: "POS_DEPLETION",
    quantityDeltaBase: -10000,
    userId: w.userId,
    sourceType: "pos_sale",
    sourceId: "bulk",
  });
  const rec = await db.reorderRecommendation.findFirstOrThrow({
    where: { inventoryItemId: w.milkId, status: "PENDING_APPROVAL" },
  });
  const po = await approveRecommendation(rec.id, w.userId);

  const poLines = await db.purchaseOrderLine.findMany({
    where: { purchaseOrderId: po.id },
  });
  const line = poLines[0];
  // Deliver — actual cost 1400¢/case vs expected 1200¢ = 16.67% over.
  // This is the "supplier bumped us" case — variance should land in
  // "review" severity.
  await deliverPurchaseOrder({
    purchaseOrderId: po.id,
    userId: w.userId,
    notes: "Cost went up — check invoice",
    lineReceipts: { [line.id]: line.quantityOrdered },
    actualUnitCostsCents: { [line.id]: 1400 },
  });
  const delivered = await db.purchaseOrder.findUnique({
    where: { id: po.id },
  });
  assert(delivered?.status === "DELIVERED", `PO delivered (got ${delivered?.status})`);

  const freshLine = await db.purchaseOrderLine.findUnique({
    where: { id: line.id },
  });
  assert(freshLine?.actualUnitCostCents === 1400, "actual unit cost = $14 stored");
  assert(
    freshLine?.actualQuantityBase === line.quantityOrdered * 4000,
    `actual quantity = ${line.quantityOrdered * 4000}ml stored`
  );

  // Price history: SupplierItem.lastUnitCostCents should now be 1400
  const si = await db.supplierItem.findFirst({
    where: { supplierId: w.supplierId, inventoryItemId: w.milkId },
  });
  assert(
    si?.lastUnitCostCents === 1400,
    `SupplierItem price updated to $14 (got ${si?.lastUnitCostCents})`
  );

  // Inventory: stock should have gone UP by the received quantity
  const milk = await db.inventoryItem.findUnique({ where: { id: w.milkId } });
  const expectedStock = 16000 - 10000 + line.quantityOrdered * 4000;
  assert(
    milk?.stockOnHandBase === expectedStock,
    `milk stock after delivery = ${expectedStock}ml (got ${milk?.stockOnHandBase})`
  );

  // Variance audit written — 16.67% delta should be "review"
  const variances = await db.auditLog.findMany({
    where: {
      entityType: "purchaseOrderLine",
      entityId: line.id,
      action: "purchaseOrder.priceVariance.review",
    },
  });
  assert(
    variances.length === 1,
    `variance-review audit row written (got ${variances.length})`
  );
});

await scenario("Stock count adjustment surfaces in variance report", async () => {
  const w = await buildCafe();
  // Post some POS depletion and tracked waste.
  await recordInventoryMovement({
    locationId: w.locationId,
    inventoryItemId: w.milkId,
    movementType: "POS_DEPLETION",
    quantityDeltaBase: -4500,
    userId: w.userId,
    sourceType: "pos_sale",
    sourceId: "d1",
  });
  await recordInventoryMovement({
    locationId: w.locationId,
    inventoryItemId: w.milkId,
    movementType: "WASTE",
    quantityDeltaBase: -300,
    userId: w.userId,
    notes: "spilled steamed milk",
  });
  // Stock count finds 500ml less than expected.
  await recordInventoryMovement({
    locationId: w.locationId,
    inventoryItemId: w.milkId,
    movementType: "MANUAL_COUNT_ADJUSTMENT",
    quantityDeltaBase: -500,
    userId: w.userId,
    notes: "count was short",
  });

  const report = await getVarianceReport(w.locationId, { days: 7 });
  const row = report.rows.find((r) => r.inventoryItemId === w.milkId);
  assert(row != null, "milk row in variance report");
  if (row) {
    assert(
      row.theoreticalUsageBase === 4500,
      `theoretical = 4500ml (got ${row.theoreticalUsageBase})`
    );
    assert(
      row.trackedWasteBase === 300,
      `tracked waste = 300ml (got ${row.trackedWasteBase})`
    );
    assert(
      row.shrinkageBase === 500,
      `shrinkage = 500ml (got ${row.shrinkageBase})`
    );
    // milk cost = $12/4000ml = 0.3¢/ml.  500 × 0.3 = 150¢ = $1.50
    assert(
      row.shrinkageCents === 150,
      `shrinkage = $1.50 (got ${row.shrinkageCents}¢)`
    );
    // waste 300 × 0.3 = 90¢
    assert(
      row.trackedWasteCents === 90,
      `tracked waste = $0.90 (got ${row.trackedWasteCents}¢)`
    );
  }
});

await scenario("Pricing dashboard shows the 16.67% price increase", async () => {
  const w = await buildCafe();
  // Two deliveries — old price then new price.
  await recordInventoryMovement({
    locationId: w.locationId,
    inventoryItemId: w.milkId,
    movementType: "POS_DEPLETION",
    quantityDeltaBase: -10000,
    userId: w.userId,
    sourceType: "pos_sale",
    sourceId: "pre-delivery-1",
  });
  const rec1 = await db.reorderRecommendation.findFirstOrThrow({
    where: { inventoryItemId: w.milkId, status: "PENDING_APPROVAL" },
  });
  const po1 = await approveRecommendation(rec1.id, w.userId);
  const po1Lines = await db.purchaseOrderLine.findMany({
    where: { purchaseOrderId: po1.id },
  });
  await deliverPurchaseOrder({
    purchaseOrderId: po1.id,
    userId: w.userId,
    lineReceipts: { [po1Lines[0].id]: po1Lines[0].quantityOrdered },
    actualUnitCostsCents: { [po1Lines[0].id]: 1200 }, // baseline
  });

  // Back-date the first delivery so pricing dashboard can see the
  // two-point series (same-day deliveries look like a single point).
  await db.purchaseOrder.update({
    where: { id: po1.id },
    data: { deliveredAt: new Date(Date.now() - 30 * 86400_000) },
  });

  // Sell more (enough to cross the threshold again — after the
  // first delivery, stock is back up to ~22L). Selling 15L drops
  // it to 7L, below the 8L threshold.
  await recordInventoryMovement({
    locationId: w.locationId,
    inventoryItemId: w.milkId,
    movementType: "POS_DEPLETION",
    quantityDeltaBase: -15000,
    userId: w.userId,
    sourceType: "pos_sale",
    sourceId: "pre-delivery-2",
  });
  const rec2 = await db.reorderRecommendation.findFirst({
    where: { inventoryItemId: w.milkId, status: "PENDING_APPROVAL" },
  });
  assert(rec2 != null, "second reorder recommendation after more depletion");
  if (!rec2) return;
  const po2 = await approveRecommendation(rec2.id, w.userId);
  const po2Lines = await db.purchaseOrderLine.findMany({
    where: { purchaseOrderId: po2.id },
  });
  await deliverPurchaseOrder({
    purchaseOrderId: po2.id,
    userId: w.userId,
    lineReceipts: { [po2Lines[0].id]: po2Lines[0].quantityOrdered },
    actualUnitCostsCents: { [po2Lines[0].id]: 1400 }, // 16.67% up
  });

  const dash = await getPricingDashboard(w.locationId, { days: 60 });
  const row = dash.rows.find((r) => r.inventoryItemId === w.milkId);
  assert(row != null, "milk row in pricing dashboard");
  if (row) {
    assert(
      row.summary.baselineCents === 1200,
      `baseline = $12 (got ${row.summary.baselineCents}¢)`
    );
    assert(
      row.summary.currentCents === 1400,
      `current = $14 (got ${row.summary.currentCents}¢)`
    );
    assert(row.summary.trend === "up", `trend = up (got ${row.summary.trend})`);
    assert(
      row.summary.severity === "review",
      `severity = review at 16.67% (got ${row.summary.severity})`
    );
  }
});

await cleanup();

console.log(
  `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPassed: ${passed}\nFailed: ${failed}${
    failed > 0 ? "\n\nFailures:\n  - " + failures.join("\n  - ") : ""
  }`
);
if (failed > 0) process.exit(1);
else console.log("\n🎉 ALL CAFÉ LIFECYCLE TESTS PASSED");

await db.$disconnect();
