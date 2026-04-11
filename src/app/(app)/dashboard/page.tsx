import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  ClipboardCheck,
  PackageCheck,
  RefreshCcw,
  ShoppingCart,
  Store,
} from "lucide-react";

import { connectSquareAction, runJobsAction, syncSalesAction } from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Role } from "@/lib/domain-enums";
import { formatRelativeDays } from "@/lib/format";
import { requireSession } from "@/modules/auth/session";
import { getDashboardData } from "@/modules/dashboard/queries";
import { formatQuantityBase } from "@/modules/inventory/units";

export default async function DashboardPage() {
  const session = await requireSession(Role.SUPERVISOR);
  const data = await getDashboardData(session.locationId);

  const firstName = session.userName.split(" ")[0];
  const metrics = [
    { label: "Items tracked", value: data.metrics.inventoryCount, tone: "neutral" as const },
    { label: "Running low", value: data.metrics.lowStockCount, tone: "warning" as const },
    { label: "Urgent today", value: data.metrics.criticalCount, tone: "critical" as const },
    {
      label: "Waiting for approval",
      value: data.metrics.pendingRecommendations + data.metrics.pendingRecipes,
      tone: "info" as const,
    },
  ];
  const quickActions = [
    {
      href: "/stock-count",
      title: "Count stock",
      description: "Confirm anything uncertain before service starts.",
      icon: ClipboardCheck,
    },
    {
      href: "/inventory",
      title: "Open inventory",
      description: "Search items, check days left, and review supplier info.",
      icon: PackageCheck,
    },
    {
      href: "/purchase-orders",
      title: "Review orders",
      description: "Approve, defer, or adjust supplier recommendations.",
      icon: BellRing,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-5 rounded-[30px] border border-border/60 bg-[linear-gradient(135deg,rgba(41,37,36,1),rgba(68,64,60,0.96))] p-6 text-white shadow-2xl shadow-black/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <p className="text-sm uppercase tracking-[0.24em] text-white/60">Home</p>
            <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Hi {firstName}, here&apos;s what needs attention before today gets busy.
            </h1>
            <p className="max-w-2xl text-white/70">
              StockPilot keeps the busy work simple for {session.locationName}: check urgent
              items, count anything uncertain, and review supplier work only when it&apos;s ready.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {session.role === Role.MANAGER ? (
              <>
                <form action={connectSquareAction}>
                  <Button type="submit" variant="secondary" className="h-10 rounded-2xl">
                    <Store data-icon="inline-start" />
                    Connect Square
                  </Button>
                </form>
                <form action={syncSalesAction}>
                  <Button type="submit" variant="secondary" className="h-10 rounded-2xl">
                    <ShoppingCart data-icon="inline-start" />
                    Sync sample sale
                  </Button>
                </form>
              </>
            ) : (
              <div className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white/70">
                Sync actions stay manager-only so the data stays controlled.
              </div>
            )}

            <form action={runJobsAction}>
              <Button
                type="submit"
                variant="outline"
                className="h-10 rounded-2xl border-white/20 bg-white/5 text-white hover:bg-white/10"
              >
                <RefreshCcw data-icon="inline-start" />
                Refresh background jobs
              </Button>
            </form>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-white/60">{metric.label}</p>
              <div className="mt-3 flex items-end justify-between">
                <p className="text-4xl font-semibold">{metric.value}</p>
                <StatusBadge label={metric.tone} tone={metric.tone} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {quickActions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="rounded-[28px] border border-border/60 bg-card/85 p-5 shadow-lg shadow-black/5 transition-all hover:-translate-y-0.5 hover:border-primary/30"
          >
            <action.icon className="size-5 text-amber-600 dark:text-amber-300" />
            <h2 className="mt-4 text-lg font-semibold">{action.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{action.description}</p>
            <div className="mt-4 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              Open
              <ArrowRight className="size-4" />
            </div>
          </Link>
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1.1fr_0.9fr]">
        <Card className="border-border/60 bg-card/85">
          <CardHeader className="pb-3">
            <CardTitle>What needs attention</CardTitle>
            <CardDescription>Start here if you only have a minute.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.alerts.length ? (
              data.alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="rounded-[24px] border border-border/60 bg-background/85 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{alert.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{alert.message}</p>
                    </div>
                    <StatusBadge
                      label={alert.severity}
                      tone={
                        alert.severity === "CRITICAL"
                          ? "critical"
                          : alert.severity === "WARNING"
                            ? "warning"
                            : "info"
                      }
                    />
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                title="No urgent alerts"
                description="Nothing is currently pushing the team off track."
              />
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/85">
          <CardHeader className="pb-3">
            <CardTitle>Inventory to watch</CardTitle>
            <CardDescription>Simple list of the tightest items right now.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.inventory.slice(0, 6).map((item) => (
              <Link
                key={item.id}
                href={`/inventory/${item.id}`}
                className="flex items-center justify-between gap-3 rounded-[24px] border border-border/60 bg-background/85 p-4 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatQuantityBase(item.stockOnHandBase, item.displayUnit, item.packSizeBase)}{" "}
                    on hand
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatRelativeDays(item.snapshot?.daysLeft)} left
                  </p>
                </div>
                <div className="text-right">
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
                  <p className="mt-3 text-xs text-muted-foreground">
                    {item.primarySupplier?.name ?? "No supplier"}
                  </p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="border-border/60 bg-card/85">
            <CardHeader className="pb-3">
              <CardTitle>Orders waiting</CardTitle>
              <CardDescription>Recommended supplier actions that still need review.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.recommendations.length ? (
                data.recommendations.map((recommendation) => (
                  <Link
                    key={recommendation.id}
                    href="/purchase-orders"
                    className="block rounded-[24px] border border-border/60 bg-background/85 p-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{recommendation.inventoryItem.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {recommendation.supplier.name}
                        </p>
                      </div>
                      <StatusBadge
                        label={recommendation.urgency}
                        tone={
                          recommendation.urgency === "CRITICAL"
                            ? "critical"
                            : recommendation.urgency === "WARNING"
                              ? "warning"
                              : "info"
                        }
                      />
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {recommendation.rationale}
                    </p>
                  </Link>
                ))
              ) : (
                <EmptyState
                  title="No approvals waiting"
                  description="Supplier recommendations will show up here when they are ready."
                />
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/85">
            <CardHeader className="pb-3">
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>What the system and team touched most recently.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.purchaseOrders.length ? (
                data.purchaseOrders.map((purchaseOrder) => (
                  <Link
                    key={purchaseOrder.id}
                    href={`/purchase-orders/${purchaseOrder.id}`}
                    className="flex items-center justify-between gap-3 rounded-[24px] border border-border/60 bg-background/85 p-4 transition-colors hover:bg-muted/40"
                  >
                    <div>
                      <p className="font-medium">{purchaseOrder.supplier.name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {purchaseOrder.lines.length} line
                        {purchaseOrder.lines.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <StatusBadge label={purchaseOrder.status} tone="info" />
                  </Link>
                ))
              ) : (
                <EmptyState
                  title="No recent orders"
                  description="Approved purchase orders will appear here."
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-border px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
