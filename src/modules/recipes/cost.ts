/**
 * Per-recipe cost math. Each InventoryItem has a preferred SupplierItem
 * carrying `lastUnitCostCents` (cost for one purchase pack) and
 * `packSizeBase` (how many base-units are in that pack). Cost per
 * base-unit is cost-per-pack / pack-size. Component cost = qty × rate.
 *
 * Returns cents so the caller can render whichever locale/currency.
 */

export type RecipeCostRow = {
  componentId: string;
  inventoryItemName: string;
  quantityBase: number;
  displayUnit: string;
  costPerUnitCents: number | null;
  componentCostCents: number | null;
  missingCost: boolean;
};

export type RecipeCostSummary = {
  rows: RecipeCostRow[];
  totalCostCents: number;
  missingCostCount: number;
};

export function computeRecipeCost(components: Array<{
  id: string;
  quantityBase: number;
  displayUnit: string;
  inventoryItem: {
    name: string;
    supplierItems: Array<{
      lastUnitCostCents: number | null;
      packSizeBase: number;
    }>;
  };
}>): RecipeCostSummary {
  const rows: RecipeCostRow[] = [];
  let total = 0;
  let missing = 0;

  for (const c of components) {
    const sup = c.inventoryItem.supplierItems[0];
    const costPerUnit =
      sup?.lastUnitCostCents && sup.packSizeBase > 0
        ? sup.lastUnitCostCents / sup.packSizeBase
        : null;
    const componentCost =
      costPerUnit !== null ? Math.round(costPerUnit * c.quantityBase) : null;
    if (componentCost === null) missing += 1;
    else total += componentCost;
    rows.push({
      componentId: c.id,
      inventoryItemName: c.inventoryItem.name,
      quantityBase: c.quantityBase,
      displayUnit: c.displayUnit,
      costPerUnitCents: costPerUnit,
      componentCostCents: componentCost,
      missingCost: componentCost === null,
    });
  }

  return {
    rows,
    totalCostCents: total,
    missingCostCount: missing,
  };
}

export function formatCents(cents: number | null): string {
  if (cents === null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}
