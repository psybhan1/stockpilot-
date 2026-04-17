import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  MessageSquare,
  Package,
  PackageOpen,
  Receipt,
  ShoppingCart,
  Store,
  TrendingDown,
  Zap,
} from "lucide-react";

import { connectSquareAction, runJobsAction, syncSalesAction } from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Role } from "@/lib/domain-enums";
import { formatRelativeDays } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireSession } from "@/modules/auth/session";
import { getDashboardData } from "@/modules/dashboard/queries";
import { formatQuantityBase } from "@/modules/inventory/units";
import { getAnalyticsOverview } from "@/modules/analytics/queries";
import { getMarginDashboard } from "@/modules/recipes/margin-dashboard";
import { getVarianceReport } from "@/modules/variance/report";

/**
 * Today — the task-first landing.
 *
 * Design rule: the top of this page must answer one question only —
 * "what do I need to do right now?" — not "what's the state of the
 * business?". Stats come later, actions come first.
 */
export default async function TodayPage() {
  const session = await requireSession(Role.STAFF);
  const [data, analytics, margins, variance] = await Promise.all([
    getDashboardData(session.locationId),
    getAnalyticsOverview(session.locationId),
    // Margin + variance surface on the landing so managers see money
    // issues without having to know the page exists. Both are fast
    // single-query joins, so adding them to the dashboard load is ~
    // a few ms each. .catch to null keeps the dashboard resilient if
    // either query throws (e.g. a location with no recipes yet).
    getMarginDashboard(session.locationId).catch(() => []),
    getVarianceReport(session.locationId, { days: 7 }).catch(() => null),
  ]);
  const firstName = session.userName.split(" ")[0];
  const topSuppliers = analytics.topSuppliers.slice(0, 3);

  const pendingCount = data.recommendations.length;
  const criticalCount = data.metrics.criticalCount;
  const lowCount = data.metrics.lowStockCount;
  const openAlerts = data.alerts.length;
  const itemsTotal = data.metrics.inventoryCount;
  const marginReviewCount = margins.filter((m) => m.severity === "review").length;
  const shrinkageCents = variance?.shrinkageCents ?? 0;
  const topShrinkItem = variance?.rows.find(
    (r) => (r.shrinkageCents ?? 0) > 0
  );

  // Compose prioritised task list
  type Task = {
    kind:
      | "approve"
      | "critical"
      | "alert"
      | "count"
      | "watch"
      | "shrinkage"
      | "margin";
    title: string;
    hint: string;
    cta: string;
    href: string;
    tone: "urgent" | "warn" | "info";
    icon: typeof Zap;
  };
  const tasks: Task[] = [];

  if (session.role === Role.MANAGER && pendingCount > 0) {
    tasks.push({
      kind: "approve",
      title: `${pendingCount} order${pendingCount === 1 ? "" : "s"} waiting for your OK`,
      hint: "Review and approve so StockBuddy can send them to suppliers.",
      cta: "Review orders",
      href: "/purchase-orders",
      tone: "urgent",
      icon: Zap,
    });
  }

  if (criticalCount > 0) {
    tasks.push({
      kind: "critical",
      title: `${criticalCount} item${criticalCount === 1 ? "" : "s"} about to run out`,
      hint: "These will stock out before the next delivery unless we act.",
      cta: "See items",
      href: "/inventory",
      tone: "urgent",
      icon: TrendingDown,
    });
  }

  if (openAlerts > 0) {
    tasks.push({
      kind: "alert",
      title: `${openAlerts} alert${openAlerts === 1 ? "" : "s"} need${openAlerts === 1 ? "s" : ""} a look`,
      hint: "Sync issues, missing counts, or stock warnings.",
      cta: "Open alerts",
      href: "/alerts",
      tone: "warn",
      icon: MessageSquare,
    });
  }

  if (lowCount > criticalCount && lowCount > 0) {
    tasks.push({
      kind: "watch",
      title: `${lowCount - criticalCount} item${lowCount - criticalCount === 1 ? "" : "s"} getting low`,
      hint: "Not urgent yet, but worth a glance.",
      cta: "Watch list",
      href: "/inventory",
      tone: "info",
      icon: Package,
    });
  }

  // Shrinkage > $15 in last 7 days is the threshold where it's
  // worth opening the variance page — matches /variance's own
  // severity floors. Over $50 → urgent; anything else lives in the
  // "watch" pile.
  if (shrinkageCents >= 1500 && session.role !== Role.STAFF) {
    const dollars = (shrinkageCents / 100).toFixed(2);
    tasks.push({
      kind: "shrinkage",
      title: `$${dollars} in unexplained shrinkage this week`,
      hint: topShrinkItem
        ? `Biggest gap: ${topShrinkItem.itemName}. Drill in to see which movements drove it.`
        : "Look at the per-item breakdown to find the leak.",
      cta: "Open variance",
      href: "/variance",
      tone: shrinkageCents >= 5000 ? "urgent" : "warn",
      icon: TrendingDown,
    });
  }

  // Margin reviews: >= 1 variant under 60% margin is a real call
  // to re-price or swap ingredient sources. Managers only.
  if (marginReviewCount > 0 && session.role !== Role.STAFF) {
    tasks.push({
      kind: "margin",
      title: `${marginReviewCount} menu item${marginReviewCount === 1 ? "" : "s"} under 60% margin`,
      hint: "Either ingredient costs crept up or the sell price is too low. Both are fixable.",
      cta: "Review margins",
      href: "/margins",
      tone: marginReviewCount >= 5 ? "warn" : "info",
      icon: ShoppingCart,
    });
  }

  // Only show Count task if user is staff-role AND no higher-priority tasks
  if (tasks.length === 0 && itemsTotal > 0) {
    tasks.push({
      kind: "count",
      title: "Quick count",
      hint: "Keep the numbers honest. Takes 2 minutes.",
      cta: "Count now",
      href: "/stock-count",
      tone: "info",
      icon: ClipboardCheck,
    });
  }

  const allClear = tasks.length === 0;

  return (
    <div className="space-y-12">
      {/* ── Greeting ──────────────────────────────────────────────── */}
      <section>
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
          {" · "}
          <span>{session.locationName}</span>
        </p>
        <h1 className="mt-2 text-[clamp(2rem,5vw,3.5rem)] font-bold leading-[1.05] tracking-[-0.025em]">
          {greetingFor(new Date())}, {firstName}.
        </h1>
      </section>

      {/* ── What needs doing ──────────────────────────────────────── */}
      {allClear ? (
        <AllClearState firstItems={itemsTotal === 0} />
      ) : (
        <section className="space-y-3">
          <SectionLabel>What needs your attention</SectionLabel>
          <div className="space-y-3">
            {tasks.map((task) => (
              <Link
                key={task.kind}
                href={task.href}
                className={cn(
                  "notif-card group flex items-start gap-4 p-5",
                  task.tone === "urgent" && "notif-card-urgent"
                )}
              >
                <div
                  className={cn(
                    "flex size-11 shrink-0 items-center justify-center rounded-2xl",
                    task.tone === "urgent"
                      ? "bg-[var(--destructive)]/10 text-[var(--destructive)]"
                      : task.tone === "warn"
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      : "bg-foreground/[0.06] text-foreground/80"
                  )}
                >
                  <task.icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold leading-tight">{task.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{task.hint}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1 text-sm font-medium text-foreground/80 group-hover:text-foreground">
                  {task.cta}
                  <ArrowRight className="size-4" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Quick access ──────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionLabel>Jump to</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link href="/stock-count" className="notif-card group flex items-center gap-3 p-4">
            <div className="flex size-10 items-center justify-center rounded-xl bg-foreground/[0.06]">
              <ClipboardCheck className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Count stock</p>
              <p className="truncate text-xs text-muted-foreground">
                Confirm what's actually on the shelf
              </p>
            </div>
          </Link>
          <Link href="/inventory" className="notif-card group flex items-center gap-3 p-4">
            <div className="flex size-10 items-center justify-center rounded-xl bg-foreground/[0.06]">
              <PackageOpen className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Stock</p>
              <p className="truncate text-xs text-muted-foreground">
                {itemsTotal} item{itemsTotal === 1 ? "" : "s"} tracked
              </p>
            </div>
          </Link>
          <Link href="/purchase-orders" className="notif-card group flex items-center gap-3 p-4">
            <div className="flex size-10 items-center justify-center rounded-xl bg-foreground/[0.06]">
              <Receipt className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Orders</p>
              <p className="truncate text-xs text-muted-foreground">
                {pendingCount > 0 ? `${pendingCount} waiting approval` : "All caught up"}
              </p>
            </div>
          </Link>
        </div>
      </section>

      {/* ── Supplier pulse (only when there's 30d activity) ──────── */}
      {topSuppliers.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionLabel>Supplier pulse · last 30 days</SectionLabel>
            <Link
              href="/analytics"
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              See full analytics →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {topSuppliers.map((s) => {
              const pct = Math.round(s.confirmRate * 100);
              const toneClass =
                s.confirmRate >= 0.8
                  ? "bg-emerald-500"
                  : s.confirmRate >= 0.5
                  ? "bg-amber-500"
                  : "bg-red-500";
              const replyLabel =
                s.avgReplyHours == null
                  ? "—"
                  : s.avgReplyHours < 1
                  ? `${Math.round(s.avgReplyHours * 60)}m reply`
                  : `${s.avgReplyHours.toFixed(1)}h reply`;
              return (
                <div key={s.supplierId} className="notif-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{s.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {s.totalOrders} order{s.totalOrders === 1 ? "" : "s"} · {replyLabel}
                      </p>
                    </div>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {pct}%
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={"h-full rounded-full " + toneClass} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                    {s.confirmed} confirmed · {s.declined} declined · {s.pending} pending
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ── Watch list snapshot (only when you have data + things to watch) ── */}
      {data.inventory.length > 0 && criticalCount + lowCount > 0 && (
        <section className="space-y-3">
          <SectionLabel>Running low</SectionLabel>
          <div className="space-y-2">
            {data.inventory
              .filter((i) => i.snapshot?.urgency !== "INFO")
              .slice(0, 5)
              .map((item) => (
                <Link
                  key={item.id}
                  href={`/inventory/${item.id}`}
                  className={cn(
                    "notif-card flex items-center justify-between gap-3 p-4",
                    item.snapshot?.urgency === "CRITICAL" && "notif-card-urgent"
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{item.name}</p>
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
              ))}
          </div>
        </section>
      )}

      {/* ── Manager actions ───────────────────────────────────────── */}
      {session.role === Role.MANAGER && (
        <section className="space-y-3 border-t border-border pt-8">
          <SectionLabel>Maintenance</SectionLabel>
          <div className="flex flex-wrap gap-2">
            <form action={connectSquareAction}>
              <Button type="submit" variant="outline" size="sm" className="h-8 rounded-full text-xs">
                <Store className="mr-1.5 size-3.5" />
                Connect Square
              </Button>
            </form>
            <form action={syncSalesAction}>
              <Button type="submit" variant="outline" size="sm" className="h-8 rounded-full text-xs">
                <ShoppingCart className="mr-1.5 size-3.5" />
                Sync sales
              </Button>
            </form>
            <form action={runJobsAction}>
              <Button type="submit" variant="outline" size="sm" className="h-8 rounded-full text-xs">
                Run jobs
              </Button>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}

// ── Bits ────────────────────────────────────────────────────────────────

function greetingFor(d: Date) {
  const h = d.getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good night";
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

function AllClearState({ firstItems }: { firstItems: boolean }) {
  if (firstItems) {
    return (
      <section className="notif-card p-8 sm:p-12">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-foreground/[0.06]">
          <Package className="size-7" />
        </div>
        <h2 className="mt-6 text-2xl font-bold tracking-tight sm:text-3xl">
          Add your first item to get started
        </h2>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Tell StockBuddy what you sell, and it&apos;ll watch stock, flag low
          items, and draft reorders for your approval. You can text it on
          Telegram or WhatsApp — just say&nbsp;
          <span className="font-medium text-foreground">&ldquo;add oat milk&rdquo;</span> and it&apos;ll walk
          you through.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/settings"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background"
          >
            Connect the bot
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/inventory"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold"
          >
            Add items manually
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="notif-card p-8 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="size-7" />
      </div>
      <h2 className="mt-5 text-2xl font-bold tracking-tight">All clear</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Stock is healthy, no orders need approval, no active alerts.
        StockBuddy is watching — we&apos;ll ping you the moment something needs a decision.
      </p>
    </section>
  );
}
