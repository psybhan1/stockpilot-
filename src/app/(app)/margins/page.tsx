import type { Metadata } from "next";
import { AlertTriangle, TrendingDown, TrendingUp, DollarSign } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { getMarginDashboard } from "@/modules/recipes/margin-dashboard";

import { MarginTable } from "./margin-table";

export const metadata: Metadata = {
  title: "Margins · StockPilot",
};

export const dynamic = "force-dynamic";

export default async function MarginsPage() {
  const session = await requireSession(Role.SUPERVISOR);
  const rows = await getMarginDashboard(session.locationId);

  // KPI rollups
  const totalItems = rows.length;
  const priced = rows.filter((r) => r.sellPriceCents != null);
  const avgMarginPct =
    priced.length > 0
      ? priced.reduce((a, r) => a + (r.marginPct ?? 0), 0) / priced.length
      : null;
  const flaggedCount = rows.filter((r) => r.severity === "review").length;
  const unpricedCount = rows.filter((r) => r.severity === "unpriced").length;
  const missingDataCount = rows.filter(
    (r) => r.componentsMissing > 0 && r.severity !== "unpriced"
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Menu analytics
        </p>
        <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Margins &amp; cost of goods
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every menu variant, priced against what its ingredients actually
          cost you (from the latest supplier invoices). Red rows either
          sell too low or have ingredient cost creep you need to see.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Menu variants tracked"
          value={totalItems.toString()}
          sub={
            priced.length === totalItems
              ? "all priced via POS"
              : `${priced.length} priced via POS`
          }
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Avg margin"
          value={avgMarginPct != null ? `${Math.round(avgMarginPct * 100)}%` : "—"}
          sub={
            avgMarginPct == null
              ? "no priced variants yet"
              : avgMarginPct >= 0.7
                ? "healthy — keep it here"
                : avgMarginPct >= 0.6
                  ? "ok but tight"
                  : "below industry baseline"
          }
          tone={avgMarginPct == null ? "neutral" : avgMarginPct >= 0.7 ? "good" : avgMarginPct >= 0.6 ? "warn" : "bad"}
        />
        <KpiCard
          icon={<TrendingDown className="h-4 w-4" />}
          label="Needs review"
          value={flaggedCount.toString()}
          sub={
            flaggedCount === 0
              ? "no margins under 60%"
              : "variants under 60% margin"
          }
          tone={flaggedCount === 0 ? "good" : "bad"}
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Missing cost data"
          value={(unpricedCount + missingDataCount).toString()}
          sub={
            unpricedCount + missingDataCount === 0
              ? "all variants fully costed"
              : `${unpricedCount} unpriced · ${missingDataCount} w/ missing ingredient costs`
          }
          tone={unpricedCount + missingDataCount === 0 ? "good" : "warn"}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <MarginTable rows={rows} />
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 p-6 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              Nothing to show yet.
            </p>
            <p>
              Margins light up once you have: (1) menu variants synced from
              your POS, (2) recipes linked to those variants, and (3) at
              least one recent supplier invoice (actual paid cost) on each
              ingredient. Receive a PO with actual costs on the Receive
              Delivery page to seed the data.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "good" | "warn" | "bad";
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
        <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}
