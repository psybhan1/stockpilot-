// Tests the ingredient-price-history pipeline:
//   - summarizePriceChange handles single/empty/multi-point cases
//   - severity bands at 5% / 15% match the variance thresholds
//   - getPriceHistory joins PurchaseOrderLine + PurchaseOrder +
//     Supplier correctly and returns chronological points
//   - getPricingDashboard ranks by |deltaPct| descending and
//     filters to items with ≥1 actual-cost data point
//
// No mocking of the LLM — the feature is derived from stored data
// with no AI calls. Pure DB + math.

process.env.N8N_WEBHOOK_SECRET =
  process.env.N8N_WEBHOOK_SECRET ?? "test-webhook-secret-for-pricing";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-for-pricing";

import { PrismaClient } from "../src/generated/prisma-postgres/client.js";

const {
  summarizePriceChange,
  getPriceHistory,
  getPriceHistoryBatch,
  getPricingDashboard,
} = await import("../src/modules/pricing/history.ts");

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

// ── summarizePriceChange: the pure math ────────────────────────────

await scenario("summarizePriceChange: empty → null everything, clean", () => {
  const s = summarizePriceChange([]);
  assert(s.currentCents === null, "current null");
  assert(s.baselineCents === null, "baseline null");
  assert(s.deltaCents === null, "delta null");
  assert(s.trend === "unknown", "trend unknown");
  assert(s.severity === "clean", "clean");
  assert(s.points === 0, "0 points");
});

await scenario("summarizePriceChange: single point → current set, no delta", () => {
  const s = summarizePriceChange([
    {
      at: "2026-04-01T00:00:00Z",
      unitCostCents: 1200,
      supplierId: "s1",
      supplierName: "FreshCo",
      purchaseOrderId: "po1",
      orderNumber: "PO-1",
    },
  ]);
  assert(s.currentCents === 1200, "current = 1200");
  assert(s.baselineCents === null, "baseline null with one point");
  assert(s.deltaCents === null, "delta null");
  assert(s.points === 1, "1 point");
  assert(s.severity === "clean", "clean");
});

await scenario("summarizePriceChange: 12% increase → watch + up", () => {
  const s = summarizePriceChange([
    point("2026-03-01", 1000),
    point("2026-04-01", 1120),
  ]);
  assert(s.currentCents === 1120, "current 1120");
  assert(s.baselineCents === 1000, "baseline 1000");
  assert(s.deltaCents === 120, "delta +120");
  assert(s.deltaPct != null && Math.abs(s.deltaPct - 0.12) < 0.0001, "12%");
  assert(s.trend === "up", "up");
  assert(s.severity === "watch", "watch (5-15%)");
});

await scenario("summarizePriceChange: 20% decrease → review + down", () => {
  const s = summarizePriceChange([
    point("2026-03-01", 1000),
    point("2026-04-01", 800),
  ]);
  assert(s.deltaPct != null && Math.abs(s.deltaPct + 0.2) < 0.0001, "-20%");
  assert(s.trend === "down", "down");
  assert(s.severity === "review", "review (≥15%)");
});

await scenario("summarizePriceChange: unsorted input gets sorted chronologically", () => {
  // Apr first, Mar second (out of order)
  const s = summarizePriceChange([
    point("2026-04-01", 1200),
    point("2026-03-01", 1000),
    point("2026-03-15", 1100),
  ]);
  assert(s.currentCents === 1200, "latest = Apr's 1200");
  assert(s.baselineCents === 1000, "earliest = Mar 1's 1000");
});

await scenario("summarizePriceChange: flat prices → flat trend, clean", () => {
  const s = summarizePriceChange([
    point("2026-03-01", 1200),
    point("2026-04-01", 1200),
  ]);
  assert(s.trend === "flat", "flat");
  assert(s.severity === "clean", "clean");
  assert(s.deltaCents === 0, "delta 0");
});

// ── DB roundtrip: build data, fetch history, verify ───────────────

const stamp = Date.now().toString(36);
let counter = 0;
async function buildCafe() {
  const suffix = `${stamp}-${++counter}-${Math.random().toString(36).slice(2, 5)}`;
  const biz = await db.business.create({
    data: { name: `Pricing Test ${suffix}`, slug: `price-${suffix}` },
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
      email: `price-${suffix}@t.example`,
      name: "Pricer",
      passwordHash: "x",
      roles: { create: { locationId: loc.id, role: "MANAGER" } },
    },
  });
  return { biz, loc, user, suffix };
}

async function makeItemAndSupplier(locationId: string, name: string) {
  const sup = await db.supplier.create({
    data: {
      locationId,
      name,
      orderingMode: "EMAIL",
      email: `${name.toLowerCase().replace(/\s+/g, "")}-${stamp}-${counter}@t.example`,
    },
  });
  const item = await db.inventoryItem.create({
    data: {
      locationId,
      name: "Milk 2%",
      sku: `MILK-${stamp}-${counter}`,
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
  return { sup, item };
}

async function postDeliveredPO(
  locationId: string,
  supplierId: string,
  itemId: string,
  actualCostCents: number,
  deliveredAt: Date,
  orderNumber: string
) {
  return db.purchaseOrder.create({
    data: {
      locationId,
      supplierId,
      orderNumber,
      status: "DELIVERED",
      deliveredAt,
      sentAt: new Date(deliveredAt.getTime() - 86400_000),
      totalLines: 1,
      lines: {
        create: {
          inventoryItemId: itemId,
          description: "Milk case",
          quantityOrdered: 3,
          expectedQuantityBase: 12000,
          purchaseUnit: "CASE",
          packSizeBase: 4000,
          latestCostCents: actualCostCents,
          actualUnitCostCents: actualCostCents,
          actualQuantityBase: 12000,
        },
      },
    },
  });
}

await scenario("getPriceHistory: chronological, 3 points over a month", async () => {
  const { loc } = await buildCafe();
  const { sup, item } = await makeItemAndSupplier(loc.id, "FreshCo");
  await postDeliveredPO(
    loc.id,
    sup.id,
    item.id,
    1000,
    new Date("2026-03-15"),
    `PO-${stamp}-a`
  );
  await postDeliveredPO(
    loc.id,
    sup.id,
    item.id,
    1050,
    new Date("2026-03-29"),
    `PO-${stamp}-b`
  );
  await postDeliveredPO(
    loc.id,
    sup.id,
    item.id,
    1200,
    new Date("2026-04-12"),
    `PO-${stamp}-c`
  );

  const history = await getPriceHistory(loc.id, item.id, { days: 60 });
  assert(history.points.length === 3, `3 points (got ${history.points.length})`);
  const prices = history.points.map((p) => p.unitCostCents);
  assert(prices[0] === 1000, "earliest = 1000");
  assert(prices[2] === 1200, "latest = 1200");
  // Dates ascending
  const times = history.points.map((p) => new Date(p.at).getTime());
  assert(times[0] < times[1] && times[1] < times[2], "chronological order");
});

await scenario("getPriceHistory: window excludes older points", async () => {
  const { loc } = await buildCafe();
  const { sup, item } = await makeItemAndSupplier(loc.id, "FreshCo");
  const now = Date.now();
  await postDeliveredPO(
    loc.id,
    sup.id,
    item.id,
    1000,
    new Date(now - 120 * 86400_000), // 120 days ago
    `PO-${stamp}-old`
  );
  await postDeliveredPO(
    loc.id,
    sup.id,
    item.id,
    1100,
    new Date(now - 10 * 86400_000), // 10 days ago
    `PO-${stamp}-new`
  );

  const h30 = await getPriceHistory(loc.id, item.id, { days: 30 });
  assert(h30.points.length === 1, "only 1 point in 30-day window");
  assert(h30.points[0].unitCostCents === 1100, "latest in window");

  const h365 = await getPriceHistory(loc.id, item.id, { days: 365 });
  assert(h365.points.length === 2, "both points in year window");
});

await scenario("getPriceHistory: ignores lines with null actualUnitCostCents", async () => {
  const { loc } = await buildCafe();
  const { sup, item } = await makeItemAndSupplier(loc.id, "FreshCo");
  // A delivered PO where actualUnitCostCents was never recorded.
  await db.purchaseOrder.create({
    data: {
      locationId: loc.id,
      supplierId: sup.id,
      orderNumber: `PO-${stamp}-no-actual`,
      status: "DELIVERED",
      deliveredAt: new Date(),
      sentAt: new Date(Date.now() - 86400_000),
      totalLines: 1,
      lines: {
        create: {
          inventoryItemId: item.id,
          description: "Milk case",
          quantityOrdered: 3,
          expectedQuantityBase: 12000,
          purchaseUnit: "CASE",
          packSizeBase: 4000,
          latestCostCents: 1200,
          // actualUnitCostCents intentionally omitted
        },
      },
    },
  });

  const history = await getPriceHistory(loc.id, item.id, { days: 90 });
  assert(history.points.length === 0, "no actuals → no data points");
});

await scenario("getPriceHistoryBatch: returns empty array for items with no data", async () => {
  const { loc } = await buildCafe();
  const { item } = await makeItemAndSupplier(loc.id, "FreshCo");

  const map = await getPriceHistoryBatch(loc.id, [item.id]);
  const h = map.get(item.id);
  assert(h != null, "item in map");
  assert(h!.points.length === 0, "points empty for quiet item");
});

await scenario("getPricingDashboard: ranks by |deltaPct| descending", async () => {
  const { loc } = await buildCafe();
  const { sup } = await makeItemAndSupplier(loc.id, "FreshCo");

  // Item A: small change
  const itemA = await db.inventoryItem.create({
    data: {
      locationId: loc.id,
      name: "Cups",
      sku: `CUP-${stamp}-${counter}`,
      category: "PACKAGING",
      displayUnit: "COUNT",
      baseUnit: "COUNT",
      countUnit: "COUNT",
      purchaseUnit: "CASE",
      packSizeBase: 50,
      parLevelBase: 500,
      lowStockThresholdBase: 100,
      safetyStockBase: 100,
    },
  });
  await postDeliveredPO(
    loc.id,
    sup.id,
    itemA.id,
    1000,
    new Date(Date.now() - 30 * 86400_000),
    `PO-${stamp}-a1`
  );
  await postDeliveredPO(
    loc.id,
    sup.id,
    itemA.id,
    1050,
    new Date(Date.now() - 5 * 86400_000),
    `PO-${stamp}-a2`
  );

  // Item B: big change (+30%)
  const itemB = await db.inventoryItem.create({
    data: {
      locationId: loc.id,
      name: "Beans",
      sku: `BEAN-${stamp}-${counter}`,
      category: "COFFEE",
      displayUnit: "KILOGRAM",
      baseUnit: "GRAM",
      countUnit: "GRAM",
      purchaseUnit: "KILOGRAM",
      packSizeBase: 1000,
      parLevelBase: 5000,
      lowStockThresholdBase: 1000,
      safetyStockBase: 500,
    },
  });
  await postDeliveredPO(
    loc.id,
    sup.id,
    itemB.id,
    2000,
    new Date(Date.now() - 30 * 86400_000),
    `PO-${stamp}-b1`
  );
  await postDeliveredPO(
    loc.id,
    sup.id,
    itemB.id,
    2600,
    new Date(Date.now() - 5 * 86400_000),
    `PO-${stamp}-b2`
  );

  const dash = await getPricingDashboard(loc.id, { days: 60 });
  assert(dash.rows.length === 2, `2 items (got ${dash.rows.length})`);
  assert(
    dash.rows[0].inventoryItemId === itemB.id,
    `biggest swing first (Beans, got ${dash.rows[0].itemName})`
  );
  assert(
    dash.rows[1].inventoryItemId === itemA.id,
    `Cups second (got ${dash.rows[1].itemName})`
  );
  assert(dash.rows[0].summary.severity === "review", "30% swing → review");
  assert(dash.rows[0].summary.trend === "up", "up trend");
  assert(dash.reviewCount === 1, "1 review");
  assert(dash.watchCount === 1, "5% = watch");
});

await scenario("getPricingDashboard: filters out items with zero actual-cost history", async () => {
  const { loc } = await buildCafe();
  // Item with supplier but no delivered PO → shouldn't appear.
  await makeItemAndSupplier(loc.id, "FreshCo");

  const dash = await getPricingDashboard(loc.id, { days: 90 });
  assert(dash.rows.length === 0, "item with no history excluded");
});

// ── Cleanup ─────────────────────────────────────────────────────────

async function cleanup() {
  const biz = await db.business.findMany({
    where: { slug: { startsWith: `price-${stamp}` } },
    select: { id: true, locations: { select: { id: true } } },
  });
  const locIds = biz.flatMap((b) => b.locations.map((l) => l.id));
  if (locIds.length > 0) {
    await db.auditLog.deleteMany({ where: { locationId: { in: locIds } } });
    await db.stockMovement.deleteMany({
      where: { inventoryItem: { locationId: { in: locIds } } },
    });
    await db.purchaseOrderLine.deleteMany({
      where: { purchaseOrder: { locationId: { in: locIds } } },
    });
    await db.purchaseOrder.deleteMany({
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
    where: { email: { contains: `price-${stamp}` } },
  });
  await db.business.deleteMany({
    where: { slug: { startsWith: `price-${stamp}` } },
  });
}
await cleanup();

console.log(
  `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPassed: ${passed}\nFailed: ${failed}${
    failed > 0 ? "\n\nFailures:\n  - " + failures.join("\n  - ") : ""
  }`
);
if (failed > 0) process.exit(1);
else console.log("\n🎉 ALL PRICING TESTS PASSED");

await db.$disconnect();

// ── helpers ─────────────────────────────────────────────────────────

function point(atDate: string, unitCostCents: number) {
  return {
    at: `${atDate}T00:00:00Z`,
    unitCostCents,
    supplierId: "s1",
    supplierName: "FreshCo",
    purchaseOrderId: `po-${atDate}`,
    orderNumber: `PO-${atDate}`,
  };
}
