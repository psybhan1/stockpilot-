"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitMerge } from "lucide-react";

import { mergeInventoryDuplicatesAction } from "@/app/actions/inventory-duplicates";
import { Button } from "@/components/ui/button";

export type InventoryDuplicateGroupRow = {
  canonicalName: string;
  items: Array<{
    id: string;
    sku: string;
    stockOnHandBase: number;
    primarySupplierName: string | null;
    hasImage: boolean;
  }>;
};

export function InventoryDuplicatesCard({
  groups,
}: {
  groups: InventoryDuplicateGroupRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (groups.length === 0) return null;

  function mergeGroup(group: InventoryDuplicateGroupRow) {
    const [canonical, ...duplicates] = group.items;
    if (!canonical || duplicates.length === 0) return;
    startTransition(async () => {
      await mergeInventoryDuplicatesAction({
        canonicalId: canonical.id,
        duplicateIds: duplicates.map((d) => d.id),
      });
      router.refresh();
    });
  }

  const totalDupItems = groups.reduce((acc, g) => acc + g.items.length - 1, 0);

  return (
    <section className="notif-card p-5 sm:p-6 space-y-3">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Duplicate inventory items
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Bulk imports or parsed invoices created {totalDupItems} duplicate
          row{totalDupItems === 1 ? "" : "s"} across {groups.length} item
          {groups.length === 1 ? "" : "s"}. Merge keeps the row with the most
          stock (or oldest) and re-points every movement, recipe, and PO to
          the canonical row. Safe to click — all FKs update in one transaction.
        </p>
      </div>
      <ul className="space-y-2">
        {groups.map((g) => (
          <li
            key={g.canonicalName}
            className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {g.canonicalName}
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {g.items.length} copies
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Supplier: {g.items[0]?.primarySupplierName ?? "none"} · stocks:{" "}
                  {g.items.map((i) => i.stockOnHandBase).join(" / ")}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => mergeGroup(g)}
                disabled={isPending}
                className="h-7 gap-1 bg-amber-500 text-white hover:bg-amber-500/90 text-[11px]"
              >
                <GitMerge className="size-3" />
                Merge {g.items.length - 1} into 1
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
