import Image from "next/image";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

import { submitCountAction } from "@/app/actions/operations";
import { PageHero } from "@/components/app/page-hero";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Role } from "@/lib/domain-enums";
import { formatRelativeDays } from "@/lib/format";
import { requireSession } from "@/modules/auth/session";
import { getStockCountPageData } from "@/modules/dashboard/queries";
import { formatQuantityBase } from "@/modules/inventory/units";

export default async function StockCountPage() {
  const session = await requireSession(Role.STAFF);
  const { items, openSession } = await getStockCountPageData(session.locationId);
  const priorityItems = items.slice(0, 8);

  return (
    <div className="space-y-10">
      <PageHero
        eyebrow="Count"
        title="Stock count"
        subtitle="riskiest items, first."
        description="Confirm inventory levels. Riskiest items are shown first."
        action={
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-border/50 bg-background/50 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Session · {openSession ? openSession.mode.toLowerCase() : "not started"}
            </span>
            <Link
              href="/stock-count/swipe"
              className={buttonVariants({ size: "sm", className: "h-8 rounded-full text-xs" })}
            >
              Swipe mode
            </Link>
          </div>
        }
      />

      {/* Table mode (managers/supervisors) */}
      {session.role !== Role.STAFF && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Table mode</h2>
            <p className="text-sm text-muted-foreground">Quick row-by-row counting</p>
          </div>

          <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Days left</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Quick count</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.slice(0, 12).map((item) => (
                  <TableRow key={`table-${item.id}`}>
                    <TableCell>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.sku}</p>
                    </TableCell>
                    <TableCell className="text-sm">{formatQuantityBase(item.stockOnHandBase, item.displayUnit, item.packSizeBase)}</TableCell>
                    <TableCell className="text-sm">{formatRelativeDays(item.snapshot?.daysLeft)}</TableCell>
                    <TableCell className="text-sm">{item.primarySupplier?.name ?? "Unassigned"}</TableCell>
                    <TableCell>
                      <form action={submitCountAction} className="flex items-center gap-2">
                        <input type="hidden" name="inventoryItemId" value={item.id} />
                        <Input name="countedBase" type="number" defaultValue={item.stockOnHandBase} className="h-8 w-20 text-sm" />
                        <Input name="notes" placeholder="Note" className="h-8 w-28 text-sm" />
                        <Button type="submit" size="sm" className="h-8 text-xs">Save</Button>
                      </form>
                    </TableCell>
                    <TableCell className="text-right">
                      <form action={submitCountAction}>
                        <input type="hidden" name="inventoryItemId" value={item.id} />
                        <input type="hidden" name="countedBase" value={item.stockOnHandBase} />
                        <input type="hidden" name="notes" value="Confirmed from table mode" />
                        <Button type="submit" size="sm" variant="outline" className="h-8 text-xs">
                          Looks right
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {/* Card mode (priority items) */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Priority items</h2>
          <p className="text-sm text-muted-foreground">Items most likely to need a count</p>
        </div>

        <div className="space-y-3">
          {priorityItems.map((item) => (
            <div key={item.id} className="rounded-xl border border-border/50 bg-card p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="relative size-12 shrink-0 overflow-hidden rounded-lg border border-border/50 bg-muted">
                    {item.imageUrl ? (
                      <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-semibold text-muted-foreground">
                        {item.name.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <StatusBadge
                        label={item.snapshot?.urgency === "CRITICAL" ? "Urgent" : item.snapshot?.urgency === "WARNING" ? "Watch" : "Good"}
                        tone={item.snapshot?.urgency === "CRITICAL" ? "critical" : item.snapshot?.urgency === "WARNING" ? "warning" : "success"}
                      />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>Expected: {formatQuantityBase(item.stockOnHandBase, item.displayUnit, item.packSizeBase)}</span>
                      <span>{formatRelativeDays(item.snapshot?.daysLeft)} left</span>
                      <span>{item.primarySupplier?.name ?? "Unassigned"}</span>
                    </div>
                  </div>
                </div>

                <form action={submitCountAction} className="flex items-end gap-2 shrink-0">
                  <input type="hidden" name="inventoryItemId" value={item.id} />
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Count</label>
                    <Input name="countedBase" type="number" defaultValue={item.stockOnHandBase} className="h-9 w-24 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Note</label>
                    <Input name="notes" placeholder="Optional" className="h-9 w-32 text-sm" />
                  </div>
                  <Button type="submit" size="sm" className="h-9 text-xs">Save</Button>
                </form>
              </div>

              <div className="mt-3 flex gap-2">
                <form action={submitCountAction}>
                  <input type="hidden" name="inventoryItemId" value={item.id} />
                  <input type="hidden" name="countedBase" value={item.stockOnHandBase} />
                  <input type="hidden" name="notes" value="Confirmed expected stock from list mode" />
                  <Button type="submit" size="sm" variant="outline" className="h-7 text-xs">
                    Looks right
                  </Button>
                </form>
                <Link
                  href="/stock-count/swipe"
                  className={buttonVariants({ variant: "ghost", size: "sm", className: "h-7 text-xs" })}
                >
                  Swipe mode
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
