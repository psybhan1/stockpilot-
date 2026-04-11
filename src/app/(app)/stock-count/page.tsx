import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ScanSearch, Sparkles } from "lucide-react";

import { submitCountAction } from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border-border/60 bg-[linear-gradient(135deg,rgba(254,249,195,0.45),rgba(255,255,255,0.92))] shadow-xl shadow-black/5 dark:bg-[linear-gradient(135deg,rgba(120,53,15,0.18),rgba(28,25,23,0.92))]">
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-medium uppercase tracking-[0.22em] text-amber-600 dark:text-amber-300">
                Count
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                Count inventory with the least possible friction.
              </h1>
              <p className="mt-3 text-base text-muted-foreground sm:text-lg">
                Use swipe mode when you want one-tap speed, or save counts from the list below
                when you need to be a little more deliberate.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-3 text-sm">
                Session:{" "}
                <span className="font-semibold">
                  {openSession ? openSession.mode.toLowerCase() : "not started"}
                </span>
              </div>
              <Link href="/stock-count/swipe" className={buttonVariants({ className: "h-11 rounded-2xl" })}>
                Open swipe mode
              </Link>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <QuickTip
              icon={ScanSearch}
              title="Work top to bottom"
              description="The list is already sorted so the riskiest items show first."
            />
            <QuickTip
              icon={Sparkles}
              title="Confirm fast"
              description="If the expected amount looks right, you can save it without extra typing."
            />
            <QuickTip
              icon={ArrowRight}
              title="Keep moving"
              description="Add a short note only when it helps the next person understand the change."
            />
          </div>
        </CardContent>
      </Card>

      {session.role !== Role.STAFF ? (
        <Card className="rounded-[28px] border-border/60 bg-card/88 shadow-lg shadow-black/5">
          <CardContent className="p-5">
            <div className="mb-4">
              <h2 className="text-xl font-semibold tracking-tight">Table mode</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Managers and supervisors can work a faster row-by-row review here, then drop into swipe mode if they want card-based counting.
              </p>
            </div>

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
                    <TableCell className="align-top">
                      <div>
                        <p className="font-medium">{item.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{item.sku}</p>
                      </div>
                    </TableCell>
                    <TableCell>{formatQuantityBase(item.stockOnHandBase, item.displayUnit, item.packSizeBase)}</TableCell>
                    <TableCell>{formatRelativeDays(item.snapshot?.daysLeft)}</TableCell>
                    <TableCell>{item.primarySupplier?.name ?? "Unassigned"}</TableCell>
                    <TableCell>
                      <form action={submitCountAction} className="flex min-w-[360px] items-center gap-2">
                        <input type="hidden" name="inventoryItemId" value={item.id} />
                        <Input
                          name="countedBase"
                          type="number"
                          defaultValue={item.stockOnHandBase}
                          className="h-9 min-w-[110px] rounded-xl"
                        />
                        <Input
                          name="notes"
                          placeholder="Optional note"
                          className="h-9 min-w-[150px] rounded-xl"
                        />
                        <Button type="submit" size="sm" className="rounded-xl">
                          Save
                        </Button>
                      </form>
                    </TableCell>
                    <TableCell className="text-right">
                      <form action={submitCountAction}>
                        <input type="hidden" name="inventoryItemId" value={item.id} />
                        <input type="hidden" name="countedBase" value={item.stockOnHandBase} />
                        <input type="hidden" name="notes" value="Confirmed from table mode" />
                        <Button type="submit" size="sm" variant="outline" className="rounded-xl">
                          Looks right
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4">
        {priorityItems.map((item) => (
          <Card key={item.id} className="overflow-hidden rounded-[28px] border-border/60 bg-card/88 shadow-lg shadow-black/5">
            <CardContent className="p-5">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 gap-4">
                  <div className="relative size-20 shrink-0 overflow-hidden rounded-[22px] border border-border/60 bg-muted">
                    {item.imageUrl ? (
                      <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-lg font-semibold text-muted-foreground">
                        {item.name.charAt(0)}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-semibold">{item.name}</h2>
                      <StatusBadge
                        label={
                          item.snapshot?.urgency === "CRITICAL"
                            ? "Urgent"
                            : item.snapshot?.urgency === "WARNING"
                              ? "Watch"
                              : "Good"
                        }
                        tone={
                          item.snapshot?.urgency === "CRITICAL"
                            ? "critical"
                            : item.snapshot?.urgency === "WARNING"
                              ? "warning"
                              : "success"
                        }
                      />
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <DetailPill
                        label="Expected"
                        value={formatQuantityBase(
                          item.stockOnHandBase,
                          item.displayUnit,
                          item.packSizeBase
                        )}
                      />
                      <DetailPill
                        label="Days left"
                        value={formatRelativeDays(item.snapshot?.daysLeft)}
                      />
                      <DetailPill
                        label="Supplier"
                        value={item.primarySupplier?.name ?? "Unassigned"}
                      />
                    </div>
                  </div>
                </div>

                <form action={submitCountAction} className="grid w-full gap-3 lg:max-w-xl lg:grid-cols-[120px_minmax(0,1fr)_auto]">
                  <input type="hidden" name="inventoryItemId" value={item.id} />
                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Counted now
                    </label>
                    <Input
                      name="countedBase"
                      type="number"
                      defaultValue={item.stockOnHandBase}
                      className="h-11 rounded-2xl"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Note
                    </label>
                    <Input
                      name="notes"
                      placeholder="Optional note"
                      className="h-11 rounded-2xl"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button type="submit" className="h-11 w-full rounded-2xl lg:w-auto">
                      Save count
                    </Button>
                  </div>
                </form>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <form action={submitCountAction}>
                  <input type="hidden" name="inventoryItemId" value={item.id} />
                  <input type="hidden" name="countedBase" value={item.stockOnHandBase} />
                  <input
                    type="hidden"
                    name="notes"
                    value="Confirmed expected stock from list mode"
                  />
                  <Button type="submit" size="sm" variant="outline" className="rounded-full">
                    Looks right
                  </Button>
                </form>

                <Link
                  href="/stock-count/swipe"
                  className={buttonVariants({
                    variant: "ghost",
                    size: "sm",
                    className: "rounded-full",
                  })}
                >
                  Do this in swipe mode
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function QuickTip({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof ScanSearch;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[24px] border border-border/60 bg-background/82 p-4 shadow-lg shadow-black/5">
      <Icon className="size-5 text-amber-600 dark:text-amber-300" />
      <p className="mt-4 font-semibold">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function DetailPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/80 px-3 py-3">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}
