import { Role } from "@/lib/domain-enums";
import { StockSwipe } from "@/components/app/stock-swipe";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/modules/auth/session";
import { getStockCountPageData } from "@/modules/dashboard/queries";
import { formatRelativeDays } from "@/lib/format";
import { baseUnitLabel, formatQuantityBase } from "@/modules/inventory/units";

export default async function StockSwipePage() {
  const session = await requireSession(Role.STAFF);
  const { items } = await getStockCountPageData(session.locationId);

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-border/60 bg-card/88 shadow-lg shadow-black/5">
        <CardHeader>
          <CardTitle>Swipe count mode</CardTitle>
          <CardDescription>
            One item at a time, big buttons first, and no extra thinking unless something looks off.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}

