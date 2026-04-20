"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Wrench } from "lucide-react";

import { repairConsolidatedRecipeAction } from "@/app/actions/recipe-consolidation";
import { Button } from "@/components/ui/button";

/**
 * Manager-only button shown on consolidated recipes. Unions ingredients
 * from archived sibling recipes back into this canonical — fixes the
 * pre-patch merge bug that silently dropped components the planner
 * didn't place.
 */
export function RecipeRepairButton({ recipeId }: { recipeId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run() {
    setMessage(null);
    startTransition(async () => {
      const result = await repairConsolidatedRecipeAction({ recipeId });
      if (!result.ok) {
        setMessage(result.reason);
        return;
      }
      if (result.addedComponents === 0) {
        setMessage(
          `Nothing to add — canonical already has every ingredient from the ${result.sourceSiblings} archived sibling(s).`,
        );
        return;
      }
      setMessage(
        `Restored ${result.addedComponents} ingredient(s) from ${result.sourceSiblings} archived sibling(s).`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={run}
        disabled={isPending}
        className="gap-2"
      >
        <Wrench className="size-4" />
        {isPending ? "Pulling from archive…" : "Restore missing ingredients"}
      </Button>
      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}
    </div>
  );
}
