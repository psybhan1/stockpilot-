import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  MessageSquare,
  Package,
  ShoppingCart,
  TrendingDown,
  Zap,
} from "lucide-react";

import { StatusBadge } from "@/components/app/status-badge";
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

      {/* ── Today's ONE thing ─────────────────────────────────────── */}
      {allClear ? (
        <AllClearState firstItems={itemsTotal === 0} />
      ) : (
        <section className="space-y-4">
          {/* Hero card for the single highest-priority task. Big,
              obvious, one tap away. Research directly driving this:
              managers don't want a dashboard, they want to know
              "what's the one thing I should do right now?" */}
          <Link
            href={tasks[0].href}
            className={cn(
              "notif-card group relative flex items-start gap-5 overflow-hidden p-6 sm:p-8",
              tasks[0].tone === "urgent" && "notif-card-urgent"
            )}
          >
            <div
              className={cn(
                "flex size-14 shrink-0 items-center justify-center rounded-2xl",
                tasks[0].tone === "urgent"
                  ? "bg-[var(--destructive)]/10 text-[var(--destructive)]"
                  : tasks[0].tone === "warn"
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    : "bg-foreground/[0.06] text-foreground/80"
              )}
            >
              {(() => {
                const Icon = tasks[0].icon;
                return <Icon className="size-7" />;
              })()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                One thing today
              </p>
              <p className="mt-1 text-xl font-semibold leading-tight sm:text-2xl">
                {tasks[0].title}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">{tasks[0].hint}</p>
            </div>
            <div className="hidden shrink-0 items-center gap-1 rounded-full border border-border/60 bg-background/50 px-3 py-1.5 text-xs font-semibold text-foreground/80 group-hover:text-foreground sm:flex">
              {tasks[0].cta}
              <ArrowRight className="size-3.5" />
            </div>
          </Link>

          {/* Remaining tasks compact — "also today" but visually
              subordinated so nothing screams for attention at once. */}
          {tasks.length > 1 && (
            <div className="space-y-2">
              <SectionLabel>Also today</SectionLabel>
              {tasks.slice(1).map((task) => (
                <Link
                  key={task.kind}
                  href={task.href}
                  className="notif-card group flex items-center gap-3 px-4 py-3"
                >
                  <task.icon className="size-4 shrink-0 text-muted-foreground" />
                  <p className="min-w-0 flex-1 truncate text-sm">{task.title}</p>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Jump-to cards and Supplier-pulse section used to live here.
          Both removed for the "one page, one question" rewrite — the
          top nav already exposes Stock/Orders/Count, and supplier
          pulse is analytics (lives at /analytics). Keeps the
          dashboard honest: today's actions first, nothing else. */}

      {/* ── Watch list snapshot (only when you have data + things to watch) ── */}
      {data.inventory.length > 0 && criticalCount + lowCount > 0 && (
        <section className="space-y-3">
          <SectionLabel>Running low</SectionLabel>
          <div className="space-y-2">
            {data.inventory
              .filter((i) => i.snapshot?.urgency !== "INFO")
              .slice(0, 5)
              .map((item) => {
                // Brand-new items may not have a snapshot computed
                // yet (background job hasn't run) — but we can still
                // classify stock vs thresholds directly. Previously a
                // 0-stock item showed "OK" here because the nullish
                // snapshot fell through; now it correctly shows
                // "Urgent" (or "Low" if above critical threshold).
                const urgency =
                  item.snapshot?.urgency ??
                  (item.stockOnHandBase <= 0
                    ? "CRITICAL"
                    : item.stockOnHandBase <= item.lowStockThresholdBase
                      ? "WARNING"
                      : "INFO");
                return (
                  <Link
                    key={item.id}
                    href={`/inventory/${item.id}`}
                    className={cn(
                      "notif-card flex items-center justify-between gap-3 p-4",
                      urgency === "CRITICAL" && "notif-card-urgent"
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
                        urgency === "CRITICAL"
                          ? "Urgent"
                          : urgency === "WARNING"
                          ? "Low"
                          : "OK"
                      }
                      tone={
                        urgency === "CRITICAL"
                          ? "critical"
                          : urgency === "WARNING"
                          ? "warning"
                          : "success"
                      }
                    />
                  </Link>
                );
              })}
          </div>
        </section>
      )}

      {/* Maintenance section used to live here (Connect Square /
          Sync sales / Run jobs buttons). Real user feedback: "too
          much unneeded information" on the dashboard. Those tools
          still exist at /settings — the dashboard is a task-first
          landing, not an ops console. */}
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
