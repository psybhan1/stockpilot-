"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, X } from "lucide-react";

import {
  dismissDuplicatePairAction,
  mergeDuplicateRecipesAction,
} from "@/app/actions/duplicates";
import { Button } from "@/components/ui/button";

export type DuplicateRow = {
  canonicalRecipeId: string;
  canonicalName: string;
  duplicateRecipeId: string;
  duplicateName: string;
  rationale: string;
};

export function DuplicateRecipesCard({ rows }: { rows: DuplicateRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (rows.length === 0) return null;

  function merge(canonicalRecipeId: string, duplicateRecipeId: string) {
    startTransition(async () => {
      await mergeDuplicateRecipesAction({
        canonicalRecipeId,
        duplicateRecipeId,
      });
      router.refresh();
    });
  }

  function dismiss(recipeAId: string, recipeBId: string) {
    startTransition(async () => {
      await dismissDuplicatePairAction({ recipeAId, recipeBId });
      router.refresh();
    });
  }

  return (
    <section className="notif-card p-5 sm:p-6 space-y-3">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Possible duplicate recipes
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          StockBuddy noticed these look like the same drink. Merge keeps
          the fuller one and archives the other — all future POS sales
          flow into the merged recipe.
        </p>
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={`${r.canonicalRecipeId}-${r.duplicateRecipeId}`}
            className="rounded-xl border border-violet-500/40 bg-violet-500/5 p-3"
          >
            <p className="text-sm font-semibold">
              {r.canonicalName}{" "}
              <span className="text-muted-foreground font-normal">≈</span>{" "}
              {r.duplicateName}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {r.rationale}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => merge(r.canonicalRecipeId, r.duplicateRecipeId)}
                disabled={isPending}
                className="h-7 gap-1 bg-violet-500 text-white hover:bg-violet-500/90 text-[11px]"
              >
                <GitMerge className="size-3" />
                Merge into {r.canonicalName}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => dismiss(r.canonicalRecipeId, r.duplicateRecipeId)}
                disabled={isPending}
                className="h-7 gap-1 text-[11px]"
              >
                <X className="size-3" />
                Keep separate
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
