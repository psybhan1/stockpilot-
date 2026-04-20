import { MeasurementUnit, PosProviderType, RecipeStatus } from "@/lib/prisma";
import { db } from "@/lib/db";

import type { AddRecipeData, RecipeComponentDraft, WorkflowAdvanceResult, WorkflowContext } from "./types";
import { isSkip, matchIngredientsToInventory, parseIngredientList } from "./parse-helpers";

type AddRecipeStep = "init" | "ingredients" | "unmatched_check" | "packaging";

// ── First question ────────────────────────────────────────────────────────────
export function startAddRecipe(dishName: string): { reply: string; initialData: AddRecipeData } {
  return {
    reply: [
      `Setting up the recipe for *${dishName}*! 🍽️`,
      ``,
      `Any size variants? (e.g. small/medium/large, dine-in/takeaway)`,
      `Or just say *one size* if there's only one version.`,
    ].join("\n"),
    initialData: { dishName },
  };
}

// ── Advance one step ──────────────────────────────────────────────────────────
export async function advanceAddRecipe(
  step: AddRecipeStep,
  data: AddRecipeData,
  userMessage: string,
  context: WorkflowContext
): Promise<WorkflowAdvanceResult> {
  switch (step) {
    case "init": {
      const variantName =
        isSkip(userMessage) || /one.?size|single|no variant/i.test(userMessage)
          ? "Standard"
          : userMessage.trim();
      return {
        reply: [
          `What goes into *${data.dishName}* (${variantName})?`,
          ``,
          `List all ingredients and amounts, e.g.:`,
          `*2 bananas, 200ml oat milk, 15g honey, 1 cup ice*`,
        ].join("\n"),
        done: false,
        nextStep: "ingredients",
        updatedData: { ...data, variantName },
      };
    }

    case "ingredients": {
      if (context.inventoryItems.length === 0) {
        return {
          reply: `You don't have any inventory items yet. Add items first, then set up recipes.`,
          done: true,
          updatedData: data,
        };
      }

      const parsed = await parseIngredientList(userMessage);
      if (parsed.length === 0) {
        return {
          reply: `I couldn't parse that ingredient list. Try something like:\n*2 bananas, 200ml oat milk, 15g honey*`,
          done: false,
          nextStep: "ingredients",
          updatedData: data,
        };
      }

      const { matched, unmatched } = matchIngredientsToInventory(parsed, context.inventoryItems);
      const components: RecipeComponentDraft[] = matched.map((m) => ({
        inventoryItemId: m.inventoryItemId,
        inventoryItemName: m.inventoryItemName,
        quantityBase: m.quantityBase,
        displayUnit: m.displayUnit,
        componentType: "INGREDIENT" as const,
      }));

      if (unmatched.length > 0) {
        return {
          reply: [
            `I matched ${matched.length} ingredient${matched.length !== 1 ? "s" : ""} ✓`,
            ``,
            `I couldn't find these in your inventory: *${unmatched.join(", ")}*`,
            ``,
            `Say *skip* to ignore them, or add them to inventory first then redo this recipe.`,
          ].join("\n"),
          done: false,
          nextStep: "unmatched_check",
          updatedData: { ...data, components, pendingUnmatched: unmatched },
        };
      }

      return {
        reply: `Any packaging for *${data.dishName}*? (e.g. cup, lid, straw)\nOr say *no* to skip.`,
        done: false,
        nextStep: "packaging",
        updatedData: { ...data, components },
      };
    }

    case "unmatched_check": {
      // User said skip or acknowledged unmatched items
      const components = (data.components ?? []) as RecipeComponentDraft[];
      return {
        reply: `Any packaging for *${data.dishName}*? (e.g. cup, lid, straw)\nOr say *no* to skip.`,
        done: false,
        nextStep: "packaging",
        updatedData: { ...data, pendingUnmatched: undefined },
      };
    }

    case "packaging": {
      const components = (data.components ?? []) as RecipeComponentDraft[];

      if (!isSkip(userMessage) && !/^no$/i.test(userMessage.trim())) {
        // Try to match packaging items
        const parsed = await parseIngredientList(userMessage);
        if (parsed.length > 0) {
          const { matched } = matchIngredientsToInventory(parsed, context.inventoryItems);
          for (const m of matched) {
            components.push({
              inventoryItemId: m.inventoryItemId,
              inventoryItemName: m.inventoryItemName,
              quantityBase: m.quantityBase,
              displayUnit: m.displayUnit,
              componentType: "PACKAGING",
            });
          }
        }
      }

      const created = await executeAddRecipe({ ...data, components }, context);
      return {
        reply: created.reply,
        done: true,
        updatedData: { ...data, components },
      };
    }
  }
}

// ── DB write ──────────────────────────────────────────────────────────────────
export async function executeAddRecipe(
  data: AddRecipeData,
  context: WorkflowContext
): Promise<{ reply: string }> {
  const dishName = String(data.dishName ?? "Unknown dish");
  const variantName = String(data.variantName ?? "Standard");
  const components = (data.components ?? []) as RecipeComponentDraft[];

  // Create MenuItem (manual source)
  const menuItem = await db.menuItem.create({
    data: {
      locationId: context.locationId,
      name: dishName,
      source: PosProviderType.MANUAL,
    },
    select: { id: true },
  });

  // Create MenuItemVariant
  const variant = await db.menuItemVariant.create({
    data: {
      menuItemId: menuItem.id,
      name: variantName,
      active: true,
      sortOrder: 0,
    },
    select: { id: true },
  });

  // Get current recipe version count for this variant (should be 0 for new)
  const version = 1;

  // Create Recipe
  const recipe = await db.recipe.create({
    data: {
      locationId: context.locationId,
      menuItemVariantId: variant.id,
      version,
      status: RecipeStatus.APPROVED,
      completenessScore: components.length > 0 ? 0.8 : 0.1,
      confidenceScore: 0.85,
    },
    select: { id: true },
  });

  // Create RecipeComponents
  if (components.length > 0) {
    await db.recipeComponent.createMany({
      data: components.map((c) => ({
        recipeId: recipe.id,
        inventoryItemId: c.inventoryItemId,
        componentType: c.componentType,
        quantityBase: c.quantityBase,
        displayUnit: c.displayUnit as MeasurementUnit,
        confidenceScore: 0.85,
      })),
    });
  }

  const ingredientLines = components
    .filter((c) => c.componentType === "INGREDIENT")
    .map((c) => `• ${c.quantityBase} ${c.displayUnit.toLowerCase()} ${c.inventoryItemName}`)
    .join("\n");

  const packagingLines = components
    .filter((c) => c.componentType === "PACKAGING")
    .map((c) => `• ${c.inventoryItemName}`)
    .join("\n");

  return {
    reply: [
      `✅ Recipe for *${dishName}* (${variantName}) saved!`,
      ``,
      ingredientLines ? `Ingredients:\n${ingredientLines}` : "No ingredients linked.",
      packagingLines ? `\nPackaging:\n${packagingLines}` : "",
      ``,
      `Every time a *${dishName}* is sold, I'll automatically deduct these ingredients from your stock. 📊`,
    ]
      .filter((l) => l !== "")
      .join("\n"),
  };
}
