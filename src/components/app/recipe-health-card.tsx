import Link from "next/link";
import { AlertCircle, ArrowRight, HeartPulse } from "lucide-react";

import type { RecipeHealthSummary } from "@/modules/recipes/health";

/**
 * Recipe Health card — Build #3 MVP, the calibration surface for
 * /dashboard. Only renders when there's activity to talk about.
 *
 * Surfaces the top 3 review-worthy recipes (high volume, low
 * confidence OR stale approval) with a direct link to each recipe's
 * AI-draft/chat flow so the manager can tweak + re-approve in one
 * minute rather than navigating the /recipes editor.
 */
export function RecipeHealthCard({ data }: { data: RecipeHealthSummary }) {
  if (data.totalRecipes === 0 || data.rows.every((r) => r.salesCount === 0)) {
    return null;
  }

  const reviewRows = data.rows.filter((r) => r.needsReview).slice(0, 3);
  const topVolumeRow = data.rows.find((r) => r.salesCount > 0 && !r.needsReview);

  return (
    <section className="notif-card p-5 sm:p-6 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Recipe health · last {data.windowDays} days
          </p>
          <p className="mt-1 text-lg font-semibold leading-tight">
            {data.needsReviewCount > 0 ? (
              <>
                {data.needsReviewCount} recipe
                {data.needsReviewCount === 1 ? "" : "s"} worth a second look
              </>
            ) : (
              <>All active recipes look healthy</>
            )}
          </p>
        </div>
        <Link
          href="/recipes"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-xs font-semibold"
        >
          <span className="text-muted-foreground">All recipes</span>
          <ArrowRight className="size-3 text-muted-foreground" />
        </Link>
      </div>

      {reviewRows.length > 0 ? (
        <ul className="space-y-2">
          {reviewRows.map((r) => (
            <li
              key={r.recipeId}
              className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                    <AlertCircle className="size-3.5 shrink-0 text-amber-500" />
                    {r.menuItemName === r.variantName
                      ? r.variantName
                      : `${r.menuItemName} · ${r.variantName}`}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.reviewReason}
                  </p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {r.salesCount} sale{r.salesCount === 1 ? "" : "s"} ·{" "}
                    {r.componentsCount} component
                    {r.componentsCount === 1 ? "" : "s"} ·{" "}
                    {Math.round(r.confidenceScore * 100)}% confidence
                  </p>
                </div>
                {r.mappingId ? (
                  <Link
                    href={`/pos-mapping/${r.mappingId}/draft`}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-500/90"
                  >
                    Tune with AI
                    <ArrowRight className="size-3" />
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Healthy hero — when nothing needs review, celebrate the top
          seller so the card doesn't just read "all good" into the void. */}
      {reviewRows.length === 0 && topVolumeRow ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <HeartPulse className="size-3.5 text-emerald-500" />
            {topVolumeRow.menuItemName === topVolumeRow.variantName
              ? topVolumeRow.variantName
              : `${topVolumeRow.menuItemName} · ${topVolumeRow.variantName}`}{" "}
            is pulling the weight
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {topVolumeRow.salesCount} sales, {topVolumeRow.componentsCount}{" "}
            components,{" "}
            {Math.round(topVolumeRow.confidenceScore * 100)}% confident.
          </p>
        </div>
      ) : null}
    </section>
  );
}
