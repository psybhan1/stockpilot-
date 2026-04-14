import Link from "next/link";
import {
  ArrowUpRight,
  ClipboardCheck,
  Package,
  RefreshCcw,
  ShoppingCart,
  Store,
} from "lucide-react";

import { connectSquareAction, runJobsAction, syncSalesAction } from "@/app/actions/operations";
import { PageHero } from "@/components/app/page-hero";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Role } from "@/lib/domain-enums";
import { formatRelativeDays } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireSession } from "@/modules/auth/session";
import { getDashboardData } from "@/modules/dashboard/queries";
import { formatQuantityBase } from "@/modules/inventory/units";

const quickActions = [
  { href: "/stock-count", icon: ClipboardCheck, title: "Count stock", desc: "Confirm uncertain items" },
  { href: "/inventory", icon: Package, title: "Inventory", desc: "Search and review items" },
  { href: "/purchase-orders", icon: ShoppingCart, title: "Orders", desc: "Review supplier actions" },
] as const;

export default async function DashboardPage() {
  const session = await requireSession(Role.SUPERVISOR);
  const data = await getDashboardData(session.locationId);
  const firstName = session.userName.split(" ")[0];

  return (
    <div className="space-y-10">
      <PageHero
        eyebrow={`Dashboard · ${session.locationName}`}
        title={`Hello, ${firstName}`}
        description="Here's what needs your attention today."
        stats={[
          { label: "Items", value: data.metrics.inventoryCount },
          {
            label: "Running low",
            value: data.metrics.lowStockCount,
            highlight: data.metrics.lowStockCount > 0,
          },
          {
            label: "Urgent",
            value: data.metrics.criticalCount,
            highlight: data.metrics.criticalCount > 0,
          },
          {
            label: "Pending review",
            value: data.metrics.pendingRecommendations + data.metrics.pendingRecipes,
          },
        ]}
      />

      {/* Quick actions */}
      <section>
        <SectionLabel>Quick actions</SectionLabel>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {quickActions.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="group flex items-center gap-4 rounded-md border border-border bg-card p-4 transition-colors hover:border-foreground/30"
            >
              <div className="flex size-10 items-center justify-center rounded-md bg-muted">
                <a.icon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{a.title}</p>
                <p className="truncate text-xs text-muted-foreground">{a.desc}</p>
              </div>
              <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Link>
          ))}
        </div>
      </section>

      {/* Alerts + Watch list */}
      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <SectionLabel>Alerts</SectionLabel>
          <p className="mt-1 text-xs text-muted-foreground">Issues requiring attention now</p>
          <div className="mt-4 space-y-2">
            {data.alerts.length ? (
              data.alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-border bg-card p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{alert.title}</p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                      {alert.message}
                    </p>
                  </div>
                  <StatusBadge
                    label={
                      alert.severity === "CRITICAL"
                        ? "Urgent"
                        : alert.severity === "WARNING"
                        ? "Watch"
                        : "Info"
                    }
                    tone={
                      alert.severity === "CRITICAL"
                        ? "critical"
                        : alert.severity === "WARNING"
                        ? "warning"
                        : "info"
                    }
                  />
                </div>
              ))
            ) : (
              <EmptyCard text="All clear — no active alerts" />
            )}
          </div>
        </section>

        <section>
          <SectionLabel>Watch list</SectionLabel>
          <p className="mt-1 text-xs text-muted-foreground">Items running low on stock</p>
          <div className="mt-4 space-y-2">
            {data.inventory.slice(0, 6).length ? (
              data.inventory.slice(0, 6).map((item) => (
                <Link
                  key={item.id}
                  href={`/inventory/${item.id}`}
                  className="group flex items-center justify-between gap-3 rounded-md border border-border bg-card p-4 transition-colors hover:border-foreground/30"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {formatQuantityBase(item.stockOnHandBase, item.displayUnit, item.packSizeBase)}
                      {" on hand"}
                      {item.snapshot?.daysLeft != null
                        ? ` · ${formatRelativeDays(item.snapshot.daysLeft)} left`
                        : ""}
                    </p>
                  </div>
                  <StatusBadge
                    label={
                      item.snapshot?.urgency === "CRITICAL"
                        ? "Urgent"
                        : item.snapshot?.urgency === "WARNING"
                        ? "Low"
                        : "OK"
                    }
                    tone={
                      item.snapshot?.urgency === "CRITICAL"
                        ? "critical"
                        : item.snapshot?.urgency === "WARNING"
                        ? "warning"
                        : "success"
                    }
                  />
                </Link>
              ))
            ) : (
              <EmptyCard text="All stocked — nothing needs your attention" />
            )}
          </div>
        </section>
      </div>

      {/* Pending orders */}
      {data.recommendations.length > 0 && (
        <section>
          <SectionLabel>Pending orders</SectionLabel>
          <p className="mt-1 text-xs text-muted-foreground">
            Recommendations waiting for your approval
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {data.recommendations.map((rec) => (
              <Link
                key={rec.id}
                href="/purchase-orders"
                className="group flex items-start justify-between gap-3 rounded-md border border-border bg-card p-4 transition-colors hover:border-foreground/30"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{rec.inventoryItem.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {rec.supplier.name}
                  </p>
                </div>
                <StatusBadge
                  label={
                    rec.urgency === "CRITICAL"
                      ? "Urgent"
                      : rec.urgency === "WARNING"
                      ? "Soon"
                      : "Planned"
                  }
                  tone={
                    rec.urgency === "CRITICAL"
                      ? "critical"
                      : rec.urgency === "WARNING"
                      ? "warning"
                      : "info"
                  }
                />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Manager actions */}
      {session.role === Role.MANAGER && (
        <section className="border-t border-border pt-8">
          <SectionLabel>Maintenance</SectionLabel>
          <div className="mt-4 flex flex-wrap gap-2">
            <form action={connectSquareAction}>
              <PillButton icon={Store} label="Connect Square" />
            </form>
            <form action={syncSalesAction}>
              <PillButton icon={ShoppingCart} label="Sync sales" />
            </form>
            <form action={runJobsAction}>
              <PillButton icon={RefreshCcw} label="Run jobs" />
            </form>
          </div>
        </section>
      )}
    </div>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2
      className={cn(
        "font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground",
        className
      )}
    >
      {children}
    </h2>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-border p-6 text-center">
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

function PillButton({ icon: Icon, label }: { icon: typeof Store; label: string }) {
  return (
    <Button type="submit" variant="outline" size="sm" className="h-8 rounded-full text-xs">
      <Icon className="mr-1.5 size-3.5" />
      {label}
    </Button>
  );
}
