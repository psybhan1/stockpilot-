"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TrendingUp } from "lucide-react";

import { saveRecipeMarginAction } from "@/app/actions/recipe-edit";
import { formatCents, recommendedPriceCents } from "@/modules/recipes/cost";

export function RecipePricing({
  recipeId,
  totalCostCents,
  missingCost,
  initialMarginPercent,
  locationDefaultMarginPercent,
  canEdit,
}: {
  recipeId: string;
  totalCostCents: number;
  missingCost: boolean;
  initialMarginPercent: number | null;
  locationDefaultMarginPercent: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [margin, setMargin] = useState<number>(
    initialMarginPercent ?? locationDefaultMarginPercent,
  );
  const [overridden, setOverridden] = useState<boolean>(
    initialMarginPercent !== null,
  );
  const [isPending, startTransition] = useTransition();

  const recommended = useMemo(
    () =>
      missingCost ? null : recommendedPriceCents(totalCostCents, margin),
    [totalCostCents, margin, missingCost],
  );

  function save(nextMargin: number | null) {
    startTransition(async () => {
      await saveRecipeMarginAction({
        recipeId,
        targetMarginPercent: nextMargin,
      });
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-5">
      <div className="flex items-center gap-2">
        <TrendingUp className="size-4 text-emerald-600 dark:text-emerald-300" />
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
          Pricing recommendation
        </p>
      </div>

      {missingCost ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Can&apos;t recommend a price until every component has a supplier
          cost. Add a supplier + invoice to the ingredients first.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Target profit margin
              </span>
              <span className="font-mono tabular-nums font-semibold">
                {margin}%
                {!overridden ? (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    (café default)
                  </span>
                ) : null}
              </span>
            </div>
            {canEdit ? (
              <>
                <input
                  type="range"
                  min={0}
                  max={95}
                  step={5}
                  value={margin}
                  onChange={(e) => {
                    setMargin(Number(e.target.value));
                    setOverridden(true);
                  }}
                  onMouseUp={() => save(margin)}
                  onTouchEnd={() => save(margin)}
                  disabled={isPending}
                  className="w-full accent-emerald-500"
                />
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>break-even</span>
                  <span>premium</span>
                </div>
                {overridden ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOverridden(false);
                      setMargin(locationDefaultMarginPercent);
                      save(null);
                    }}
                    disabled={isPending}
                    className="text-[11px] font-medium text-emerald-700 hover:underline dark:text-emerald-300"
                  >
                    Reset to café default ({locationDefaultMarginPercent}%)
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="flex flex-col items-end justify-center rounded-xl bg-white/60 px-4 py-3 text-right dark:bg-stone-900/40">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Suggested price
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
              {formatCents(recommended)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              cost {formatCents(totalCostCents)} ·{" "}
              {recommended !== null
                ? `profit ${formatCents(recommended - totalCostCents)}`
                : "no profit yet"}
            </p>
          </div>
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        This is a recommendation only — sale prices on Square stay untouched
        until you tap &quot;push to Square&quot; (coming next).
      </p>
    </section>
  );
}
