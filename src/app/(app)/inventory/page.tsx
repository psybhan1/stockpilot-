import { Role } from "@/lib/domain-enums";
import { Boxes, Search, ShieldCheck } from "lucide-react";

import { InventoryBrowser } from "@/components/app/inventory-browser";
import { Card, CardContent } from "@/components/ui/card";
import { formatRelativeDays } from "@/lib/format";
import { requireSession } from "@/modules/auth/session";
import { getInventoryList } from "@/modules/dashboard/queries";
import { formatQuantityBase } from "@/modules/inventory/units";

export default async function InventoryPage() {
  const session = await requireSession(Role.SUPERVISOR);
  const items = await getInventoryList(session.locationId);

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border-border/60 bg-[linear-gradient(135deg,rgba(255,251,235,0.95),rgba(255,255,255,0.9))] shadow-xl shadow-black/5 dark:bg-[linear-gradient(135deg,rgba(41,37,36,0.95),rgba(28,25,23,0.92))]">
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="max-w-3xl">
            <p className="text-sm font-medium uppercase tracking-[0.22em] text-amber-600 dark:text-amber-300">
              Inventory
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Find what you need fast, then fix only what looks off.
            </h1>
            <p className="mt-3 text-base text-muted-foreground sm:text-lg">
              This view is built for daily use: quick search, clear status, and one tap into each
              item when you need the full audit trail.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <TipCard
              icon={Search}
              title="Search first"
              description="Jump to any ingredient, packaging item, or supplier in seconds."
            />
            <TipCard
              icon={Boxes}
              title="See stock at a glance"
              description="Each card shows on-hand amount, days left, and supplier context."
            />
            <TipCard
              icon={ShieldCheck}
              title="Trust the numbers"
              description="Stock values are still coming from the ledger, not manual overwrites."
            />
          </div>
        </CardContent>
      </Card>

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

function TipCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Search;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[24px] border border-border/60 bg-background/85 p-4 shadow-lg shadow-black/5">
      <Icon className="size-5 text-amber-600 dark:text-amber-300" />
      <p className="mt-4 font-semibold">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

