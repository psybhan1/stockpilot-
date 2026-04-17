import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  DollarSign,
  Minus,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Sparkline } from "@/components/app/sparkline";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import {
  getPricingDashboard,
  type PriceChangeSummary,
} from "@/modules/pricing/history";

export const metadata: Metadata = { title: "Pricing · StockPilot" };
export const dynamic = "force-dynamic";

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requireSession(Role.SUPERVISOR);
  const sp = await searchParams;
  const days = clampDays(Number(sp.days ?? "90"));

  const dash = await getPricingDashboard(session.locationId, { days });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Ingredient pricing · last {days} days
        </p>
        <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Price trends
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every ingredient with an actual-cost data point in the window.
          Ranked by how much each price has moved — biggest swings first,
          so the items quietly eroding your margins surface at the top.
        </p>
        <div className="mt-3">
          <RangeToggles active={days} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Ingredients tracked"
          value={dash.rows.length.toString()}
          sub={
            dash.rows.length === 0
              ? "no price data yet — receive a PO with actual cost"
              : `with ≥1 actual-cost capture in ${days}d`
          }
          tone="neutral"
          icon={<DollarSign className="h-4 w-4" />}
        />
        <KpiCard
          label="Price-up, significant"
          value={dash.rows.filter((r) => r.summary.severity === "review" && r.summary.trend === "up").length.toString()}
          sub="≥ 15% cost increase"
          tone={dash.rows.some((r) => r.summary.severity === "review" && r.summary.trend === "up") ? "bad" : "good"}
          icon={<ArrowUp className="h-4 w-4" />}
        />
        <KpiCard
          label="Price-down, significant"
          value={dash.rows.filter((r) => r.summary.severity === "review" && r.summary.trend === "down").length.toString()}
          sub="≥ 15% cost decrease"
          tone={dash.rows.some((r) => r.summary.severity === "review" && r.summary.trend === "down") ? "good" : "neutral"}
          icon={<ArrowDown className="h-4 w-4" />}
        />
        <KpiCard
          label="On the watch"
          value={dash.watchCount.toString()}
          sub="5–15% swing, worth a glance"
          tone={dash.watchCount > 0 ? "warn" : "neutral"}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>

      {dash.rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 p-6 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No price data yet.</p>
            <p>
              Price trends light up once you receive a PO with the{" "}
              <em>actual cost</em> captured — either scan the supplier&apos;s
              invoice on the receive page (the OCR fills it in) or type
              it by hand. Each delivery becomes a data point.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3">Ingredient</th>
                    <th className="px-4 py-3">Trend</th>
                    <th className="px-4 py-3 text-right">Current</th>
                    <th className="px-4 py-3 text-right">Change</th>
                    <th className="px-4 py-3 text-right">Menu items affected</th>
                    <th className="px-4 py-3">Supplier</th>
                  </tr>
                </thead>
                <tbody>
                  {dash.rows.map((row) => (
                    <tr
                      key={row.inventoryItemId}
                      className="border-b border-border/40 transition hover:bg-muted/30"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/inventory/${row.inventoryItemId}`}
                          className="font-medium hover:underline"
                        >
                          {row.itemName}
                        </Link>
                        {row.category ? (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {row.category.replaceAll("_", " ").toLowerCase()}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Sparkline
                          values={row.points.map((p) => p.unitCostCents)}
                          width={96}
                          height={28}
                          className={sparkToneClass(row.summary.trend)}
                        />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.summary.currentCents != null
                          ? `$${(row.summary.currentCents / 100).toFixed(2)}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ChangeCell summary={row.summary} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.affectedMenuCount > 0 ? (
                          <span>
                            {row.affectedMenuCount}{" "}
                            <span className="text-xs text-muted-foreground">
                              {row.affectedMenuCount === 1 ? "variant" : "variants"}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {row.currentSupplierName ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ChangeCell({ summary }: { summary: PriceChangeSummary }) {
  if (summary.points < 2 || summary.deltaPct == null) {
    return (
      <span className="text-xs text-muted-foreground">
        {summary.points === 1 ? "1 data point" : "—"}
      </span>
    );
  }
  const pct = summary.deltaPct * 100;
  const abs = Math.abs(pct);
  const Icon =
    summary.trend === "up" ? ArrowUp : summary.trend === "down" ? ArrowDown : Minus;
  const tone =
    summary.severity === "review"
      ? summary.trend === "up"
        ? "text-red-700 dark:text-red-300"
        : "text-emerald-700 dark:text-emerald-300"
      : summary.severity === "watch"
        ? summary.trend === "up"
          ? "text-amber-700 dark:text-amber-300"
          : "text-emerald-700 dark:text-emerald-300"
        : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${tone}`}>
      <Icon className="h-3.5 w-3.5" />
      <span className="font-medium">
        {pct > 0 ? "+" : pct < 0 ? "−" : ""}
        {abs.toFixed(1)}%
      </span>
      {summary.deltaCents != null ? (
        <span className="text-xs opacity-75">
          ({summary.deltaCents > 0 ? "+" : "−"}${Math.abs(summary.deltaCents / 100).toFixed(2)})
        </span>
      ) : null}
    </span>
  );
}

function sparkToneClass(trend: PriceChangeSummary["trend"]): string {
  if (trend === "up") return "text-red-600 dark:text-red-400";
  if (trend === "down") return "text-emerald-600 dark:text-emerald-400";
  return "text-muted-foreground";
}

function clampDays(n: number): number {
  if (!Number.isFinite(n) || n < 7) return 90;
  if (n > 365) return 365;
  return Math.round(n);
}

function RangeToggles({ active }: { active: number }) {
  const options = [
    { days: 30, label: "30d" },
    { days: 60, label: "60d" },
    { days: 90, label: "90d" },
    { days: 180, label: "6mo" },
    { days: 365, label: "1yr" },
  ];
  return (
    <div className="inline-flex rounded-2xl border border-border/60 bg-card p-1">
      {options.map((o) => {
        const isActive = o.days === active;
        return (
          <a
            key={o.days}
            href={`?days=${o.days}`}
            className={`rounded-xl px-3 py-1 text-sm transition ${
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </a>
        );
      })}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "good" | "warn" | "bad" | "neutral";
  icon: React.ReactNode;
}) {
  const ring =
    tone === "good"
      ? "ring-emerald-500/30"
      : tone === "warn"
        ? "ring-amber-500/30"
        : tone === "bad"
          ? "ring-red-500/30"
          : "ring-border/40";
  const iconTint =
    tone === "good"
      ? "text-emerald-600"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "bad"
          ? "text-red-600"
          : "text-muted-foreground";
  return (
    <Card className={`ring-1 ${ring}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <span className={iconTint}>{icon}</span>
        </div>
        <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}
