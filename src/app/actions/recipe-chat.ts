"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { findConsolidationCandidates } from "@/modules/recipes/consolidation";
import { computeRecipeCost } from "@/modules/recipes/cost";
import {
  menuChatTurn,
  recipeChatTurn,
  type MenuChatAction,
  type RecipeChatOp,
} from "@/modules/recipes/chat";

export type RecipeChatTurnResult =
  | {
      ok: true;
      reply: string;
      appliedCount: number;
      operations: RecipeChatOp[];
    }
  | { ok: false; reason: string };

export async function recipeChatAction(input: {
  recipeId: string;
  userMessage: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<RecipeChatTurnResult> {
  const session = await requireSession(Role.MANAGER);
  const recipe = await db.recipe.findFirst({
    where: { id: input.recipeId, locationId: session.locationId },
    include: {
      menuItemVariant: true,
      components: { include: { inventoryItem: true } },
    },
  });
  if (!recipe) return { ok: false, reason: "Recipe not found." };

  const catalog = await db.inventoryItem.findMany({
    where: { locationId: session.locationId },
    select: {
      id: true,
      name: true,
      displayUnit: true,
      category: true,
    },
  });

  const result = await recipeChatTurn({
    recipeSnapshot: {
      id: recipe.id,
      name: recipe.menuItemVariant.name,
      summary: recipe.aiSummary ?? "",
      components: recipe.components.map((c) => ({
        id: c.id,
        inventoryItemName: c.inventoryItem.name,
        quantityBase: c.quantityBase,
        displayUnit: String(c.displayUnit),
      })),
    },
    inventoryCatalog: catalog.map((c) => ({
      id: c.id,
      name: c.name,
      displayUnit: String(c.displayUnit),
      category: String(c.category),
    })),
    history: input.history,
    userMessage: input.userMessage,
  });
  if ("error" in result) return { ok: false, reason: result.error };

  let applied = 0;
  if (result.operations.length > 0) {
    await db.$transaction(async (tx) => {
      for (const op of result.operations) {
        if (op.type === "update_quantity") {
          const r = await tx.recipeComponent.updateMany({
            where: { id: op.componentId, recipeId: recipe.id },
            data: { quantityBase: Math.max(0, op.quantityBase) },
          });
          applied += r.count;
        } else if (op.type === "remove") {
          const r = await tx.recipeComponent.deleteMany({
            where: { id: op.componentId, recipeId: recipe.id },
          });
          applied += r.count;
        } else if (op.type === "add") {
          const inv = catalog.find((c) => c.id === op.inventoryItemId);
          if (!inv) continue;
          await tx.recipeComponent.create({
            data: {
              recipeId: recipe.id,
              inventoryItemId: inv.id,
              componentType:
                inv.category === "PACKAGING" ? "PACKAGING" : "INGREDIENT",
              quantityBase: op.quantityBase,
              displayUnit: op.displayUnit,
              confidenceScore: 0.85,
              optional: false,
            },
          });
          applied += 1;
        } else if (op.type === "set_summary") {
          await tx.recipe.update({
            where: { id: recipe.id },
            data: { aiSummary: op.summary },
          });
          applied += 1;
        }
      }
    });
  }

  revalidatePath(`/recipes/${recipe.id}`);
  revalidatePath("/recipes");
  return {
    ok: true,
    reply: result.reply,
    appliedCount: applied,
    operations: result.operations,
  };
}

export type MenuChatTurnResult =
  | { ok: true; reply: string; suggestedActions: MenuChatAction[] }
  | { ok: false; reason: string };

export async function menuChatAction(input: {
  userMessage: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<MenuChatTurnResult> {
  const session = await requireSession(Role.MANAGER);

  const recipes = await db.recipe.findMany({
    where: { locationId: session.locationId, status: { not: "ARCHIVED" } },
    include: {
      menuItemVariant: true,
      components: {
        include: {
          inventoryItem: {
            include: {
              supplierItems: {
                orderBy: [{ preferred: "desc" }],
                select: { lastUnitCostCents: true, packSizeBase: true },
                take: 1,
              },
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const menuSnapshot = recipes.map((r) => {
    const cost = computeRecipeCost(
      r.components.map((c) => ({
        id: c.id,
        quantityBase: c.quantityBase,
        displayUnit: String(c.displayUnit),
        inventoryItem: c.inventoryItem,
      })),
    );
    return {
      id: r.id,
      name: r.menuItemVariant.name,
      status: String(r.status),
      componentCount: r.components.length,
      totalCostCents: cost.missingCostCount > 0 ? null : cost.totalCostCents,
    };
  });

  const candidates = await findConsolidationCandidates(session.locationId);
  const consolidationCandidates = candidates.map((c) => ({
    label: c.displayLabel,
    recipeIds: c.recipes.map((r) => r.id),
  }));

  const result = await menuChatTurn({
    menuSnapshot,
    consolidationCandidates,
    history: input.history,
    userMessage: input.userMessage,
  });
  if ("error" in result) return { ok: false, reason: result.error };

  return {
    ok: true,
    reply: result.reply,
    suggestedActions: result.suggestedActions,
  };
}
