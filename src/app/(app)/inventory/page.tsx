import { Role } from "@/lib/domain-enums";

import { InventoryBrowser } from "@/components/app/inventory-browser";
import { PageHero } from "@/components/app/page-hero";
import { db } from "@/lib/db";
import { formatRelativeDays } from "@/lib/format";
import { requireSession } from "@/modules/auth/session";
import { getInventoryList } from "@/modules/dashboard/queries";
import { buildInventoryImageUrl } from "@/modules/inventory/image-resolver";
import { formatQuantityBase } from "@/modules/inventory/units";

export default async function InventoryPage() {
  const session = await requireSession(Role.SUPERVISOR);
  const items = await getInventoryList(session.locationId);

  const missing = items.filter((item) => !item.imageUrl);
  if (missing.length > 0) {
    await Promise.all(
      missing.map(async (item) => {
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

  const totalItems = items.length;
  const criticalCount = items.filter((i) => i.snapshot?.urgency === "CRITICAL").length;
  const watchCount = items.filter((i) => i.snapshot?.urgency === "WARNING").length;
  const suppliersTracked = new Set(
    items.map((i) => i.primarySupplier?.id).filter(Boolean)
  ).size;

  return (
    <div className="space-y-10">
      <PageHero
        eyebrow={`Inventory · ${session.locationName}`}
        title="Inventory"
        description="Every item you track, with live stock levels, categories, and supplier links."
        stats={[
          { label: "Items", value: totalItems },
          { label: "Critical", value: criticalCount, highlight: criticalCount > 0 },
          { label: "Watch", value: watchCount },
          { label: "Suppliers", value: suppliersTracked },
        ]}
      />

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
