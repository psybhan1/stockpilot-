"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, GitMerge } from "lucide-react";

import { applyRecipeConsolidationAction } from "@/app/actions/recipe-consolidation";
import { Button } from "@/components/ui/button";
import type { ConsolidationPlan } from "@/modules/recipes/consolidation";

/**
 * Client-side preview + Apply button for a recipe-consolidation plan.
 * Shows the proposed base components + modifier tree, lets the user
 * confirm (archives siblings + re-points mappings) or bail.
 */
export function ConsolidatePreview({ plan }: { plan: ConsolidationPlan }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function apply() {
    setError(null);
    startTransition(async () => {
      const result = await applyRecipeConsolidationAction({ plan });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      setApplied(true);
      setTimeout(() => router.push("/recipes"), 1500);
    });
  }

  if (applied) {
    return (
      <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-6 text-center">
        <Check className="mx-auto size-8 text-emerald-500" />
        <p className="mt-3 text-lg font-semibold">
          {plan.siblingRecipeIds.length + 1} recipes merged into one
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Every POS mapping now points to the canonical recipe. Taking you
          back to /recipes…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="notif-card p-5">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Base components (always applied)
        </p>
        {plan.base.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No always-applied components — everything sits inside choice
            groups.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {plan.base.map((c, i) => (
              <li
                key={`${c.inventoryItemId}-${i}`}
                className="flex items-center gap-3 text-sm"
              >
                <span
                  className={
                    c.componentType === "PACKAGING"
                      ? "inline-block size-1.5 rounded-full bg-amber-500"
                      : "inline-block size-1.5 rounded-full bg-emerald-500"
                  }
                />
                <span className="flex-1 font-medium">
                  {c.inventoryItemName}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {c.quantityBase} {c.displayUnit.toLowerCase()}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {c.componentType}
                  {c.optional ? " · optional" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {plan.choiceGroups.length === 0 ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
          Heads up: the AI didn&apos;t find any real variation across these
          recipes — they look identical. You can still merge to collapse
          the duplicates.
        </div>
      ) : (
        <div className="space-y-3">
          {plan.choiceGroups.map((g, gi) => (
            <section
              key={`${g.name}-${gi}`}
              className="notif-card p-5 border-l-4 border-l-violet-500/60"
            >
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
                {g.name}
                <span className="ml-2 text-muted-foreground">
                  {g.groupType === "SIZE_SCALE"
                    ? "scales ingredient quantity"
                    : g.groupType === "MULTI_SELECT"
                      ? "pick any"
                      : "pick one"}
                  {g.required ? " · required" : " · optional"}
                </span>
              </p>
              <ul className="mt-2 space-y-1.5">
                {g.options.map((o, oi) => (
                  <li
                    key={`${o.modifierKey}-${oi}`}
                    className="flex items-center gap-3 text-sm"
                  >
                    <span
                      className={
                        o.isDefault
                          ? "inline-block size-1.5 rounded-full bg-emerald-500"
                          : "inline-block size-1.5 rounded-full bg-muted-foreground/40"
                      }
                      title={o.isDefault ? "default when no modifier arrives" : undefined}
                    />
                    <span className="font-medium">{o.label}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">
                      {o.modifierKey}
                    </span>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      {g.groupType === "SIZE_SCALE"
                        ? `×${o.sizeScaleFactor}`
                        : o.quantityBase > 0 && o.inventoryItemName
                          ? `+${o.quantityBase} ${o.displayUnit.toLowerCase()} ${o.inventoryItemName}`
                          : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <section className="notif-card p-5">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          What happens when you confirm
        </p>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          <li>
            • One canonical recipe gets the new base + modifier tree above.
          </li>
          <li>
            • {plan.siblingRecipeIds.length} sibling recipe
            {plan.siblingRecipeIds.length === 1 ? "" : "s"} get archived
            (reversible for 30 days).
          </li>
          <li>
            • Every POS mapping that used to point at a sibling now points
            at the canonical. Future sales still deplete correctly.
          </li>
          <li>
            • A Square item named &ldquo;Medium Iced Vanilla Latte&rdquo;
            with no modifier keys will auto-fire{" "}
            <span className="font-mono text-[11px]">size:medium</span> +{" "}
            <span className="font-mono text-[11px]">temp:iced</span> +{" "}
            <span className="font-mono text-[11px]">syrup:vanilla</span>{" "}
            at sale time.
          </li>
        </ul>
      </section>

      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="button"
          onClick={apply}
          disabled={isPending}
          className="gap-2 bg-emerald-500 text-white hover:bg-emerald-500/90"
        >
          <GitMerge className="size-4" />
          {isPending ? "Merging…" : "Confirm & merge"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/dashboard")}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
