"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Sparkles, X } from "lucide-react";

import {
  applyCalibrationSuggestionAction,
  dismissCalibrationSuggestionAction,
} from "@/app/actions/calibration";
import { Button } from "@/components/ui/button";

export type CalibrationSuggestionRow = {
  id: string;
  rationalePlain: string;
  currentQuantityBase: number;
  suggestedQuantityBase: number;
  inventoryItemName: string;
  recipeName: string;
  displayUnit: string;
};

/**
 * Calibration suggestions — the self-correcting recipe UI.
 *
 * Rendered inside the Recipe Health card when PENDING suggestions
 * exist. Plain English only: confidence score, weeks of data, and
 * std-dev are all hidden. The user just sees "looks about 7% off,
 * bump to X" and decides.
 */
export function CalibrationSuggestionsCard({
  rows,
}: {
  rows: CalibrationSuggestionRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (rows.length === 0) return null;

  function apply(id: string) {
    startTransition(async () => {
      await applyCalibrationSuggestionAction(id);
      router.refresh();
    });
  }

  function dismiss(id: string) {
    startTransition(async () => {
      await dismissCalibrationSuggestionAction(id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
        <Sparkles className="mr-1 inline size-3" />
        Recipe tune-ups StockBuddy noticed
      </p>
      {rows.map((r) => (
        <div
          key={r.id}
          className="rounded-xl border border-violet-500/40 bg-violet-500/5 p-3"
        >
          <p className="text-sm">
            <span className="font-semibold">
              {r.recipeName} · {r.inventoryItemName}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {r.rationalePlain}
          </p>
          <p className="mt-1 font-mono text-[11px]">
            <span className="text-muted-foreground line-through">
              {r.currentQuantityBase} {r.displayUnit.toLowerCase()}
            </span>
            <span className="mx-2 text-muted-foreground">→</span>
            <span className="font-semibold text-emerald-700 dark:text-emerald-300">
              {r.suggestedQuantityBase} {r.displayUnit.toLowerCase()}
            </span>
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => apply(r.id)}
              disabled={isPending}
              className="h-7 gap-1 bg-emerald-500 text-white hover:bg-emerald-500/90 text-[11px]"
            >
              <Check className="size-3" />
              Apply
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => dismiss(r.id)}
              disabled={isPending}
              className="h-7 gap-1 text-[11px]"
            >
              <X className="size-3" />
              Not this time
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
