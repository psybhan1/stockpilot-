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
  stockPilotOwnsPrice,
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
  stockPilotOwnsPrice: boolean;
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

  function approvePrice() {
    if (recommended === null) return;
    setPushMessage(null);
    startTransition(async () => {
      await approveRecommendedPriceAction({
        recipeId,
        salePriceCents: recommended,
      });
      router.refresh();
    });
  }

  function pushToSquare() {
    setPushMessage(null);
    startTransition(async () => {
      const res = await pushRecipeToSquareAction({ recipeId });
      if (!res.ok) {
        setPushMessage(`⚠ ${res.reason}`);
        return;
      }
      setPushMessage(
        `Pushed to Square: ${res.pushedFields.join(", ") || "no changes"}.`,
      );
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
      {canEdit && !missingCost ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-emerald-500/20 pt-3">
          {recommended !== null &&
          recommended !== approvedSalePriceCents ? (
            <Button
              type="button"
              onClick={approvePrice}
              disabled={isPending}
              variant="outline"
              size="sm"
              className="gap-1 rounded-xl border-emerald-500/60 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
            >
              <Check className="size-3.5" />
              Approve {formatCents(recommended)} as StockPilot price
            </Button>
          ) : null}
          {approvedSalePriceCents !== null ? (
            <div className="text-[11px] text-muted-foreground">
              Approved: {formatCents(approvedSalePriceCents)}
              {stockPilotOwnsPrice ? " · StockPilot-owned" : ""}
            </div>
          ) : null}
          {hasSquareMapping ? (
            <Button
              type="button"
              onClick={pushToSquare}
              disabled={isPending}
              size="sm"
              className="gap-1 rounded-xl bg-emerald-500 hover:bg-emerald-500/90"
            >
              <Upload className="size-3.5" />
              Push to Square
            </Button>
          ) : null}
        </div>
      ) : null}

      {hasSquareMapping ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Square price: {formatCents(posPriceCents)}
          {lastPushedAt
            ? ` · last pushed ${new Date(lastPushedAt).toLocaleDateString()}`
            : ""}
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">
          No Square variant linked — connect this recipe via the POS mapping
          first.
        </p>
      )}
      {pushMessage ? (
        <p className="mt-1 text-[11px] text-foreground">{pushMessage}</p>
      ) : null}
    </section>
  );
}
