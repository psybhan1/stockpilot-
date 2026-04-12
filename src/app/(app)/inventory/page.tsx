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
    <div className="space-y-6">
      <section>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Inventory
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {items.length} items tracked
        </h1>
        <p className="mt-2 text-muted-foreground">
          Search, filter, and check stock levels across all categories.
        </p>
      </section>

      <InventoryBrowser
        items={items.map((item) => ({
          id: item.id,
          name: item.name,
          imageUrl: item.imageUrl,
          categoryLabel: item.category.replaceAll("_", " "),
          onHandLabel: formatQuantityBase(
            item.stockOnHandBase,
            item.displayUnit,
            item.packSizeBase
          ),
          daysLeftLabel: formatRelativeDays(item.snapshot?.daysLeft),
          supplierName: item.primarySupplier?.name ?? "Unassigned",
          urgency: item.snapshot?.urgency ?? "INFO",
        }))}
      />
    </div>
  );
}
