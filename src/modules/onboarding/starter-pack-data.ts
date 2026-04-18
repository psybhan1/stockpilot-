/**
 * Pure starter-pack data + row-building math. Lives in its own file
 * so the unit tests don't transitively import Prisma. starter-pack.ts
 * is the thin wrapper that does the actual createMany inside a tx.
 */

export type StarterCategory =
  | "COFFEE"
  | "DAIRY"
  | "ALT_DAIRY"
  | "SYRUP"
  | "PACKAGING"
  | "CLEANING"
  | "PAPER_GOODS"
  | "RETAIL"
  | "SEASONAL"
  | "BAKERY_INGREDIENT";

export type StarterBaseUnit = "GRAM" | "MILLILITER" | "COUNT";

export type StarterItem = {
  sku: string;
  name: string;
  category: StarterCategory;
  baseUnit: StarterBaseUnit;
  parBase: number;
  lowBase: number;
  packBase: number;
};

// 16 items that cover ~90% of an espresso-forward café's daily use.
// Values chosen for a single-location indie café pulling roughly
// 80–100 drinks a day. Owner can tune these in 10 seconds from the
// inventory page; they're just a starting point, not a prescription.
export const ESPRESSO_BAR_STARTER: ReadonlyArray<StarterItem> = [
  { sku: "STARTER-MILK-WHOLE",   name: "Whole Milk",              category: "DAIRY",       baseUnit: "MILLILITER", parBase: 20000, lowBase: 5000,  packBase: 2000 },
  { sku: "STARTER-MILK-OAT",     name: "Oat Milk",                category: "ALT_DAIRY",   baseUnit: "MILLILITER", parBase: 10000, lowBase: 3000,  packBase: 1000 },
  { sku: "STARTER-MILK-ALMOND",  name: "Almond Milk",             category: "ALT_DAIRY",   baseUnit: "MILLILITER", parBase: 8000,  lowBase: 2000,  packBase: 1000 },
  { sku: "STARTER-BEANS-ESP",    name: "Espresso Beans",          category: "COFFEE",      baseUnit: "GRAM",       parBase: 5000,  lowBase: 1500,  packBase: 1000 },
  { sku: "STARTER-COFFEE-DRIP",  name: "Drip Coffee (ground)",    category: "COFFEE",      baseUnit: "GRAM",       parBase: 3000,  lowBase: 1000,  packBase: 1000 },
  { sku: "STARTER-SYR-VAN",      name: "Vanilla Syrup",           category: "SYRUP",       baseUnit: "MILLILITER", parBase: 2250,  lowBase: 750,   packBase: 750  },
  { sku: "STARTER-SYR-CARAMEL",  name: "Caramel Syrup",           category: "SYRUP",       baseUnit: "MILLILITER", parBase: 2250,  lowBase: 750,   packBase: 750  },
  { sku: "STARTER-CHOC-SAUCE",   name: "Chocolate Sauce",         category: "SYRUP",       baseUnit: "MILLILITER", parBase: 3000,  lowBase: 1000,  packBase: 1000 },
  { sku: "STARTER-CUP-12",       name: "Paper Cups 12oz",         category: "PACKAGING",   baseUnit: "COUNT",      parBase: 600,   lowBase: 200,   packBase: 50   },
  { sku: "STARTER-CUP-16",       name: "Paper Cups 16oz",         category: "PACKAGING",   baseUnit: "COUNT",      parBase: 600,   lowBase: 200,   packBase: 50   },
  { sku: "STARTER-LID-HOT",      name: "Hot Cup Lids",            category: "PACKAGING",   baseUnit: "COUNT",      parBase: 1000,  lowBase: 300,   packBase: 100  },
  { sku: "STARTER-SLEEVE",       name: "Cup Sleeves",             category: "PACKAGING",   baseUnit: "COUNT",      parBase: 500,   lowBase: 150,   packBase: 50   },
  { sku: "STARTER-NAPKIN",       name: "Napkins",                 category: "PAPER_GOODS", baseUnit: "COUNT",      parBase: 2000,  lowBase: 500,   packBase: 500  },
  { sku: "STARTER-STIRRER",      name: "Stirrers",                category: "PACKAGING",   baseUnit: "COUNT",      parBase: 3000,  lowBase: 1000,  packBase: 1000 },
  { sku: "STARTER-CLEAN-ESP",    name: "Espresso Machine Cleaner", category: "CLEANING",   baseUnit: "GRAM",       parBase: 500,   lowBase: 100,   packBase: 500  },
  { sku: "STARTER-SANITIZER",    name: "Sanitizer",               category: "CLEANING",    baseUnit: "MILLILITER", parBase: 3000,  lowBase: 1000,  packBase: 1000 },
];

export type StarterInventoryRow = {
  locationId: string;
  sku: string;
  name: string;
  category: StarterCategory;
  baseUnit: StarterBaseUnit;
  countUnit: StarterBaseUnit;
  displayUnit: StarterBaseUnit;
  purchaseUnit: StarterBaseUnit;
  stockOnHandBase: number;
  parLevelBase: number;
  lowStockThresholdBase: number;
  safetyStockBase: number;
  packSizeBase: number;
};

/**
 * Turn the starter pack into the row payloads we'd hand to
 * `inventoryItem.createMany`. Splitting this out from the DB call
 * lets the tests lock the math (safetyStock = max(1, floor(low/2)))
 * and the cross-row invariants (unique SKUs, low ≤ par) without a
 * Prisma client.
 *
 * `safetyStockBase` defaults to half the low-stock threshold so the
 * reorder engine has headroom; clamped to ≥1 so single-digit items
 * (e.g. an espresso machine cleaner pack) don't end up with a
 * safety stock of 0 (which would silently disable safety-stock math
 * downstream).
 */
export function buildStarterInventoryRows(
  locationId: string
): StarterInventoryRow[] {
  return ESPRESSO_BAR_STARTER.map((item) => ({
    locationId,
    sku: item.sku,
    name: item.name,
    category: item.category,
    baseUnit: item.baseUnit,
    countUnit: item.baseUnit,
    displayUnit: item.baseUnit,
    purchaseUnit: item.baseUnit,
    stockOnHandBase: 0,
    parLevelBase: item.parBase,
    lowStockThresholdBase: item.lowBase,
    safetyStockBase: Math.max(1, Math.floor(item.lowBase / 2)),
    packSizeBase: item.packBase,
  }));
}
