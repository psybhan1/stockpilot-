"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@/lib/domain-enums";

import { requireSession } from "@/modules/auth/session";
import {
  applyConsolidationPlan,
  planConsolidation,
  repairConsolidatedRecipe,
  type ConsolidationPlan,
} from "@/modules/recipes/consolidation";

export async function planRecipeConsolidationAction(input: {
  recipeIds: string[];
}): Promise<{ ok: true; plan: ConsolidationPlan } | { ok: false; reason: string }> {
  const session = await requireSession(Role.MANAGER);
  const result = await planConsolidation({
    locationId: session.locationId,
    recipeIds: input.recipeIds,
  });
  if ("error" in result) return { ok: false, reason: result.error };
  return { ok: true, plan: result };
}

export async function applyRecipeConsolidationAction(input: {
  plan: ConsolidationPlan;
}): Promise<
  | { ok: true; archivedCount: number }
  | { ok: false; reason: string }
> {
  const session = await requireSession(Role.MANAGER);
  const result = await applyConsolidationPlan({
    locationId: session.locationId,
    plan: input.plan,
    userId: session.userId,
  });
  revalidatePath("/recipes");
  revalidatePath("/dashboard");
  return result;
}

export async function repairConsolidatedRecipeAction(input: {
  recipeId: string;
}): Promise<
  | { ok: true; addedComponents: number; sourceSiblings: number }
  | { ok: false; reason: string }
> {
  const session = await requireSession(Role.MANAGER);
  const result = await repairConsolidatedRecipe({
    locationId: session.locationId,
    recipeId: input.recipeId,
  });
  revalidatePath("/recipes");
  revalidatePath(`/recipes/${input.recipeId}`);
  return result;
}
