"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@/lib/domain-enums";

import { requireSession } from "@/modules/auth/session";
import {
  dismissDuplicatePair,
  mergeDuplicateRecipes,
} from "@/modules/recipes/duplicates";

export async function mergeDuplicateRecipesAction(input: {
  canonicalRecipeId: string;
  duplicateRecipeId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const session = await requireSession(Role.MANAGER);
  const result = await mergeDuplicateRecipes({
    locationId: session.locationId,
    canonicalRecipeId: input.canonicalRecipeId,
    duplicateRecipeId: input.duplicateRecipeId,
  });
  revalidatePath("/dashboard");
  revalidatePath("/recipes");
  return result;
}

export async function dismissDuplicatePairAction(input: {
  recipeAId: string;
  recipeBId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const session = await requireSession(Role.MANAGER);
  const result = await dismissDuplicatePair({
    locationId: session.locationId,
    recipeAId: input.recipeAId,
    recipeBId: input.recipeBId,
    userId: session.userId,
  });
  revalidatePath("/dashboard");
  return result;
}
