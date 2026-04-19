"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@/lib/domain-enums";

import { db } from "@/lib/db";
import {
  BaseUnit,
  InventoryCategory,
  MeasurementUnit,
  ServiceMode,
} from "@/lib/prisma";
import { requireSession } from "@/modules/auth/session";
import {
  applyChatEditToDraft,
  commitDraftedRecipe,
  draftRecipeForMapping,
  loadInventoryCatalog,
  type ChatTurn,
  type DraftState,
  type ProposedNewItem,
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

export async function createInventoryItemForDraftAction(input: {
  mappingId: string;
  draft: DraftState;
  proposalKey: string;
}): Promise<
  | { ok: true; draft: DraftState; createdItemName: string }
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

  const proposal = input.draft.proposedNewItems.find(
    (p) => p.proposalKey === input.proposalKey
  );
  if (!proposal) {
    return { ok: false, reason: "Proposal not found in draft." };
  }

  // Create the InventoryItem with sensible defaults. We keep
  // stockOnHandBase at 0 — the user can counter later when they
  // actually receive some. Par/low thresholds start at 0 too; the
  // reorder engine won't nag until those get set properly.
  const createdItem = await db.inventoryItem.create({
    data: {
      locationId: session.locationId,
      name: proposal.name,
      sku: `AI-${Date.now().toString(36).toUpperCase()}-${slugify(proposal.name).toUpperCase().slice(0, 16)}`,
      category: coerceInventoryCategory(proposal.category),
      baseUnit: coerceBaseUnit(proposal.baseUnit),
      countUnit: coerceMeasurementUnit(proposal.displayUnit, proposal.baseUnit),
      displayUnit: coerceMeasurementUnit(proposal.displayUnit, proposal.baseUnit),
      purchaseUnit: coerceMeasurementUnit(proposal.displayUnit, proposal.baseUnit),
      parLevelBase: 0,
      lowStockThresholdBase: 0,
      safetyStockBase: 0,
      notes: `Auto-created from StockBuddy chat during recipe draft. ${proposal.reason}`,
    },
    select: { id: true, name: true },
  });

  // Update the draft in-place: add a component referencing the new
  // item, remove the proposal so it doesn't reappear.
  const newDraft: DraftState = {
    summary: input.draft.summary,
    components: [
      ...input.draft.components,
      {
        inventoryItemId: createdItem.id,
        inventoryItemName: createdItem.name,
        componentType: proposal.componentType,
        quantityBase: proposal.quantityBase,
        displayUnit: coerceMeasurementUnit(
          proposal.displayUnit,
          proposal.baseUnit
        ),
        confidenceScore: 0.6, // newly created; trust the proposal moderately
        optional: proposal.optional,
        conditionServiceMode:
          proposal.conditionServiceMode === "DINE_IN"
            ? ServiceMode.DINE_IN
            : proposal.conditionServiceMode === "TO_GO"
              ? ServiceMode.TO_GO
              : null,
        modifierKey: proposal.modifierKey,
        notes: null,
      },
    ],
    proposedNewItems: input.draft.proposedNewItems.filter(
      (p) => p.proposalKey !== input.proposalKey
    ),
  };

  revalidatePath("/inventory");
  return { ok: true, draft: newDraft, createdItemName: createdItem.name };
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function coerceInventoryCategory(raw: string): InventoryCategory {
  const valid = Object.values(InventoryCategory) as string[];
  if (valid.includes(raw)) return raw as InventoryCategory;
  return InventoryCategory.SUPPLY;
}

function coerceBaseUnit(raw: string): BaseUnit {
  if (raw === "GRAM") return BaseUnit.GRAM;
  if (raw === "MILLILITER") return BaseUnit.MILLILITER;
  return BaseUnit.COUNT;
}

function coerceMeasurementUnit(
  raw: string,
  fallbackBase: string
): MeasurementUnit {
  const valid = Object.values(MeasurementUnit) as string[];
  if (valid.includes(raw)) return raw as MeasurementUnit;
  if (fallbackBase === "GRAM") return MeasurementUnit.GRAM;
  if (fallbackBase === "MILLILITER") return MeasurementUnit.MILLILITER;
  return MeasurementUnit.COUNT;
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
