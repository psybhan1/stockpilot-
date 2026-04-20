import { Role } from "@/lib/domain-enums";
import { PageHero } from "@/components/app/page-hero";
import { StockSwipe } from "@/components/app/stock-swipe";
import { requireSession } from "@/modules/auth/session";
import { getStockCountPageData } from "@/modules/dashboard/queries";
import { formatRelativeDays } from "@/lib/format";
import { baseUnitLabel, formatQuantityBase } from "@/modules/inventory/units";

export default async function StockSwipePage() {
  const session = await requireSession(Role.STAFF);
  const { items } = await getStockCountPageData(session.locationId);

  return (
    <div className="space-y-10">
      <PageHero
        eyebrow="Count · Swipe mode"
        title="One at a time"
        description="One item, big actions, no extra thinking unless something looks off. Tap Looks right to confirm expected stock, or type a new count."
      />

      <div className="notif-card p-6">
        <StockSwipe
          items={items.slice(0, 8).map((item) => ({
            id: item.id,
            name: item.name,
            imageUrl: item.imageUrl,
            expectedBase: item.stockOnHandBase,
            lowStockBase: item.lowStockThresholdBase,
            unitLabel: baseUnitLabel(item.baseUnit),
            expectedLabel: formatQuantityBase(item.stockOnHandBase, item.displayUnit, item.packSizeBase),
            lastCountLabel:
              item.stockCountEntries[0]?.countedBase != null
                ? `${item.stockCountEntries[0].countedBase} ${baseUnitLabel(item.baseUnit)}`
                : "No recent count",
            supplierName: item.primarySupplier?.name ?? null,
            daysLeftLabel: formatRelativeDays(item.snapshot?.daysLeft),
          }))}
        />
      </div>
    </div>
  );
}
