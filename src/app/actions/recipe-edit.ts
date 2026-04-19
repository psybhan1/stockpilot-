"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createAuditLogTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { Role } from "@/lib/domain-enums";
import { MeasurementUnit, RecipeStatus } from "@/lib/prisma";
import { requireSession } from "@/modules/auth/session";

async function assertRecipe(locationId: string, recipeId: string) {
  const recipe = await db.recipe.findFirst({
    where: { id: recipeId, locationId },
    select: { id: true },
  });
  if (!recipe) throw new Error("Recipe not found at this location.");
}

export async function saveRecipeEditsAction(input: {
  recipeId: string;
  summary: string;
  componentQuantities: Array<{ id: string; quantityBase: number }>;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const session = await requireSession(Role.MANAGER);
  try {
    await assertRecipe(session.locationId, input.recipeId);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Recipe not found.",
    };
  }

  await db.$transaction(async (tx) => {
    await tx.recipe.update({
      where: { id: input.recipeId },
      data: { aiSummary: input.summary.slice(0, 500) || null },
    });
    for (const c of input.componentQuantities) {
      const q = Math.max(0, Math.round(c.quantityBase));
      if (q <= 0) {
        await tx.recipeComponent.deleteMany({
          where: { id: c.id, recipeId: input.recipeId },
        });
      } else {
        await tx.recipeComponent.updateMany({
          where: { id: c.id, recipeId: input.recipeId },
          data: { quantityBase: q },
        });
      }
    }
    await createAuditLogTx(tx, {
      locationId: session.locationId,
      userId: session.userId,
      action: "recipe.manual_edit",
      entityType: "recipe",
      entityId: input.recipeId,
    });
  });

  revalidatePath(`/recipes/${input.recipeId}`);
  revalidatePath("/recipes");
  return { ok: true };
}

export async function addRecipeComponentAction(input: {
  recipeId: string;
  inventoryItemId: string;
  quantityBase: number;
  displayUnit: MeasurementUnit;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const session = await requireSession(Role.MANAGER);
  try {
    await assertRecipe(session.locationId, input.recipeId);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Recipe not found.",
    };
  }
  const inv = await db.inventoryItem.findFirst({
    where: { id: input.inventoryItemId, locationId: session.locationId },
    select: { id: true, category: true },
  });
  if (!inv) return { ok: false, reason: "Inventory item not found." };

  const q = Math.max(1, Math.round(input.quantityBase));
  await db.recipeComponent.create({
    data: {
      recipeId: input.recipeId,
      inventoryItemId: inv.id,
      componentType: inv.category === "PACKAGING" ? "PACKAGING" : "INGREDIENT",
      quantityBase: q,
      displayUnit: input.displayUnit,
      confidenceScore: 0.9,
      optional: false,
    },
  });

  revalidatePath(`/recipes/${input.recipeId}`);
  return { ok: true };
}

export async function removeRecipeComponentAction(input: {
  componentId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const session = await requireSession(Role.MANAGER);
  const component = await db.recipeComponent.findFirst({
    where: {
      id: input.componentId,
      recipe: { locationId: session.locationId },
    },
    select: { recipeId: true },
  });
  if (!component) return { ok: false, reason: "Component not found." };
  await db.recipeComponent.delete({ where: { id: input.componentId } });
  revalidatePath(`/recipes/${component.recipeId}`);
  return { ok: true };
}

export async function createBlankRecipeAction(input: {
  menuItemVariantId: string;
  summary: string;
}): Promise<{ ok: true; recipeId: string } | { ok: false; reason: string }> {
  const session = await requireSession(Role.MANAGER);
  const variant = await db.menuItemVariant.findFirst({
    where: {
      id: input.menuItemVariantId,
      menuItem: { locationId: session.locationId },
    },
    select: { id: true },
  });
  if (!variant) return { ok: false, reason: "Menu item variant not found." };

  const existing = await db.recipe.findFirst({
    where: {
      menuItemVariantId: variant.id,
      status: { not: RecipeStatus.ARCHIVED },
    },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, reason: "A recipe already exists for this variant." };
  }

  const recipe = await db.recipe.create({
    data: {
      locationId: session.locationId,
      menuItemVariantId: variant.id,
      version: 1,
      status: RecipeStatus.DRAFT,
      aiSummary: input.summary.slice(0, 500) || null,
      confidenceScore: 0.5,
      completenessScore: 0.2,
    },
    select: { id: true },
  });

  revalidatePath("/recipes");
  return { ok: true, recipeId: recipe.id };
}

export async function createBlankRecipeFormAction(formData: FormData) {
  const session = await requireSession(Role.MANAGER);
  const menuItemVariantId = String(formData.get("menuItemVariantId") ?? "");
  const summary = String(formData.get("summary") ?? "");
  const result = await createBlankRecipeAction({ menuItemVariantId, summary });
  if (!result.ok) {
    throw new Error(result.reason);
  }
  revalidatePath("/recipes");
  redirect(`/recipes/${result.recipeId}`);
  // Keep TypeScript happy — redirect throws.
  void session;
}
