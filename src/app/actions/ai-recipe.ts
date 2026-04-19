"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@/lib/domain-enums";

import { db } from "@/lib/db";
import { requireSession } from "@/modules/auth/session";
import {
  applyChatEditToDraft,
  commitDraftedRecipe,
  draftRecipeForMapping,
  loadInventoryCatalog,
  type ChatTurn,
  type DraftState,
} from "@/modules/recipes/ai-draft";

export async function draftRecipeAction(
  mappingId: string
): Promise<
  | { ok: true; draft: DraftState; menuItemName: string; variationName: string }
  | { ok: false; reason: string }
> {
  const session = await requireSession(Role.MANAGER);

  const mapping = await db.posVariationMapping.findFirst({
    where: { id: mappingId },
    select: {
      id: true,
      posVariation: {
        select: {
          name: true,
          serviceMode: true,
          catalogItem: { select: { name: true } },
        },
      },
      menuItemVariant: {
        select: {
          name: true,
          menuItem: { select: { name: true, locationId: true } },
        },
      },
    },
  });

  if (!mapping) return { ok: false, reason: "Mapping not found." };
  if (mapping.menuItemVariant.menuItem.locationId !== session.locationId) {
    return { ok: false, reason: "Mapping not in this location." };
  }

  const menuItemName = mapping.menuItemVariant.menuItem.name;
  const variationName =
    mapping.posVariation.name ||
    mapping.posVariation.catalogItem.name ||
    menuItemName;

  const draft = await draftRecipeForMapping({
    locationId: session.locationId,
    menuItemName,
    variationName,
    serviceMode: mapping.posVariation.serviceMode ?? null,
  });

  return { ok: true, draft, menuItemName, variationName };
}

export async function editDraftChatAction(input: {
  mappingId: string;
  draft: DraftState;
  userMessage: string;
  history: ChatTurn[];
}): Promise<
  | { ok: true; draft: DraftState; reply: string }
  | { ok: false; reason: string }
> {
  const session = await requireSession(Role.MANAGER);

  const mapping = await db.posVariationMapping.findFirst({
    where: { id: input.mappingId },
    select: {
      menuItemVariant: {
        select: { menuItem: { select: { locationId: true } } },
      },
    },
  });
  if (!mapping) return { ok: false, reason: "Mapping not found." };
  if (mapping.menuItemVariant.menuItem.locationId !== session.locationId) {
    return { ok: false, reason: "Mapping not in this location." };
  }

  const catalog = await loadInventoryCatalog(session.locationId);
  const result = await applyChatEditToDraft({
    draft: input.draft,
    userMessage: input.userMessage,
    catalog,
    history: input.history,
  });

  return { ok: true, draft: result.draft, reply: result.reply };
}

export async function commitDraftedRecipeAction(input: {
  mappingId: string;
  draft: DraftState;
}): Promise<{ ok: true; recipeId: string } | { ok: false; reason: string }> {
  const session = await requireSession(Role.MANAGER);

  try {
    const result = await commitDraftedRecipe({
      mappingId: input.mappingId,
      locationId: session.locationId,
      draft: input.draft,
      userId: session.userId,
    });
    revalidatePath(`/pos-mapping/${input.mappingId}`);
    revalidatePath("/pos-mapping");
    revalidatePath("/dashboard");
    return { ok: true, recipeId: result.recipeId };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Commit failed.",
    };
  }
}
