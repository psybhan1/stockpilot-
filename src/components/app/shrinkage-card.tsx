import Link from "next/link";
import { ArrowRight, AlertOctagon, TrendingDown } from "lucide-react";

/**
 * Shrinkage Detector — the MarginEdge-unique feature we're shipping
 * for free. MarginEdge charges $330/mo for restaurants to see
 * "where is my theoretical vs actual variance?". We surface the
 * same signal from the StockMovement ledger:
 *
 *   theoretical usage = POS depletion in the period
 *   tracked loss     = waste + breakage + transfer
 *   unexplained       = count-adjustments + corrections
 *                       (the stuff you can't tie to a sale, a
 *                        receipt, or a logged waste event)
 *
 * When unexplained > $0 (or > a small threshold), show this card.
 * It names the worst-offending item and converts to plain dollars
 * so the user can act on it TODAY instead of waiting for a monthly
 * close.
 */

type ShrinkageData = {
  totalCents: number;
  worstItem: {
    name: string;
    cents: number;
    pctOfUsage: number | null;
  } | null;
  itemCount: number;
  rangeDays: number;
};

export function ShrinkageCard({ data }: { data: ShrinkageData }) {
  if (data.totalCents <= 0 || data.worstItem == null) return null;

  const severity =
    data.totalCents >= 5000
      ? "review"
      : data.totalCents >= 1500
        ? "watch"
        : "info";

  const toneClasses = {
    review: "border-rose-500/30 bg-rose-500/10",
    watch: "border-amber-500/30 bg-amber-500/10",
    info: "border-border/60 bg-card",
  }[severity];

  const iconToneClass = {
    review: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    watch: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    info: "bg-foreground/[0.06] text-foreground/80",
  }[severity];

  const Icon = severity === "review" ? AlertOctagon : TrendingDown;

  const pctLabel =
    data.worstItem.pctOfUsage != null
      ? ` (${Math.round(Math.abs(data.worstItem.pctOfUsage) * 100)}% of what you used)`
      : "";

  return (
    <section className={`notif-card p-5 sm:p-6 border ${toneClasses}`}>
      <div className="flex items-start gap-4">
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${iconToneClass}`}
        >
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Shrinkage · last {data.rangeDays} days
          </p>
          <p className="mt-1 text-xl font-bold leading-tight sm:text-2xl">
            {formatMoney(data.totalCents)} you can&apos;t explain
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.worstItem.name} is the biggest offender —{" "}
            <span className="font-medium text-foreground">
              {formatMoney(data.worstItem.cents)}
            </span>
            {pctLabel}.{" "}
            {severity === "review"
              ? "Worth a quick shelf check — shrinkage at this rate eats margin fast."
              : severity === "watch"
                ? "Small but worth knowing — often points at over-pouring or spoilage."
                : "Likely a counting nudge, not theft."}
          </p>
        </div>
        <Link
          href="/variance"
          className="group hidden shrink-0 items-center gap-1.5 self-center rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-xs font-semibold sm:flex"
        >
          <span className="text-muted-foreground group-hover:text-foreground">
            See items
          </span>
          <ArrowRight className="size-3 text-muted-foreground group-hover:text-foreground" />
        </Link>
      </div>
    </section>
  );
}

function formatMoney(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) {
    return `$${Math.round(dollars).toLocaleString()}`;
  }
  return `$${dollars.toFixed(2)}`;
}
