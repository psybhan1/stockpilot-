import { Role } from "@/lib/domain-enums";

import { InventoryBrowser } from "@/components/app/inventory-browser";
import { formatRelativeDays } from "@/lib/format";
import { requireSession } from "@/modules/auth/session";
import { getInventoryList } from "@/modules/dashboard/queries";
import { formatQuantityBase } from "@/modules/inventory/units";

export default async function InventoryPage() {
  const session = await requireSession(Role.SUPERVISOR);
  const items = await getInventoryList(session.locationId);

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Inventory
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          {items.length} {items.length === 1 ? "item" : "items"} tracked
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Search, filter, and see stock levels at a glance. Ask StockBuddy to add
          anything new — images and defaults appear automatically.
        </p>
      </section>

      <InventoryBrowser
        items={items.map((item) => {
          const par = item.parLevelBase > 0 ? item.parLevelBase : 1;
          const stockPercent = Math.round((item.stockOnHandBase / par) * 100);
          return {
            id: item.id,
            name: item.name,
            imageUrl: item.imageUrl,
            categoryKey: item.category,
            categoryLabel: item.category.replaceAll("_", " ").toLowerCase(),
            onHandLabel: formatQuantityBase(
              item.stockOnHandBase,
              item.displayUnit,
              item.packSizeBase
            ),
            daysLeftLabel: formatRelativeDays(item.snapshot?.daysLeft),
            supplierName: item.primarySupplier?.name ?? "Unassigned",
            urgency: item.snapshot?.urgency ?? "INFO",
            stockPercent,
          };
        })}
      />
    </div>
  );
}
