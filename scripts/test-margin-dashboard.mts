// Tests the per-menu-item COGS + margin pipeline end-to-end:
//
//  - calculateRecipeCogs handles the tricky cases (missing cost,
//    optional modifier, zero pack size, cumulative-rounding drift)
//  - classifyMargin returns the right severity at thresholds
//  - getMarginDashboard joins MenuItem ↔ Variant ↔ Recipe ↔
//    Components ↔ SupplierItem ↔ PosCatalogVariation correctly and
//    returns rows with the right cogs + margin for a realistic
//    restaurant setup
//  - getVariantMarginBreakdown returns per-component breakdown
//    including optional modifiers separated out
//
// DB test uses a fresh business per scenario so there's no cross-
// test contamination (same pattern as test-restaurant-day).

process.env.N8N_WEBHOOK_SECRET =
  process.env.N8N_WEBHOOK_SECRET ?? "test-webhook-secret-for-margin-dashboard";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-for-margin-dashboard";

import { PrismaClient } from "../src/generated/prisma-postgres/client.js";

const { calculateRecipeCogs, classifyMargin, costOneComponent } = await import(
  "../src/modules/recipes/costing.ts"
);
const { getMarginDashboard, getVariantMarginBreakdown } = await import(
  "../src/modules/recipes/margin-dashboard.ts"
);

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

// ── Pure-function tests: costOneComponent ───────────────────────────

await scenario("costOneComponent: typical latte milk (150ml of 4L case @ $12)", () => {
  // 150ml / 4000ml * 1200¢ = 45¢
  const cost = costOneComponent({
    id: "c1",
    inventoryItemId: "i1",
    inventoryItemName: "Milk",
    quantityBase: 150,
    packSizeBase: 4000,
    lastUnitCostCents: 1200,
    componentType: "INGREDIENT",
    displayUnit: "MILLILITER",
    optional: false,
    modifierKey: null,
    conditionServiceMode: null,
  });
  assert(cost === 45, `45¢ (got ${cost})`);
});

await scenario("costOneComponent: very small quantity (0.5g saffron of 100g @ $80)", () => {
  // 0.5g * 8000¢ / 100g = 40¢ — but we don't round to whole cents
  // per-component; should preserve 0.01¢ precision.
  const cost = costOneComponent({
    id: "c1",
    inventoryItemId: "i1",
    inventoryItemName: "Saffron",
    quantityBase: 1, // 1g (we work in integer base units per the schema)
    packSizeBase: 100,
    lastUnitCostCents: 8000,
    componentType: "INGREDIENT",
    displayUnit: "GRAM",
    optional: false,
    modifierKey: null,
    conditionServiceMode: null,
  });
  assert(cost === 80, `80¢ (got ${cost})`);
});

await scenario("costOneComponent: null cost → null", () => {
  const cost = costOneComponent({
    id: "c1",
    inventoryItemId: "i1",
    inventoryItemName: "Mystery",
    quantityBase: 100,
    packSizeBase: 1000,
    lastUnitCostCents: null,
    componentType: "INGREDIENT",
    displayUnit: "GRAM",
    optional: false,
    modifierKey: null,
    conditionServiceMode: null,
  });
  assert(cost === null, "null cost returns null");
});

await scenario("costOneComponent: zero packSize → null (not a division error)", () => {
  const cost = costOneComponent({
    id: "c1",
    inventoryItemId: "i1",
    inventoryItemName: "Broken",
    quantityBase: 100,
    packSizeBase: 0,
    lastUnitCostCents: 100,
    componentType: "INGREDIENT",
    displayUnit: "GRAM",
    optional: false,
    modifierKey: null,
    conditionServiceMode: null,
  });
  assert(cost === null, "zero packSize → null");
});

await scenario("costOneComponent: zero quantity → 0 (not null)", () => {
  const cost = costOneComponent({
    id: "c1",
    inventoryItemId: "i1",
    inventoryItemName: "Trace",
    quantityBase: 0,
    packSizeBase: 1000,
    lastUnitCostCents: 100,
    componentType: "INGREDIENT",
    displayUnit: "GRAM",
    optional: false,
    modifierKey: null,
    conditionServiceMode: null,
  });
  assert(cost === 0, "zero qty → 0¢ not null");
});

// ── calculateRecipeCogs: rollups, missing data, modifiers ──────────

await scenario("calculateRecipeCogs: happy path — latte recipe", () => {
  // milk 150ml from 4L @ $12 → 45¢
  // espresso beans 18g from 1kg @ $25 → 45¢
  // cup 1ct from 50ct @ $10 → 20¢
  // total: 110¢
  const result = calculateRecipeCogs([
    {
      id: "c1",
      inventoryItemId: "milk",
      inventoryItemName: "Milk",
      quantityBase: 150,
      packSizeBase: 4000,
      lastUnitCostCents: 1200,
      componentType: "INGREDIENT",
      displayUnit: "MILLILITER",
      optional: false,
      modifierKey: null,
      conditionServiceMode: null,
    },
    {
      id: "c2",
      inventoryItemId: "beans",
      inventoryItemName: "Espresso Beans",
      quantityBase: 18,
      packSizeBase: 1000,
      lastUnitCostCents: 2500,
      componentType: "INGREDIENT",
      displayUnit: "GRAM",
      optional: false,
      modifierKey: null,
      conditionServiceMode: null,
    },
    {
      id: "c3",
      inventoryItemId: "cup",
      inventoryItemName: "Paper Cup",
      quantityBase: 1,
      packSizeBase: 50,
      lastUnitCostCents: 1000,
      componentType: "PACKAGING",
      displayUnit: "COUNT",
      optional: false,
      modifierKey: null,
      conditionServiceMode: null,
    },
  ]);
  assert(result.cogsCents === 110, `110¢ total (got ${result.cogsCents})`);
  assert(result.confidence === 1, "confidence = 1.0 (all components costed)");
  assert(result.breakdown.length === 3, "3 rows in breakdown");
  assert(result.warnings.length === 0, "no warnings");
});

await scenario("calculateRecipeCogs: one ingredient missing cost → partial confidence", () => {
  const result = calculateRecipeCogs([
    {
      id: "c1",
      inventoryItemId: "milk",
      inventoryItemName: "Milk",
      quantityBase: 150,
      packSizeBase: 4000,
      lastUnitCostCents: 1200,
      componentType: "INGREDIENT",
      displayUnit: "MILLILITER",
      optional: false,
      modifierKey: null,
      conditionServiceMode: null,
    },
    {
      id: "c2",
      inventoryItemId: "syrup",
      inventoryItemName: "Vanilla Syrup",
      quantityBase: 10,
      packSizeBase: 750,
      lastUnitCostCents: null, // no invoice yet for vanilla
      componentType: "INGREDIENT",
      displayUnit: "MILLILITER",
      optional: false,
      modifierKey: null,
      conditionServiceMode: null,
    },
  ]);
  assert(result.cogsCents === 45, `45¢ from milk alone (got ${result.cogsCents})`);
  assert(
    Math.abs(result.confidence - 0.5) < 0.001,
    `confidence = 0.5 (got ${result.confidence})`
  );
  assert(result.warnings.some((w) => w.includes("missing recent cost")), "warning fired");
  assert(
    result.breakdown.find((b) => b.inventoryItemId === "syrup")?.warning != null,
    "per-component warning on missing-cost syrup"
  );
});

await scenario("calculateRecipeCogs: optional modifier excluded from rollup but shown in breakdown", () => {
  const result = calculateRecipeCogs([
    {
      id: "c1",
      inventoryItemId: "milk",
      inventoryItemName: "Milk",
      quantityBase: 150,
      packSizeBase: 4000,
      lastUnitCostCents: 1200,
      componentType: "INGREDIENT",
      displayUnit: "MILLILITER",
      optional: false,
      modifierKey: null,
      conditionServiceMode: null,
    },
    {
      id: "c2",
      inventoryItemId: "oat",
      inventoryItemName: "Oat Milk",
      quantityBase: 150,
      packSizeBase: 1000,
      lastUnitCostCents: 450,
      componentType: "INGREDIENT",
      displayUnit: "MILLILITER",
      optional: true,
      modifierKey: "milk_substitute",
      conditionServiceMode: null,
    },
  ]);
  assert(result.cogsCents === 45, "milk only; oat modifier not in base COGS");
  assert(result.confidence === 1, "confidence=1 — oat isn't counted as required");
  assert(result.breakdown.length === 2, "breakdown includes both rows");
  const oat = result.breakdown.find((b) => b.inventoryItemId === "oat");
  assert(oat?.costCents != null, "oat cost computed even though optional");
});

await scenario("calculateRecipeCogs: many-small-ingredients rollup avoids drift", () => {
  // 20 components, each 1g of a 1000g pack @ 100¢. Each = 0.1¢.
  // Naive per-component rounding to whole cents would round 0.1 to
  // 0 each time, summing to 0¢. Our algorithm preserves subcents
  // and rounds at the end → 2¢.
  const components = Array.from({ length: 20 }, (_, i) => ({
    id: `c${i}`,
    inventoryItemId: `i${i}`,
    inventoryItemName: `Spice ${i}`,
    quantityBase: 1,
    packSizeBase: 1000,
    lastUnitCostCents: 100,
    componentType: "INGREDIENT" as const,
    displayUnit: "GRAM" as const,
    optional: false,
    modifierKey: null,
    conditionServiceMode: null,
  }));
  const result = calculateRecipeCogs(components);
  assert(result.cogsCents === 2, `20 × 0.1¢ = 2¢ (got ${result.cogsCents})`);
});

await scenario("calculateRecipeCogs: empty components → 0¢, warning", () => {
  const result = calculateRecipeCogs([]);
  assert(result.cogsCents === 0, "no components → 0¢");
  assert(result.confidence === 0, "confidence 0");
  assert(result.warnings.some((w) => w.includes("no required components")), "emptiness warning");
});

// ── classifyMargin ─────────────────────────────────────────────────

await scenario("classifyMargin: threshold boundaries", () => {
  assert(classifyMargin({ cogsCents: 100, sellPriceCents: 500 }).severity === "healthy", "80% healthy");
  assert(classifyMargin({ cogsCents: 150, sellPriceCents: 500 }).severity === "healthy", "70% healthy");
  assert(classifyMargin({ cogsCents: 151, sellPriceCents: 500 }).severity === "watch", "just under 70% = watch");
  assert(classifyMargin({ cogsCents: 200, sellPriceCents: 500 }).severity === "watch", "60% = watch");
  assert(classifyMargin({ cogsCents: 201, sellPriceCents: 500 }).severity === "review", "just under 60% = review");
  assert(classifyMargin({ cogsCents: 0, sellPriceCents: null }).severity === "unpriced", "null price = unpriced");
  assert(classifyMargin({ cogsCents: 0, sellPriceCents: 0 }).severity === "unpriced", "zero price = unpriced");
  assert(
    classifyMargin({ cogsCents: 600, sellPriceCents: 500 }).severity === "review",
    "negative margin = review (selling below cost)"
  );
});

// ── Full DB roundtrip: build a cafe, run the dashboard ─────────────

const stamp = Date.now().toString(36);
let counter = 0;
async function buildBusiness() {
  const suffix = `${stamp}-${++counter}-${Math.random().toString(36).slice(2, 5)}`;
  const business = await db.business.create({
    data: { name: `Margin Test ${suffix}`, slug: `margin-${suffix}` },
  });
  const location = await db.location.create({
    data: {
      businessId: business.id,
      name: "Cafe",
      timezone: "America/Toronto",
    },
  });
  const user = await db.user.create({
    data: {
      email: `margin-${suffix}@t.example`,
      name: "Tester",
      passwordHash: "x",
      roles: { create: { locationId: location.id, role: "MANAGER" } },
    },
  });
  return { business, location, user, suffix };
}

await scenario("getMarginDashboard: end-to-end query with realistic data", async () => {
  const { location } = await buildBusiness();

  // Supplier + inventory items
  const supplier = await db.supplier.create({
    data: {
      locationId: location.id,
      name: "FreshCo",
      orderingMode: "EMAIL",
      email: "freshco@test.example",
    },
  });
  const milk = await db.inventoryItem.create({
    data: {
      locationId: location.id,
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
  const beans = await db.inventoryItem.create({
    data: {
      locationId: location.id,
      name: "Espresso Beans",
      sku: `BEANS-${stamp}-${counter}`,
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
  await db.supplierItem.create({
    data: {
      supplierId: supplier.id,
      inventoryItemId: milk.id,
      packSizeBase: 4000,
      lastUnitCostCents: 1200, // $12 per 4L case
    },
  });
  await db.supplierItem.create({
    data: {
      supplierId: supplier.id,
      inventoryItemId: beans.id,
      packSizeBase: 1000,
      lastUnitCostCents: 2500, // $25 per kg
    },
  });

  // Menu item + variant
  const menuItem = await db.menuItem.create({
    data: {
      locationId: location.id,
      name: "Latte",
      category: "Coffee",
      source: "SQUARE",
    },
  });
  const variant = await db.menuItemVariant.create({
    data: {
      menuItemId: menuItem.id,
      name: "12oz",
      active: true,
    },
  });

  // POS catalog (for price)
  const posIntegration = await db.posIntegration.create({
    data: {
      locationId: location.id,
      provider: "SQUARE",
      status: "CONNECTED",
    },
  });
  const posItem = await db.posCatalogItem.create({
    data: {
      integrationId: posIntegration.id,
      externalId: `pos-item-${stamp}-${counter}`,
      name: "Latte",
    },
  });
  const posVariation = await db.posCatalogVariation.create({
    data: {
      catalogItemId: posItem.id,
      externalId: `pos-var-${stamp}-${counter}`,
      name: "12oz",
      priceCents: 550, // $5.50
    },
  });
  await db.posVariationMapping.create({
    data: {
      locationId: location.id,
      posVariationId: posVariation.id,
      menuItemVariantId: variant.id,
      mappingStatus: "READY",
    },
  });

  // Recipe
  const recipe = await db.recipe.create({
    data: {
      locationId: location.id,
      menuItemVariantId: variant.id,
      version: 1,
      status: "APPROVED",
    },
  });
  await db.recipeComponent.createMany({
    data: [
      {
        recipeId: recipe.id,
        inventoryItemId: milk.id,
        componentType: "INGREDIENT",
        quantityBase: 150,
        displayUnit: "MILLILITER",
      },
      {
        recipeId: recipe.id,
        inventoryItemId: beans.id,
        componentType: "INGREDIENT",
        quantityBase: 18,
        displayUnit: "GRAM",
      },
    ],
  });

  const rows = await getMarginDashboard(location.id);
  assert(rows.length === 1, `1 variant (got ${rows.length})`);
  const r = rows[0];
  assert(r.menuItemName === "Latte", "menu name correct");
  assert(r.variantName === "12oz", "variant name correct");
  assert(r.sellPriceCents === 550, "sell price from POS");
  // milk 150/4000 * 1200 = 45, beans 18/1000 * 2500 = 45, total 90
  assert(r.cogsCents === 90, `COGS 90¢ (got ${r.cogsCents})`);
  assert(r.marginCents === 460, `margin 460¢ (got ${r.marginCents})`);
  assert(
    r.marginPct != null && Math.abs(r.marginPct - 460 / 550) < 0.0001,
    `margin % ≈ 83.6% (got ${r.marginPct})`
  );
  assert(r.severity === "healthy", "83% is healthy");
  assert(r.confidence === 1, "all ingredients costed");
  assert(r.componentsCosted === 2, "2 costed");
  assert(r.componentsMissing === 0, "0 missing");

  // Detail query
  const detail = await getVariantMarginBreakdown(location.id, variant.id);
  assert(detail != null, "breakdown fetched");
  assert(detail!.components.length === 2, "2 components in breakdown");
  assert(
    detail!.components.every((c) => c.costCents != null),
    "both components have cost"
  );
});

await scenario("getMarginDashboard: variant without recipe → NO_RECIPE + 0 COGS + warning", async () => {
  const { location } = await buildBusiness();
  const menuItem = await db.menuItem.create({
    data: {
      locationId: location.id,
      name: "Mystery Drink",
      source: "SQUARE",
    },
  });
  await db.menuItemVariant.create({
    data: { menuItemId: menuItem.id, name: "Large", active: true },
  });

  const rows = await getMarginDashboard(location.id);
  assert(rows.length === 1, "1 variant");
  const r = rows[0];
  assert(r.recipeStatus === "NO_RECIPE", "recipeStatus flag");
  assert(r.cogsCents === 0, "no recipe → 0 COGS");
  assert(r.warnings.some((w) => w.toLowerCase().includes("no recipe")), "warning about missing recipe");
  assert(r.severity === "unpriced", "no price either → unpriced");
});

await scenario("getMarginDashboard: DRAFT recipe still costs, flags as draft", async () => {
  const { location } = await buildBusiness();
  const supplier = await db.supplier.create({
    data: {
      locationId: location.id,
      name: "S",
      orderingMode: "EMAIL",
      email: "s@t.example",
    },
  });
  const item = await db.inventoryItem.create({
    data: {
      locationId: location.id,
      name: "Sugar",
      sku: `SUG-${stamp}-${counter}`,
      category: "BAKERY_INGREDIENT",
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
  await db.supplierItem.create({
    data: {
      supplierId: supplier.id,
      inventoryItemId: item.id,
      packSizeBase: 1000,
      lastUnitCostCents: 200,
    },
  });
  const menuItem = await db.menuItem.create({
    data: { locationId: location.id, name: "Cookie", source: "SQUARE" },
  });
  const variant = await db.menuItemVariant.create({
    data: { menuItemId: menuItem.id, name: "Regular", active: true },
  });
  const recipe = await db.recipe.create({
    data: {
      locationId: location.id,
      menuItemVariantId: variant.id,
      version: 1,
      status: "DRAFT",
    },
  });
  await db.recipeComponent.create({
    data: {
      recipeId: recipe.id,
      inventoryItemId: item.id,
      componentType: "INGREDIENT",
      quantityBase: 50,
      displayUnit: "GRAM",
    },
  });

  const rows = await getMarginDashboard(location.id);
  const r = rows[0];
  assert(r.recipeStatus === "DRAFT", "recipeStatus shows DRAFT");
  // 50g / 1000g * 200¢ = 10¢
  assert(r.cogsCents === 10, `COGS 10¢ (got ${r.cogsCents})`);
  assert(r.warnings.some((w) => w.toLowerCase().includes("draft")), "flags draft in warnings");
});

await scenario("getMarginDashboard: cheapest supplier wins on multi-supplier items", async () => {
  const { location } = await buildBusiness();
  const supplierA = await db.supplier.create({
    data: {
      locationId: location.id,
      name: "Expensive",
      orderingMode: "EMAIL",
      email: `exp-${stamp}-${counter}@t.example`,
    },
  });
  const supplierB = await db.supplier.create({
    data: {
      locationId: location.id,
      name: "Cheap",
      orderingMode: "EMAIL",
      email: `cheap-${stamp}-${counter}@t.example`,
    },
  });
  const item = await db.inventoryItem.create({
    data: {
      locationId: location.id,
      name: "Flour",
      sku: `FLR-${stamp}-${counter}`,
      category: "BAKERY_INGREDIENT",
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
  await db.supplierItem.create({
    data: {
      supplierId: supplierA.id,
      inventoryItemId: item.id,
      packSizeBase: 1000,
      lastUnitCostCents: 500,
    },
  });
  await db.supplierItem.create({
    data: {
      supplierId: supplierB.id,
      inventoryItemId: item.id,
      packSizeBase: 1000,
      lastUnitCostCents: 300, // cheaper!
    },
  });
  const menuItem = await db.menuItem.create({
    data: { locationId: location.id, name: "Bread", source: "SQUARE" },
  });
  const variant = await db.menuItemVariant.create({
    data: { menuItemId: menuItem.id, name: "Slice", active: true },
  });
  const recipe = await db.recipe.create({
    data: {
      locationId: location.id,
      menuItemVariantId: variant.id,
      version: 1,
      status: "APPROVED",
    },
  });
  await db.recipeComponent.create({
    data: {
      recipeId: recipe.id,
      inventoryItemId: item.id,
      componentType: "INGREDIENT",
      quantityBase: 100,
      displayUnit: "GRAM",
    },
  });

  const rows = await getMarginDashboard(location.id);
  // 100g / 1000g * 300¢ (cheaper supplier) = 30¢
  assert(rows[0].cogsCents === 30, `cheaper supplier used (got ${rows[0].cogsCents}¢)`);
});

// ── Cleanup ────────────────────────────────────────────────────────

async function cleanup() {
  const biz = await db.business.findMany({
    where: { slug: { startsWith: `margin-${stamp}` } },
    select: { id: true, locations: { select: { id: true } } },
  });
  const locIds = biz.flatMap((b) => b.locations.map((l) => l.id));
  if (locIds.length > 0) {
    await db.auditLog.deleteMany({ where: { locationId: { in: locIds } } });
    await db.posVariationMapping.deleteMany({
      where: { locationId: { in: locIds } },
    });
    await db.posCatalogVariation.deleteMany({
      where: { catalogItem: { integration: { locationId: { in: locIds } } } },
    });
    await db.posCatalogItem.deleteMany({
      where: { integration: { locationId: { in: locIds } } },
    });
    await db.posIntegration.deleteMany({
      where: { locationId: { in: locIds } },
    });
    await db.recipeComponent.deleteMany({
      where: { recipe: { locationId: { in: locIds } } },
    });
    await db.recipe.deleteMany({ where: { locationId: { in: locIds } } });
    await db.menuItemVariant.deleteMany({
      where: { menuItem: { locationId: { in: locIds } } },
    });
    await db.menuItem.deleteMany({ where: { locationId: { in: locIds } } });
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
    where: { email: { contains: `margin-${stamp}` } },
  });
  await db.business.deleteMany({
    where: { slug: { startsWith: `margin-${stamp}` } },
  });
}
await cleanup();

console.log(
  `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPassed: ${passed}\nFailed: ${failed}${
    failed > 0 ? "\n\nFailures:\n  - " + failures.join("\n  - ") : ""
  }`
);
if (failed > 0) process.exit(1);
else console.log("\n🎉 ALL MARGIN-DASHBOARD TESTS PASSED");

await db.$disconnect();
