import Link from "next/link";
import { ArrowRight, DollarSign, TrendingUp, Zap } from "lucide-react";

/**
 * Money Pulse — the one card that answers "where's my money today?"
 * Design brief: MarginEdge charges $330/month for a daily P&L; we
 * surface the same signal in free tier. Honest zero-state when no
 * data yet, actionable tone when there is.
 */

type MoneyPulseData = {
  weekSpentCents: number;
  weekOrderCount: number;
  autoApprovedCount: number;
  pendingCount: number;
  pendingTotalCents: number;
  priceAlert:
    | null
    | {
        itemName: string;
        oldCents: number;
        newCents: number;
        deltaPct: number;
      };
  isEmpty: boolean;
};

export function MoneyPulseCard({ data }: { data: MoneyPulseData }) {
  // Empty state — brand-new café, nothing to report yet. Show the
  // card anyway with a clear "what happens here" so it doesn't feel
  // like a broken widget.
  if (data.isEmpty) {
    return (
      <section className="notif-card p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.06] text-foreground/80">
            <DollarSign className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Money pulse
            </p>
            <p className="mt-1 text-base font-semibold leading-tight">
              Your weekly spend will show up here.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Orders you approve (or the bot auto-sends) roll up
              into a live P&amp;L. Text{" "}
              <span className="font-semibold text-foreground">
                &ldquo;we need milk&rdquo;
              </span>{" "}
              to kick off your first one.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="notif-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Money pulse · last 7 days
          </p>
          <p className="mt-2 text-[clamp(1.5rem,4vw,2.25rem)] font-bold leading-none">
            {formatMoney(data.weekSpentCents)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.weekOrderCount === 0
              ? "No orders sent this week yet."
              : `${data.weekOrderCount} order${
                  data.weekOrderCount === 1 ? "" : "s"
                } sent`}
            {data.autoApprovedCount > 0 && (
              <>
                {" · "}
                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                  <Zap className="size-3" />
                  bot auto-sent {data.autoApprovedCount}
                </span>
              </>
            )}
          </p>
        </div>

        {data.pendingCount > 0 ? (
          <Link
            href="/purchase-orders"
            className="group inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-xs font-semibold"
          >
            <span className="text-muted-foreground group-hover:text-foreground">
              {data.pendingCount} waiting · {formatMoney(data.pendingTotalCents)}
            </span>
            <ArrowRight className="size-3 text-muted-foreground group-hover:text-foreground" />
          </Link>
        ) : null}
      </div>

      {/* Price-jump alert row — shows the single biggest variance
          from a recent delivery so users see margin-erosion BEFORE
          it adds up. This is the concrete answer to "sales look
          healthy but profit feels invisible". */}
      {data.priceAlert ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <TrendingUp className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-amber-900 dark:text-amber-100">
              {data.priceAlert.itemName} is up{" "}
              {Math.round(Math.abs(data.priceAlert.deltaPct) * 100)}% this week
            </p>
            <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-200/80">
              {formatMoney(data.priceAlert.oldCents)} →{" "}
              {formatMoney(data.priceAlert.newCents)} per unit. Worth a look
              before it eats your margin.
            </p>
          </div>
        </div>
      ) : null}
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
