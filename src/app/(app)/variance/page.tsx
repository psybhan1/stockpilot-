import type { Metadata } from "next";
import {
  AlertTriangle,
  DollarSign,
  ListChecks,
  PackageX,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { getVarianceReport } from "@/modules/variance/report";

import { VarianceTable } from "./variance-table";

export const metadata: Metadata = {
  title: "Variance · StockPilot",
};
export const dynamic = "force-dynamic";

export default async function VariancePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requireSession(Role.SUPERVISOR);
  const sp = await searchParams;
  const days = clampDays(Number(sp.days ?? "7"));

  const report = await getVarianceReport(session.locationId, { days });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Theoretical vs actual · last {days} days
        </p>
        <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Variance &amp; shrinkage
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          What recipes + POS sales say you should have used, versus what your
          inventory actually tells us left the shelf. The gap is money —
          spilt pours, unlogged waste, sales that didn&apos;t ring up, or
          shrinkage you need to dig into.
        </p>
        <div className="mt-3">
          <RangeToggles active={days} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total non-sale loss"
          value={formatCents(report.totalLossCents)}
          sub={
            report.totalLossCents > 0
              ? "tracked waste + unknown shrinkage"
              : "nothing lost in this window"
          }
          tone={report.totalLossCents > 5000 ? "bad" : report.totalLossCents > 1500 ? "warn" : "good"}
          icon={<DollarSign className="h-4 w-4" />}
        />
        <KpiCard
          label="Unknown shrinkage"
          value={formatCents(report.shrinkageCents)}
          sub={
            report.shrinkageCents > 0
              ? "gap between books and reality"
              : "books match reality"
          }
          tone={report.shrinkageCents > 2000 ? "bad" : report.shrinkageCents > 500 ? "warn" : "good"}
          icon={<PackageX className="h-4 w-4" />}
        />
        <KpiCard
          label="Tracked waste"
          value={formatCents(report.trackedWasteCents)}
          sub={
            report.trackedWasteCents > 0
              ? "spillage / breakage someone logged"
              : "no waste entries in window"
          }
          tone={report.trackedWasteCents > 2000 ? "warn" : "good"}
          icon={<ListChecks className="h-4 w-4" />}
        />
        <KpiCard
          label="Items flagged"
          value={`${report.flaggedCount} / ${report.itemCount}`}
          sub={
            report.flaggedCount === 0
              ? "no items over threshold"
              : "items needing attention"
          }
          tone={report.flaggedCount === 0 ? "good" : report.flaggedCount > 3 ? "bad" : "warn"}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>

      {report.rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 p-6 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              No activity in this window.
            </p>
            <p>
              Variance needs at least one POS sale, waste entry, stock count,
              or correction in the selected range. Try a longer window, or
              receive a delivery + run a stock count to seed the data.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <VarianceTable rows={report.rows} days={days} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function clampDays(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 7;
  if (n > 90) return 90;
  return Math.round(n);
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function RangeToggles({ active }: { active: number }) {
  const options = [
    { days: 7, label: "7d" },
    { days: 14, label: "14d" },
    { days: 30, label: "30d" },
    { days: 90, label: "90d" },
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
