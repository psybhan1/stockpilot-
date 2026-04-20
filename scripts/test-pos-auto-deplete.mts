// End-to-end sanity check for the day-1 revolutionary promise:
//   A café connects Square → first sale rings up → inventory
//   depletes automatically. No manual recipe approval step.
//
// Exercises the full pipeline with the FakeSquare provider:
//   1. PosIntegration (CONNECTED)
//   2. syncCatalog → creates PosCatalog{Item,Variation}, MenuItem,
//      MenuItemVariant, Recipe, RecipeComponent, PosVariationMapping.
//      High-confidence AI suggestions get status=APPROVED and the
//      mapping goes to READY (the fix shipped alongside this script).
//   3. importSampleSales → creates PosSaleEvent + PosSaleLine,
//      then calls processSaleEventById which writes POS_DEPLETION
//      stock movements.
//
// Runs under a throwaway location on the e2e-test-1 business so it
// doesn't touch the main demo data. Idempotent: wipes + re-seeds
// the throwaway location each run.

process.env.N8N_WEBHOOK_SECRET ??= "test-pos-secret";
process.env.SESSION_SECRET ??= "test-pos-session";
process.env.ENCRYPTION_KEY ??= "0000000000000000000000000000000000000000000000000000000000000000";
process.env.DEFAULT_EMAIL_PROVIDER = "console";
process.env.DEFAULT_AI_PROVIDER = "mock";
process.env.DEFAULT_POS_PROVIDER = "fake";

import assert from "node:assert/strict";
import { PrismaClient } from "../src/generated/prisma-postgres/client.js";

const db = new PrismaClient();

const TEST_EMAIL = "e2e-test-1@stockpilot.test";
const TEST_LOCATION_NAME = "[pos-auto-deplete-test]";

async function wipeTestLocation(locationId: string) {
  // Order matters — walk the dependency graph.
  await db.stockMovement.deleteMany({ where: { locationId } });
  await db.inventorySnapshot.deleteMany({ where: { locationId } });
  await db.alert.deleteMany({ where: { locationId } });
  await db.posSaleLine.deleteMany({
    where: { saleEvent: { locationId } },
  });
  await db.posSaleEvent.deleteMany({ where: { locationId } });
  await db.posVariationMapping.deleteMany({ where: { locationId } });
  await db.recipeComponent.deleteMany({
    where: { recipe: { locationId } },
  });
  await db.recipe.deleteMany({ where: { locationId } });
  await db.menuItemVariant.deleteMany({
    where: { menuItem: { locationId } },
  });
  await db.menuItem.deleteMany({ where: { locationId } });
  await db.posCatalogVariation.deleteMany({
    where: { catalogItem: { integration: { locationId } } },
  });
  await db.posCatalogItem.deleteMany({
    where: { integration: { locationId } },
  });
  await db.posSyncRun.deleteMany({
    where: { integration: { locationId } },
  });
  await db.jobRun.deleteMany({ where: { locationId } });
  await db.auditLog.deleteMany({ where: { locationId } });
  await db.posIntegration.deleteMany({ where: { locationId } });
  await db.inventoryItem.deleteMany({ where: { locationId } });
}

async function main() {
  const user = await db.user.findUnique({
    where: { email: TEST_EMAIL },
    select: {
      id: true,
      roles: {
        select: {
          location: { select: { id: true, businessId: true } },
        },
      },
    },
  });
  if (!user || user.roles.length === 0) {
    console.error(`❌ No test account found for ${TEST_EMAIL}. Run signup first.`);
    process.exit(1);
  }
  const businessId = user.roles[0].location.businessId;

  let testLocation = await db.location.findFirst({
    where: { businessId, name: TEST_LOCATION_NAME },
  });
  if (testLocation) {
    console.log(`🧹 Wiping previous test location ${testLocation.id}…`);
    await wipeTestLocation(testLocation.id);
  } else {
    testLocation = await db.location.create({
      data: {
        businessId,
        name: TEST_LOCATION_NAME,
        timezone: "America/Los_Angeles",
        isPrimary: false,
      },
    });
    console.log(`📍 Created test location ${testLocation.id}`);
  }
  const locationId = testLocation.id;

  // ── Inventory (covers the SKUs the fake-AI recipe suggestions
  //    reference in src/modules/recipes/suggestions.ts) ────────
  console.log("📦 Seeding inventory for fake catalog recipes…");
  const items: Array<{
    sku: string;
    name: string;
    category:
      | "COFFEE"
      | "DAIRY"
      | "ALT_DAIRY"
      | "SYRUP"
      | "PACKAGING"
      | "RETAIL";
    baseUnit: "GRAM" | "MILLILITER" | "COUNT";
    unit: "GRAM" | "MILLILITER" | "COUNT";
    stockOnHandBase: number;
  }> = [
    { sku: "INV-CUP-HOT-16", name: "Hot Cup 16oz", category: "PACKAGING", baseUnit: "COUNT", unit: "COUNT", stockOnHandBase: 500 },
    { sku: "INV-LID-HOT-16", name: "Hot Cup Lid 16oz", category: "PACKAGING", baseUnit: "COUNT", unit: "COUNT", stockOnHandBase: 500 },
    { sku: "INV-SLEEVE-01", name: "Cup Sleeve", category: "PACKAGING", baseUnit: "COUNT", unit: "COUNT", stockOnHandBase: 500 },
    { sku: "INV-BEANS-ESP", name: "Espresso Beans", category: "COFFEE", baseUnit: "GRAM", unit: "GRAM", stockOnHandBase: 5000 },
    { sku: "INV-MILK-DAIRY", name: "Whole Milk", category: "DAIRY", baseUnit: "MILLILITER", unit: "MILLILITER", stockOnHandBase: 10000 },
    { sku: "INV-OAT-01", name: "Oat Milk", category: "ALT_DAIRY", baseUnit: "MILLILITER", unit: "MILLILITER", stockOnHandBase: 5000 },
    { sku: "INV-SYR-VAN", name: "Vanilla Syrup", category: "SYRUP", baseUnit: "MILLILITER", unit: "MILLILITER", stockOnHandBase: 2000 },
    { sku: "INV-MATCHA-01", name: "Matcha Powder", category: "RETAIL", baseUnit: "GRAM", unit: "GRAM", stockOnHandBase: 500 },
    { sku: "INV-CHOC-01", name: "Chocolate Sauce", category: "RETAIL", baseUnit: "MILLILITER", unit: "MILLILITER", stockOnHandBase: 2000 },
  ];
  for (const item of items) {
    await db.inventoryItem.create({
      data: {
        locationId,
        name: item.name,
        sku: item.sku,
        category: item.category,
        baseUnit: item.baseUnit,
        countUnit: item.unit,
        displayUnit: item.unit,
        purchaseUnit: item.unit,
        stockOnHandBase: item.stockOnHandBase,
        parLevelBase: Math.max(1, Math.floor(item.stockOnHandBase / 2)),
        lowStockThresholdBase: Math.max(1, Math.floor(item.stockOnHandBase / 5)),
        safetyStockBase: Math.max(1, Math.floor(item.stockOnHandBase / 10)),
        packSizeBase: 1,
      },
    });
  }

  // ── PosIntegration (already CONNECTED — fake provider needs
  //    no OAuth) ─────────────────────────────────────────────
  const integration = await db.posIntegration.create({
    data: {
      locationId,
      provider: "SQUARE",
      status: "CONNECTED",
      sandbox: true,
      externalMerchantId: "test-merchant",
      externalLocationId: "test-location",
    },
  });
  console.log(`🟩 Created PosIntegration ${integration.id}`);

  // ── Sync catalog (FakeSquare returns the fixtures) ─────────
  const { syncCatalog, importSampleSales } = await import(
    "../src/modules/pos/service.ts"
  );
  console.log("🔄 Syncing fake Square catalog…");
  await syncCatalog(integration.id);

  // ── Assertions on recipe + mapping state ─────────────────
  const approvedRecipes = await db.recipe.count({
    where: { locationId, status: "APPROVED" },
  });
  const draftRecipes = await db.recipe.count({
    where: { locationId, status: "DRAFT" },
  });
  const readyMappings = await db.posVariationMapping.count({
    where: { locationId, mappingStatus: "READY" },
  });
  const draftMappings = await db.posVariationMapping.count({
    where: { locationId, mappingStatus: "RECIPE_DRAFT" },
  });
  console.log(
    `   recipes: ${approvedRecipes} approved, ${draftRecipes} draft`
  );
  console.log(
    `   mappings: ${readyMappings} READY, ${draftMappings} RECIPE_DRAFT`
  );
  assert(
    approvedRecipes > 0,
    "Expected at least one recipe to be auto-approved. Auto-approve threshold may be broken."
  );
  assert(
    readyMappings > 0,
    "Expected at least one mapping to be READY so sales can deplete."
  );

  // ── Import sample sales → calls processSaleEventById ─────
  console.log("🧾 Importing fake Square orders…");
  await importSampleSales(integration.id);

  // Debug: what's in the sale tables?
  const saleEvents = await db.posSaleEvent.count({ where: { locationId } });
  const saleLines = await db.posSaleLine.count({
    where: { saleEvent: { locationId } },
  });
  const processedEvents = await db.posSaleEvent.count({
    where: { locationId, processingStatus: "PROCESSED" },
  });
  const alerts = await db.alert.count({
    where: { locationId, type: "RECIPE_GAP" },
  });
  const recipesWithNoComponents = await db.recipe.count({
    where: { locationId, components: { none: {} } },
  });
  console.log(
    `   sale events: ${saleEvents} (${processedEvents} processed); lines: ${saleLines}; recipe_gap alerts: ${alerts}`
  );
  console.log(`   recipes with 0 components: ${recipesWithNoComponents}`);

  const depletions = await db.stockMovement.findMany({
    where: { locationId, movementType: "POS_DEPLETION" },
    select: {
      inventoryItem: { select: { sku: true, name: true } },
      quantityDeltaBase: true,
    },
  });

  console.log(`\n📉 POS_DEPLETION movements posted: ${depletions.length}`);
  if (depletions.length === 0) {
    throw new Error(
      "NO POS_DEPLETION movements were posted. The sale-event pipeline is broken — mappings probably aren't READY."
    );
  }
  for (const m of depletions.slice(0, 6)) {
    console.log(
      `   ${m.inventoryItem.sku.padEnd(18)} ${m.quantityDeltaBase.toString().padStart(8)}`
    );
  }

  // ── Audit log check: auto-approved recipes leave a marker ─
  const aiApprovedLogs = await db.auditLog.count({
    where: { locationId, action: "recipe.ai_auto_approved" },
  });
  console.log(`\n📝 recipe.ai_auto_approved audit rows: ${aiApprovedLogs}`);
  assert(
    aiApprovedLogs > 0,
    "Expected ai_auto_approved audit entries to track what AI decided without human review."
  );

  console.log(
    "\n🎉 PASS: Square → catalog → sale → POS_DEPLETION pipeline works on day 1."
  );
}

main()
  .catch((err) => {
    console.error("❌ test-pos-auto-deplete failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
