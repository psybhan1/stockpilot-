import { Role } from "@/lib/domain-enums";

import { InventoryBrowser } from "@/components/app/inventory-browser";
import { db } from "@/lib/db";
import { formatRelativeDays } from "@/lib/format";
import { requireSession } from "@/modules/auth/session";
import { getInventoryList } from "@/modules/dashboard/queries";
import { buildInventoryImageUrl } from "@/modules/inventory/image-resolver";
import { formatQuantityBase } from "@/modules/inventory/units";

export default async function InventoryPage() {
  const session = await requireSession(Role.SUPERVISOR);
  const items = await getInventoryList(session.locationId);

  // Lazy image backfill: any item without an imageUrl gets one generated now
  // and persisted, so every card in the UI has a real product image. A single
  // bulk updateMany would overwrite different URLs with the same value, so we
  // fire them in parallel per-item.
  //
  // We mutate the in-memory `items` array so the very first render already
  // shows the newly filled URLs — no extra round-trip needed.
  const missing = items.filter((item) => !item.imageUrl);
  if (missing.length > 0) {
    await Promise.all(
      missing.map(async (item) => {
        // Pull brand out of notes if we stashed it there ("Brand: Monin | ...").
        const brandMatch = item.notes?.match(/brand:\s*([^|]+)/i);
        const brand = brandMatch?.[1]?.trim() ?? null;

        const url = buildInventoryImageUrl({
          name: item.name,
          brand,
          category: item.category,
        });
        item.imageUrl = url;
        await db.inventoryItem.update({
          where: { id: item.id },
          data: { imageUrl: url },
        });
      })
    );
  }

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
