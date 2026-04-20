import Link from "next/link";
import { TrendingUp, TrendingDown, AlertCircle } from "lucide-react";

import type { MoneyThisWeek } from "@/modules/dashboard/money-this-week";

/**
 * Money this week — the P&L card that replaces MoneyPulse + Shrinkage
 * with one honest answer to "am I making money?".
 *
 * Layout:
 *  ┌────────────────────────────────────────────────────────────┐
 *  │ Money this week · Apr 12–19                                │
 *  │                                                            │
 *  │ $1,061       ▲ $180 vs last week                           │
 *  │ gross profit   72% margin                                  │
 *  │                                                            │
 *  │ Revenue    COGS    Inventory spend                         │
 *  │ $1,482     $421     $620                                   │
 *  │ 147 sales  28% food  4 POs sent                            │
 *  │                                                            │
 *  │ ⚡ Latte is doing the work — $342 revenue, 78% margin     │
 *  └────────────────────────────────────────────────────────────┘
 *
 * When POS data is sparse (under ~5 costed sales), we hide the margin
 * readout so we don't lie with thin-data percentages. When there's
 * literally nothing at all, we show a quiet "waiting for first sale"
 * tombstone instead of the full card.
 */
export function MoneyThisWeekCard({ data }: { data: MoneyThisWeek }) {
  if (data.isEmpty) {
    return (
      <section className="notif-card p-5 sm:p-6">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Money this week
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Your first POS sale will unlock the weekly P&amp;L — revenue,
          cost of goods, gross profit, and how much you spent on
          inventory. Right now we&apos;re quiet because no sales have
          landed yet.
        </p>
      </section>
    );
  }

  const showMarginDetail =
    data.revenueCents > 0 && data.costedLineCount >= 3;

  const trend =
    data.revenueDeltaPct != null
      ? data.revenueDeltaPct >= 0
        ? "up"
        : "down"
      : "flat";

  return (
    <section className="notif-card p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Money this week · {formatRange(data.windowStart, data.windowEnd)}
        </p>
        <p className="font-mono text-[10px] text-muted-foreground">
          {data.salesCount} sale{data.salesCount === 1 ? "" : "s"}
        </p>
      </div>

      {/* Hero: gross profit number + margin badge + trend chip. */}
      {showMarginDetail ? (
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="text-[clamp(1.75rem,4vw,2.5rem)] font-bold leading-none">
              {formatMoney(data.grossProfitCents)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              gross profit
              {data.grossMarginPct != null ? (
                <span
                  className={
                    data.grossMarginPct >= 65
                      ? "ml-2 font-semibold text-emerald-600 dark:text-emerald-400"
                      : data.grossMarginPct >= 50
                        ? "ml-2 font-semibold text-amber-600 dark:text-amber-400"
                        : "ml-2 font-semibold text-red-600 dark:text-red-400"
                  }
                >
                  · {data.grossMarginPct.toFixed(0)}% margin
                </span>
              ) : null}
            </p>
          </div>

          {trend !== "flat" && data.revenueDeltaPct != null ? (
            <span
              className={
                trend === "up"
                  ? "inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
                  : "inline-flex items-center gap-1 rounded-full bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-700 dark:text-red-300"
              }
            >
              {trend === "up" ? (
                <TrendingUp className="size-3" />
              ) : (
                <TrendingDown className="size-3" />
              )}
              {data.revenueDeltaPct >= 0 ? "+" : ""}
              {data.revenueDeltaPct.toFixed(0)}% revenue vs last week
            </span>
          ) : null}
        </div>
      ) : (
        // Thin-data state: we have sales but can't cost enough of them
        // to trust a margin figure. Show revenue only + a soft prompt.
        <div>
          <p className="text-[clamp(1.5rem,4vw,2.25rem)] font-bold leading-none">
            {formatMoney(data.revenueCents)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            revenue · {data.lineCount} line
            {data.lineCount === 1 ? "" : "s"}
          </p>
        </div>
      )}

      {/* Three-stat row: revenue, COGS, inventory spend. */}
      <div className="grid grid-cols-3 gap-3 border-t border-border/40 pt-3">
        <Stat
          label="Revenue"
          value={formatMoney(data.revenueCents)}
          hint={`${data.lineCount} line${data.lineCount === 1 ? "" : "s"}`}
        />
        <Stat
          label="COGS"
          value={showMarginDetail ? formatMoney(data.cogsCents) : "—"}
          hint={
            showMarginDetail && data.foodCostPct != null
              ? `${data.foodCostPct.toFixed(0)}% food cost`
              : `${data.costedLineCount}/${data.lineCount} costed`
          }
        />
        <Stat
          label="Inventory spend"
          value={formatMoney(data.inventorySpendCents)}
          hint={
            data.inventorySpendOrderCount === 0
              ? "no POs sent"
              : `${data.inventorySpendOrderCount} PO${
                  data.inventorySpendOrderCount === 1 ? "" : "s"
                } sent`
          }
        />
      </div>

      {/* Insight line — one sentence of narrative. "Latte doing the
          work" only shows when we have confident data. */}
      {showMarginDetail && data.topSeller && data.topSeller.revenueCents > 0 ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
            {data.topSeller.name}
          </span>{" "}
          is your top seller — {formatMoney(data.topSeller.revenueCents)} across{" "}
          {data.topSeller.salesCount} order
          {data.topSeller.salesCount === 1 ? "" : "s"}.
        </p>
      ) : null}

      {/* Data-coverage hint: when less than 60% of sales have a
          costed recipe, tell the owner the COGS number is light and
          link them to fix the gap on /pos-mapping. */}
      {data.lineCount > 0 && data.costCoverageSalesPct < 60 ? (
        <Link
          href="/pos-mapping"
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-500/15"
        >
          <AlertCircle className="size-3.5" />
          COGS covers only {data.costCoverageSalesPct.toFixed(0)}% of your
          sales — wire more recipes →
        </Link>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate text-base font-semibold">{value}</p>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

function formatMoney(cents: number): string {
  if (cents === 0) return "$0";
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) {
    return `$${dollars.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return `$${dollars.toFixed(2)}`;
}

function formatRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)}–${fmt(end)}`;
}
