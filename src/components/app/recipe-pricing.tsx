"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, TrendingUp, Upload } from "lucide-react";

import {
  approveRecommendedPriceAction,
  pushRecipeToSquareAction,
  saveRecipeMarginAction,
} from "@/app/actions/recipe-edit";
import { Button } from "@/components/ui/button";
import { formatCents, recommendedPriceCents } from "@/modules/recipes/cost";

export function RecipePricing({
  recipeId,
  totalCostCents,
  missingCost,
  initialMarginPercent,
  locationDefaultMarginPercent,
  canEdit,
  approvedSalePriceCents,
  hasSquareMapping,
  posPriceCents,
  lastPushedAt,
}: {
  recipeId: string;
  totalCostCents: number;
  missingCost: boolean;
  initialMarginPercent: number | null;
  locationDefaultMarginPercent: number;
  canEdit: boolean;
  approvedSalePriceCents: number | null;
  hasSquareMapping: boolean;
  posPriceCents: number | null;
  lastPushedAt: string | null;
}) {
  const router = useRouter();
  const [margin, setMargin] = useState<number>(
    initialMarginPercent ?? locationDefaultMarginPercent,
  );
  const [overridden, setOverridden] = useState<boolean>(
    initialMarginPercent !== null,
  );
  const [isPending, startTransition] = useTransition();
  const [pushMessage, setPushMessage] = useState<string | null>(null);

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

  async function approveAndPush() {
    if (recommended === null) return;
    setPushMessage(null);
    startTransition(async () => {
      if (recommended !== approvedSalePriceCents) {
        const approveRes = await approveRecommendedPriceAction({
          recipeId,
          salePriceCents: recommended,
        });
        if (!approveRes.ok) {
          setPushMessage(`⚠ ${approveRes.reason}`);
          return;
        }
      }
      const res = await pushRecipeToSquareAction({ recipeId });
      if (!res.ok) {
        setPushMessage(`⚠ ${res.reason}`);
        return;
      }
      const nice = res.pushedFields.includes("created")
        ? `Created on Square at ${formatCents(recommended)}.`
        : `Pushed ${formatCents(recommended)} to Square.`;
      setPushMessage(nice);
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-5">
      <div className="flex items-center gap-2">
        <TrendingUp className="size-4 text-emerald-600 dark:text-emerald-300" />
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
          What to charge
        </p>
      </div>

      {missingCost ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Drop a supplier bill into this recipe&apos;s ingredients and
          we&apos;ll tell you exactly what to charge.
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
                  min={40}
                  max={92}
                  step={1}
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
                  <span>thin margin</span>
                  <span>specialty</span>
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
      {canEdit && !missingCost && recommended !== null ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-emerald-500/20 pt-4">
          <Button
            type="button"
            onClick={approveAndPush}
            disabled={isPending}
            className="gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-500/90"
          >
            <Upload className="size-4" />
            {isPending
              ? "Syncing with Square…"
              : hasSquareMapping
                ? `Make it ${formatCents(recommended)} on Square`
                : `Put this on the till at ${formatCents(recommended)}`}
          </Button>
          {recommended === approvedSalePriceCents &&
          recommended === posPriceCents &&
          lastPushedAt ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              <Check className="size-3" />
              Matches Square · synced{" "}
              {new Date(lastPushedAt).toLocaleDateString()}
            </span>
          ) : hasSquareMapping ? (
            <span className="text-[11px] text-muted-foreground">
              Square shows {formatCents(posPriceCents)}
              {lastPushedAt
                ? ` · last synced ${new Date(lastPushedAt).toLocaleDateString()}`
                : " · never synced"}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              Not on your till yet.
            </span>
          )}
        </div>
      ) : null}

      {pushMessage ? (
        <p className="mt-2 text-[12px] font-medium text-emerald-700 dark:text-emerald-300">
          {pushMessage}
        </p>
      ) : null}
    </section>
  );
}
