import Link from "next/link";
import { Wand2, ArrowRight } from "lucide-react";

export type ConsolidateCandidateRow = {
  bareName: string;
  displayLabel: string;
  recipes: Array<{
    id: string;
    variantName: string;
    menuItemName: string;
  }>;
};

export function ConsolidateRecipesCard({
  groups,
}: {
  groups: ConsolidateCandidateRow[];
}) {
  if (groups.length === 0) return null;

  return (
    <section className="notif-card p-5 sm:p-6 space-y-3">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
          <Wand2 className="mr-1 inline size-3" />
          Consolidate look-alike recipes
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          StockBuddy noticed multiple recipes that look like the same drink.
          Merge each group into ONE recipe with size / milk / syrup / temp
          modifiers — Square sales keep depleting correctly; the modifier keys
          on the sale (or inferred from the item name) pick which components
          to apply.
        </p>
      </div>
      <ul className="space-y-2">
        {groups.map((g) => (
          <li
            key={g.bareName}
            className="rounded-xl border border-violet-500/40 bg-violet-500/5 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {g.displayLabel}
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {g.recipes.length} recipes
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {g.recipes.map((r) => r.variantName).join(" · ")}
                </p>
              </div>
              <Link
                href={`/recipes/consolidate?ids=${g.recipes.map((r) => r.id).join(",")}`}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-violet-500 px-3 text-[11px] font-semibold text-white hover:bg-violet-500/90"
              >
                Review merge plan
                <ArrowRight className="size-3" />
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
