import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  Package,
  RefreshCcw,
  ShoppingCart,
  Store,
  TrendingDown,
} from "lucide-react";

import { connectSquareAction, runJobsAction, syncSalesAction } from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Role } from "@/lib/domain-enums";
import { formatRelativeDays } from "@/lib/format";
import { requireSession } from "@/modules/auth/session";
import { getDashboardData } from "@/modules/dashboard/queries";
import { formatQuantityBase } from "@/modules/inventory/units";

export default async function DashboardPage() {
  const session = await requireSession(Role.SUPERVISOR);
  const data = await getDashboardData(session.locationId);
  const firstName = session.userName.split(" ")[0];

  return (
    <div className="space-y-10">
      {/* ─── Hero ─── */}
      <section>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          {session.locationName}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Good morning, {firstName}
        </h1>
        <p className="mt-2 max-w-lg text-muted-foreground">
          Here&apos;s what needs attention today.
        </p>
      </section>

      {/* ─── Metrics ─── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Items tracked" value={data.metrics.inventoryCount} />
        <MetricCard
          label="Running low"
          value={data.metrics.lowStockCount}
          icon={TrendingDown}
          highlight={data.metrics.lowStockCount > 0 ? "warning" : undefined}
        />
        <MetricCard
          label="Urgent"
          value={data.metrics.criticalCount}
          icon={AlertTriangle}
          highlight={data.metrics.criticalCount > 0 ? "critical" : undefined}
        />
        <MetricCard
          label="Awaiting review"
          value={data.metrics.pendingRecommendations + data.metrics.pendingRecipes}
        />
      </section>

      {/* ─── Quick actions ─── */}
      <section className="grid gap-3 sm:grid-cols-3">
        <ActionCard
          href="/stock-count"
          icon={ClipboardCheck}
          title="Count stock"
          description="Confirm uncertain items"
        />
        <ActionCard
          href="/inventory"
          icon={Package}
          title="Inventory"
          description="Search and review items"
        />
        <ActionCard
          href="/purchase-orders"
          icon={ShoppingCart}
          title="Orders"
          description="Review supplier actions"
        />
      </section>

      {/* ─── Alerts + Inventory watchlist ─── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Alerts */}
        <section>
          <h2 className="text-lg font-semibold">Alerts</h2>
          <p className="mt-1 text-sm text-muted-foreground">Issues that need attention now</p>
          <div className="mt-4 space-y-2">
            {data.alerts.length ? (
              data.alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-border/50 bg-card p-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{alert.title}</p>
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{alert.message}</p>
                  </div>
                  <StatusBadge
                    label={alert.severity === "CRITICAL" ? "Urgent" : alert.severity === "WARNING" ? "Watch" : "Info"}
                    tone={alert.severity === "CRITICAL" ? "critical" : alert.severity === "WARNING" ? "warning" : "info"}
                  />
                </div>
              ))
            ) : (
              <EmptyState text="No active alerts" />
            )}
          </div>
        </section>

        {/* Watch list */}
        <section>
          <h2 className="text-lg font-semibold">Watch list</h2>
          <p className="mt-1 text-sm text-muted-foreground">Items running low</p>
          <div className="mt-4 space-y-2">
            {data.inventory.slice(0, 5).map((item) => (
              <Link
                key={item.id}
                href={`/inventory/${item.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-card p-4 transition-colors hover:bg-muted/30"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatQuantityBase(item.stockOnHandBase, item.displayUnit, item.packSizeBase)} on hand
                    {item.snapshot?.daysLeft != null ? ` \u00B7 ${formatRelativeDays(item.snapshot.daysLeft)} left` : ""}
                  </p>
                </div>
                <StatusBadge
                  label={item.snapshot?.urgency === "CRITICAL" ? "Urgent" : item.snapshot?.urgency === "WARNING" ? "Low" : "OK"}
                  tone={item.snapshot?.urgency === "CRITICAL" ? "critical" : item.snapshot?.urgency === "WARNING" ? "warning" : "success"}
                />
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* ─── Pending orders ─── */}
      {data.recommendations.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Pending orders</h2>
          <p className="mt-1 text-sm text-muted-foreground">Recommendations waiting for approval</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {data.recommendations.map((rec) => (
              <Link
                key={rec.id}
                href="/purchase-orders"
                className="flex items-start justify-between gap-3 rounded-xl border border-border/50 bg-card p-4 transition-colors hover:bg-muted/30"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{rec.inventoryItem.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{rec.supplier.name}</p>
                </div>
                <StatusBadge
                  label={rec.urgency === "CRITICAL" ? "Urgent" : rec.urgency === "WARNING" ? "Soon" : "Planned"}
                  tone={rec.urgency === "CRITICAL" ? "critical" : rec.urgency === "WARNING" ? "warning" : "info"}
                />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ─── Manager actions (small, bottom) ─── */}
      {session.role === Role.MANAGER && (
        <section className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-6">
          <form action={connectSquareAction}>
            <Button type="submit" variant="outline" size="sm" className="h-8 text-xs">
              <Store className="mr-1.5 size-3" />
              Connect Square
            </Button>
          </form>
          <form action={syncSalesAction}>
            <Button type="submit" variant="outline" size="sm" className="h-8 text-xs">
              <ShoppingCart className="mr-1.5 size-3" />
              Sync sale
            </Button>
          </form>
          <form action={runJobsAction}>
            <Button type="submit" variant="outline" size="sm" className="h-8 text-xs">
              <RefreshCcw className="mr-1.5 size-3" />
              Run jobs
            </Button>
          </form>
        </section>
      )}
    </div>
  );
}

/* ─── Small components ─── */

function MetricCard({
  label,
  value,
  icon: Icon,
  highlight,
}: {
  label: string;
  value: number;
  icon?: typeof AlertTriangle;
  highlight?: "warning" | "critical";
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <Icon
            className={`size-3.5 ${
              highlight === "critical"
                ? "text-red-500"
                : highlight === "warning"
                  ? "text-amber-500"
                  : "text-muted-foreground"
            }`}
          />
        )}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ActionCard({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: typeof ClipboardCheck;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-xl border border-border/50 bg-card p-4 transition-all hover:border-primary/30 hover:bg-muted/20"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="size-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/50 px-4 py-8 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
