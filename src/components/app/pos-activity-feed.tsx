import Link from "next/link";
import { ArrowRight, CheckCircle2, AlertTriangle, Clock, Zap } from "lucide-react";

import { approveRecommendationAction } from "@/app/actions/operations";
import { Button } from "@/components/ui/button";
import type { PosActivityRow } from "@/modules/pos/activity-feed";

/**
 * POS activity feed — the "yes, the app is actually doing something"
 * card for /dashboard. Shows each recent sale line WITH the real
 * inventory depletion it caused (or the gap if it couldn't deplete).
 *
 * Design rule: every row must show an outcome, not just an event.
 * "3× Latte" is noise; "3× Latte → −240ml milk, −4× 16oz cup" is the
 * product promise in action. Any sale that can't show an outcome is
 * an actionable row (either a mapping gap or a triggered reorder).
 */
export function PosActivityFeed({ rows }: { rows: PosActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <section className="notif-card p-5 sm:p-6">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          POS activity · last 7 days
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Waiting for your first sale. When the POS fires, this card
          will show what sold and exactly which ingredients came off
          the shelf.
        </p>
      </section>
    );
  }

  const depletedCount = rows.filter((r) => r.status === "depleted").length;
  const gapCount = rows.filter(
    (r) => r.status === "unmapped" || r.status === "gap"
  ).length;

  return (
    <section className="notif-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            POS activity · last 7 days
          </p>
          <p className="mt-1 text-lg font-semibold leading-tight">
            {rows.length} sale{rows.length === 1 ? "" : "s"} processed
            {depletedCount > 0 ? (
              <span className="ml-2 text-emerald-500 dark:text-emerald-400 text-sm font-normal">
                · {depletedCount} depleted inventory
              </span>
            ) : null}
            {gapCount > 0 ? (
              <span className="ml-2 text-amber-500 dark:text-amber-400 text-sm font-normal">
                · {gapCount} need mapping
              </span>
            ) : null}
          </p>
        </div>
        {gapCount > 0 ? (
          <Link
            href="/pos-mapping"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
          >
            Fix {gapCount} gap{gapCount === 1 ? "" : "s"}
            <ArrowRight className="size-3" />
          </Link>
        ) : null}
      </div>

      <ul className="mt-4 divide-y divide-border/40">
        {rows.map((row) => (
          <li key={row.id} className="py-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <StatusIcon status={row.status} />
                  <p className="truncate text-sm font-medium">
                    {row.productName}
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                      ×{row.quantity}
                    </span>
                  </p>
                </div>
                <p className="mt-0.5 ml-6 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {row.provider} · {formatRelativeTime(row.occurredAt)}
                </p>
              </div>
            </div>

            {/* Depletion detail — the "and here's what we did about it"
                line. This is the whole point of the feature. */}
            {row.status === "depleted" && row.depletions.length > 0 ? (
              <p className="ml-6 text-xs text-emerald-700 dark:text-emerald-300">
                →{" "}
                {row.depletions.map((d, i) => (
                  <span key={`${d.inventoryItemName}-${i}`}>
                    {i > 0 ? ", " : ""}
                    {formatDepletion(d.deltaBase, d.displayUnit)}{" "}
                    <span className="text-emerald-600/80 dark:text-emerald-400/80">
                      {d.inventoryItemName}
                    </span>
                  </span>
                ))}
              </p>
            ) : null}

            {/* Gap: Square/Clover/Shopify sale with no recipe wired.
                One-click jump to /pos-mapping preserves context. */}
            {row.status === "gap" ? (
              <Link
                href={`/pos-mapping?q=${encodeURIComponent(row.productName)}`}
                className="ml-6 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-500/15"
              >
                Wire a recipe so this sale depletes inventory
                <ArrowRight className="size-3" />
              </Link>
            ) : null}

            {/* Unmapped: webhook sale with no PosSimpleMapping. */}
            {row.status === "unmapped" ? (
              <Link
                href={`/pos-mapping?q=${encodeURIComponent(row.productName)}`}
                className="ml-6 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-500/15"
              >
                Map to inventory item
                <ArrowRight className="size-3" />
              </Link>
            ) : null}

            {/* Pending: sale arrived, SYNC_SALES hasn't run yet. */}
            {row.status === "pending" ? (
              <p className="ml-6 text-[11px] font-mono text-muted-foreground">
                Processing… (sync tick runs every 2 min)
              </p>
            ) : null}

            {/* Draft-PO prompt: when the depletion pushed an ingredient
                below reorder threshold, StockBuddy has a recommendation
                waiting. One-click approval spawns the PO. */}
            {row.triggeredReorders.map((r) => (
              <form
                key={r.recommendationId}
                action={approveRecommendationAction}
                className="ml-6 flex flex-wrap items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/5 p-2 text-[11px]"
              >
                <input type="hidden" name="recommendationId" value={r.recommendationId} />
                <input type="hidden" name="recommendedPackCount" value="1" />
                <Zap className="size-3.5 text-red-500 dark:text-red-400" />
                <span className="flex-1">
                  This sale dropped{" "}
                  <span className="font-semibold text-foreground">
                    {r.inventoryItemName}
                  </span>{" "}
                  below reorder point.
                  {r.supplierName ? (
                    <>
                      {" "}
                      Draft to{" "}
                      <span className="font-semibold text-foreground">
                        {r.supplierName}
                      </span>
                      ?
                    </>
                  ) : (
                    " Draft reorder?"
                  )}
                </span>
                <Button
                  type="submit"
                  size="sm"
                  className="h-6 bg-red-500 text-white text-[10px] font-semibold hover:bg-red-500/90"
                >
                  Draft PO
                </Button>
              </form>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusIcon({ status }: { status: PosActivityRow["status"] }) {
  if (status === "depleted") {
    return (
      <CheckCircle2 className="size-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
    );
  }
  if (status === "pending") {
    return <Clock className="size-4 shrink-0 text-muted-foreground" />;
  }
  return (
    <AlertTriangle className="size-4 shrink-0 text-amber-500 dark:text-amber-400" />
  );
}

function formatDepletion(deltaBase: number, displayUnit: string): string {
  // deltaBase is negative (it's a depletion). Show magnitude.
  const magnitude = Math.abs(deltaBase);
  const unit = (displayUnit ?? "").toLowerCase();
  // Base units are stored in ml/g/each depending on the inventory
  // item's unit family. For display we keep it simple — show the
  // magnitude with the display unit as-is. Milk in ml, cups in each.
  return `−${magnitude}${unit && unit !== "each" ? " " + unit : ""}`;
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
