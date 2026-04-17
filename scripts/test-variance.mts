// Tests the variance report — the theoretical-vs-actual shrinkage
// calculator that's the app's highest-leverage money feature.
//
//  - classifyVarianceSeverity returns the right band at each
//    threshold ($ and %)
//  - calculateVarianceRow correctly splits movements into
//    theoretical / tracked-waste / shrinkage buckets, handles the
//    edge cases (no supplier cost, positive shrinkage from "found
//    more than expected", zero theoretical usage)
//  - getVarianceReport joins the whole thing against the DB for a
//    realistic cafe with mixed movements

process.env.N8N_WEBHOOK_SECRET =
  process.env.N8N_WEBHOOK_SECRET ?? "test-webhook-secret-for-variance";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-for-variance";

import { PrismaClient } from "../src/generated/prisma-postgres/client.js";

const {
  calculateVarianceRow,
  classifyVarianceSeverity,
  getVarianceReport,
  getItemVarianceDetail,
} = await import("../src/modules/variance/report.ts");

const db = new PrismaClient();

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: unknown, label: string) {
  if (cond) {
    passed += 1;
    console.log(`    ✅ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`    ❌ ${label}`);
  }
}

async function scenario(name: string, fn: () => Promise<void> | void) {
  console.log(`\n━━ ${name}`);
  try {
    await fn();
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`    ❌ THREW: ${msg}`);
  }
}

// ── classifyVarianceSeverity ───────────────────────────────────────

await scenario("severity: clean below $15 and 2%", () => {
  assert(classifyVarianceSeverity({ shrinkageCents: 100, shrinkagePct: 0.01 }) === "clean", "small amounts clean");
  assert(classifyVarianceSeverity({ shrinkageCents: 1499, shrinkagePct: 0 }) === "clean", "just under $15 threshold");
});

await scenario("severity: watch at $15 OR 2%", () => {
  assert(classifyVarianceSeverity({ shrinkageCents: 1500, shrinkagePct: 0 }) === "watch", "$15 exactly");
  assert(classifyVarianceSeverity({ shrinkageCents: 0, shrinkagePct: 0.02 }) === "watch", "2% exactly");
  assert(classifyVarianceSeverity({ shrinkageCents: 2500, shrinkagePct: 0.03 }) === "watch", "$25 + 3%");
});

await scenario("severity: review at $50 OR 5%", () => {
  assert(classifyVarianceSeverity({ shrinkageCents: 5000, shrinkagePct: 0 }) === "review", "$50 exactly");
  assert(classifyVarianceSeverity({ shrinkageCents: 0, shrinkagePct: 0.05 }) === "review", "5% exactly");
  assert(classifyVarianceSeverity({ shrinkageCents: 100, shrinkagePct: 0.15 }) === "review", "big % override");
});

await scenario("severity: null inputs treated as zero", () => {
  assert(classifyVarianceSeverity({ shrinkageCents: null, shrinkagePct: null }) === "clean", "all null = clean");
});

// ── calculateVarianceRow ───────────────────────────────────────────

await scenario("calculateVarianceRow: typical milk week", () => {
  // 24L received, 22L POS-depleted, 500ml waste, 300ml extra shrinkage
  // at cost $0.30/100ml ($12 for a 4L case)
  const row = calculateVarianceRow({
    inventoryItemId: "milk",
    itemName: "Milk 2%",
    category: "DAIRY",
    displayUnit: "LITER",
    packSizeBase: 4000,
    unitCostCents: 1200,
    buckets: {
      received: 24000,
      pos_depletion: -22000,
      waste: -500,
      breakage: 0,
      transfer: 0,
      correction: 0,
      count_adjustment: -300,
      returned: 0,
    },
  });
  assert(row.receivedBase === 24000, "received captured as absolute");
  assert(row.theoreticalUsageBase === 22000, "theoretical = |POS_DEPLETION|");
  assert(row.trackedWasteBase === 500, "tracked waste = |WASTE| + |BREAKAGE| + |TRANSFER|");
  // count_adjustment was -300 → shrinkage is -(-300) = +300 (loss)
  assert(row.shrinkageBase === 300, `shrinkage = +300 ml lost (got ${row.shrinkageBase})`);
  // 300ml × $12/4000ml = $0.90 = 90¢
  assert(row.shrinkageCents === 90, `shrinkage = 90¢ (got ${row.shrinkageCents})`);
  // 22000ml theoretical × 0.3¢/ml = 6600¢ = $66
  assert(row.theoreticalUsageCents === 6600, `theoretical dollars = $66 (got ${row.theoreticalUsageCents})`);
  // 300/22000 ≈ 0.0136 = 1.36%
  assert(
    row.shrinkagePct != null && Math.abs(row.shrinkagePct - 300 / 22000) < 0.0001,
    `shrinkagePct ~1.36% (got ${row.shrinkagePct})`
  );
  assert(row.severity === "clean", `severity clean at 1.4% (got ${row.severity})`);
});

await scenario("calculateVarianceRow: big shrinkage → review severity", () => {
  // 1kg of expensive saffron, 100g POS-depleted, 50g mystery shrinkage
  // cost $80/100g → 50g × $0.80 = $40 = 4000¢
  const row = calculateVarianceRow({
    inventoryItemId: "saffron",
    itemName: "Saffron",
    category: "BAKERY_INGREDIENT",
    displayUnit: "GRAM",
    packSizeBase: 100,
    unitCostCents: 8000,
    buckets: {
      received: 200,
      pos_depletion: -100,
      waste: 0,
      breakage: 0,
      transfer: 0,
      correction: -50,
      count_adjustment: 0,
      returned: 0,
    },
  });
  assert(row.shrinkageBase === 50, "shrinkage 50g");
  assert(row.shrinkageCents === 4000, `shrinkage $40 (got ${row.shrinkageCents})`);
  // 50/100 = 50% shrinkage — way over review threshold
  assert(row.severity === "review", "50% shrinkage = review");
});

await scenario("calculateVarianceRow: 'found more than expected' is flagged but doesn't zero out cost", () => {
  const row = calculateVarianceRow({
    inventoryItemId: "flour",
    itemName: "Flour",
    category: "BAKERY_INGREDIENT",
    displayUnit: "KILOGRAM",
    packSizeBase: 1000,
    unitCostCents: 500,
    buckets: {
      received: 0,
      pos_depletion: -1000,
      waste: 0,
      breakage: 0,
      transfer: 0,
      correction: 0,
      count_adjustment: 200, // found MORE than expected at count
      returned: 0,
    },
  });
  // shrinkage = -(count_adjustment) = -200 (negative = "found more")
  assert(row.shrinkageBase === -200, `negative shrinkage (got ${row.shrinkageBase})`);
  // dollars still positive — money is money
  assert(row.shrinkageCents === 100, `dollar loss still $1 (abs; got ${row.shrinkageCents})`);
  // pct: -200/1000 = -20%; abs = 20% → review
  assert(row.severity === "review", "|20%| still flagged for review");
});

await scenario("calculateVarianceRow: no supplier cost → null dollar amounts, non-null quantities", () => {
  const row = calculateVarianceRow({
    inventoryItemId: "new-item",
    itemName: "New Item",
    category: null,
    displayUnit: "COUNT",
    packSizeBase: 50,
    unitCostCents: null,
    buckets: {
      received: 0,
      pos_depletion: 0,
      waste: -5,
      breakage: 0,
      transfer: 0,
      correction: -3,
      count_adjustment: 0,
      returned: 0,
    },
  });
  assert(row.trackedWasteBase === 5, "quantity reported");
  assert(row.shrinkageBase === 3, "shrinkage reported");
  assert(row.trackedWasteCents === null, "no cost → null dollar");
  assert(row.shrinkageCents === null, "no cost → null dollar");
  // no theoretical, no cost → severity based on zero
  assert(row.severity === "clean", "no cost = can't flag by dollar; % is null → clean");
});

await scenario("calculateVarianceRow: zero activity → all zeros, clean", () => {
  const row = calculateVarianceRow({
    inventoryItemId: "quiet",
    itemName: "Unused",
    category: null,
    displayUnit: "COUNT",
    packSizeBase: 1,
    unitCostCents: 100,
    buckets: {
      received: 0,
      pos_depletion: 0,
      waste: 0,
      breakage: 0,
      transfer: 0,
      correction: 0,
      count_adjustment: 0,
      returned: 0,
    },
  });
  assert(row.theoreticalUsageBase === 0, "no usage");
  assert(row.trackedWasteBase === 0, "no waste");
  assert(row.shrinkageBase === 0, "no shrinkage");
  assert(row.severity === "clean", "clean");
});

// ── Full DB roundtrip ──────────────────────────────────────────────

const stamp = Date.now().toString(36);
let counter = 0;
async function buildCafe() {
  const suffix = `${stamp}-${++counter}-${Math.random().toString(36).slice(2, 5)}`;
  const biz = await db.business.create({
    data: { name: `Variance Test ${suffix}`, slug: `var-${suffix}` },
  });
  const loc = await db.location.create({
    data: {
      businessId: biz.id,
      name: "Cafe",
      timezone: "America/Toronto",
    },
  });
  const user = await db.user.create({
    data: {
      email: `var-${suffix}@t.example`,
      name: "Variance Tester",
      passwordHash: "x",
      roles: { create: { locationId: loc.id, role: "MANAGER" } },
    },
  });
  return { biz, loc, user, suffix };
}

async function makeItem({
  locationId,
  name,
  costCents,
  supplierId,
}: {
  locationId: string;
  name: string;
  costCents: number;
  supplierId: string;
}) {
  const item = await db.inventoryItem.create({
    data: {
      locationId,
      name,
      sku: `${name.slice(0, 3).toUpperCase()}-${stamp}-${counter}`,
      category: "DAIRY",
      displayUnit: "LITER",
      baseUnit: "MILLILITER",
      countUnit: "MILLILITER",
      purchaseUnit: "LITER",
      packSizeBase: 4000,
      parLevelBase: 20000,
      lowStockThresholdBase: 8000,
      safetyStockBase: 4000,
    },
  });
  await db.supplierItem.create({
    data: {
      supplierId,
      inventoryItemId: item.id,
      packSizeBase: 4000,
      lastUnitCostCents: costCents,
    },
  });
  return item;
}

async function postMovement(
  locationId: string,
  itemId: string,
  type:
    | "RECEIVING"
    | "POS_DEPLETION"
    | "WASTE"
    | "BREAKAGE"
    | "TRANSFER"
    | "CORRECTION"
    | "MANUAL_COUNT_ADJUSTMENT"
    | "RETURN",
  deltaBase: number,
  performedAt: Date
) {
  await db.stockMovement.create({
    data: {
      locationId,
      inventoryItemId: itemId,
      movementType: type,
      quantityDeltaBase: deltaBase,
      beforeBalanceBase: 0,
      afterBalanceBase: 0,
      sourceType: "test",
      sourceId: `test-${stamp}-${Math.random().toString(36).slice(2, 6)}`,
      performedAt,
    },
  });
}

await scenario("getVarianceReport: cafe with realistic week of activity", async () => {
  const { loc } = await buildCafe();
  const sup = await db.supplier.create({
    data: {
      locationId: loc.id,
      name: "FreshCo",
      orderingMode: "EMAIL",
      email: `fresh-${stamp}-${counter}@t.example`,
    },
  });
  const milk = await makeItem({
    locationId: loc.id,
    name: "Milk 2%",
    costCents: 1200,
    supplierId: sup.id,
  });
  const oat = await makeItem({
    locationId: loc.id,
    name: "Oat Milk",
    costCents: 450,
    supplierId: sup.id,
  });

  // 3 days ago: receive 24L milk, 8L oat
  const d3 = new Date(Date.now() - 3 * 86400_000);
  await postMovement(loc.id, milk.id, "RECEIVING", 24000, d3);
  await postMovement(loc.id, oat.id, "RECEIVING", 8000, d3);

  // Over the 3 days: POS depletes 22L milk, 6L oat
  const d2 = new Date(Date.now() - 2 * 86400_000);
  await postMovement(loc.id, milk.id, "POS_DEPLETION", -22000, d2);
  await postMovement(loc.id, oat.id, "POS_DEPLETION", -6000, d2);

  // Logged waste
  const d1 = new Date(Date.now() - 1 * 86400_000);
  await postMovement(loc.id, milk.id, "WASTE", -500, d1);

  // Count adjustment: extra milk shrinkage 300ml, oat shrinkage 800ml
  await postMovement(loc.id, milk.id, "MANUAL_COUNT_ADJUSTMENT", -300, d1);
  await postMovement(loc.id, oat.id, "MANUAL_COUNT_ADJUSTMENT", -800, d1);

  const report = await getVarianceReport(loc.id, { days: 7 });

  assert(report.rows.length === 2, `2 items (got ${report.rows.length})`);

  const milkRow = report.rows.find((r) => r.inventoryItemId === milk.id);
  assert(milkRow != null, "milk row present");
  assert(milkRow!.theoreticalUsageBase === 22000, "milk theoretical 22L");
  assert(milkRow!.trackedWasteBase === 500, "milk tracked waste 500ml");
  assert(milkRow!.shrinkageBase === 300, "milk shrinkage 300ml");
  // 500ml × 0.3¢/ml = 150¢, 300ml × 0.3¢/ml = 90¢
  assert(milkRow!.trackedWasteCents === 150, `milk waste $1.50 (got ${milkRow!.trackedWasteCents})`);
  assert(milkRow!.shrinkageCents === 90, `milk shrink $0.90 (got ${milkRow!.shrinkageCents})`);

  const oatRow = report.rows.find((r) => r.inventoryItemId === oat.id);
  assert(oatRow != null, "oat row present");
  assert(oatRow!.shrinkageBase === 800, "oat shrinkage 800ml");
  // 800ml × (450/4000)¢/ml = 800 × 0.1125 = 90¢
  assert(oatRow!.shrinkageCents === 90, `oat shrinkage $0.90 (got ${oatRow!.shrinkageCents})`);
  // 800ml / 6000ml = 13.3% → review severity
  assert(oatRow!.severity === "review", `oat 13% shrinkage = review (got ${oatRow!.severity})`);

  // Worst-offender sort: whichever has higher shrinkageCents first.
  // They're tied at 90¢ each; test stability instead of order.
  assert(
    report.shrinkageCents === 180,
    `total shrinkage = $1.80 (got ${report.shrinkageCents})`
  );
  assert(
    report.trackedWasteCents === 150,
    `total waste = $1.50 (got ${report.trackedWasteCents})`
  );
  assert(report.totalLossCents === 330, "total loss = $3.30");
  assert(report.flaggedCount === 1, "1 flagged (oat)");
});

await scenario("getVarianceReport: excludes movements outside the range", async () => {
  const { loc } = await buildCafe();
  const sup = await db.supplier.create({
    data: {
      locationId: loc.id,
      name: "S",
      orderingMode: "EMAIL",
      email: `s-${stamp}-${counter}@t.example`,
    },
  });
  const item = await makeItem({
    locationId: loc.id,
    name: "Milk",
    costCents: 1200,
    supplierId: sup.id,
  });
  // Movement INSIDE range
  await postMovement(
    loc.id,
    item.id,
    "WASTE",
    -100,
    new Date(Date.now() - 2 * 86400_000)
  );
  // Movement 60 days ago — should be outside the 7-day window
  await postMovement(
    loc.id,
    item.id,
    "WASTE",
    -999,
    new Date(Date.now() - 60 * 86400_000)
  );

  const week = await getVarianceReport(loc.id, { days: 7 });
  const row = week.rows.find((r) => r.inventoryItemId === item.id);
  assert(row != null, "row present");
  assert(row!.trackedWasteBase === 100, "only in-range waste counted");

  const quarter = await getVarianceReport(loc.id, { days: 90 });
  const qRow = quarter.rows.find((r) => r.inventoryItemId === item.id);
  assert(qRow!.trackedWasteBase === 1099, "extending range picks up older movement");
});

await scenario("getItemVarianceDetail: returns chronological list of movements", async () => {
  const { loc } = await buildCafe();
  const sup = await db.supplier.create({
    data: {
      locationId: loc.id,
      name: "S",
      orderingMode: "EMAIL",
      email: `sd-${stamp}-${counter}@t.example`,
    },
  });
  const item = await makeItem({
    locationId: loc.id,
    name: "Milk",
    costCents: 1200,
    supplierId: sup.id,
  });
  const now = Date.now();
  await postMovement(loc.id, item.id, "RECEIVING", 4000, new Date(now - 3 * 86400_000));
  await postMovement(loc.id, item.id, "POS_DEPLETION", -1500, new Date(now - 2 * 86400_000));
  await postMovement(loc.id, item.id, "WASTE", -100, new Date(now - 1 * 86400_000));

  const detail = await getItemVarianceDetail(loc.id, item.id, { days: 7 });
  assert(detail != null, "detail found");
  assert(detail!.movements.length === 3, `3 movements (got ${detail!.movements.length})`);
  // desc order by performedAt
  assert(
    detail!.movements[0].type === "WASTE",
    `newest is WASTE (got ${detail!.movements[0].type})`
  );
  assert(
    detail!.movements[2].type === "RECEIVING",
    "oldest is RECEIVING"
  );
});

await scenario("getItemVarianceDetail: cross-tenant → null", async () => {
  const a = await buildCafe();
  const b = await buildCafe();
  const sup = await db.supplier.create({
    data: {
      locationId: a.loc.id,
      name: "X",
      orderingMode: "EMAIL",
      email: `x-${stamp}-${counter}@t.example`,
    },
  });
  const item = await makeItem({
    locationId: a.loc.id,
    name: "Milk",
    costCents: 1200,
    supplierId: sup.id,
  });
  // Query B's location for A's item → should get null
  const detail = await getItemVarianceDetail(b.loc.id, item.id);
  assert(detail === null, "cross-tenant lookup returns null");
});

// ── Cleanup ─────────────────────────────────────────────────────────

async function cleanup() {
  const biz = await db.business.findMany({
    where: { slug: { startsWith: `var-${stamp}` } },
    select: { id: true, locations: { select: { id: true } } },
  });
  const locIds = biz.flatMap((b) => b.locations.map((l) => l.id));
  if (locIds.length > 0) {
    await db.auditLog.deleteMany({ where: { locationId: { in: locIds } } });
    await db.stockMovement.deleteMany({
      where: { inventoryItem: { locationId: { in: locIds } } },
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
    where: { email: { contains: `var-${stamp}` } },
  });
  await db.business.deleteMany({
    where: { slug: { startsWith: `var-${stamp}` } },
  });
}
await cleanup();

console.log(
  `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPassed: ${passed}\nFailed: ${failed}${
    failed > 0 ? "\n\nFailures:\n  - " + failures.join("\n  - ") : ""
  }`
);
if (failed > 0) process.exit(1);
else console.log("\n🎉 ALL VARIANCE TESTS PASSED");

await db.$disconnect();
