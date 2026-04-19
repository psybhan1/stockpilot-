/**
 * Duplicate-recipe detection.
 *
 * Surfaces probable duplicates (Latte vs Medium Latte vs Iced Latte)
 * on the dashboard with a one-click merge. The math:
 *
 *   similarity = 0.5 * name_similarity + 0.5 * component_overlap
 *
 * Name similarity strips common modifier prefixes (small/medium/large
 * /iced/hot/decaf/extra/oat/almond) and compares the bare base. So
 * "Medium Latte" and "Iced Latte" both collapse to "Latte" → 1.0 name
 * similarity.
 *
 * Component overlap is Jaccard on inventoryItemIds, INGREDIENTS only
 * (packaging is excluded — cups/lids are trivially shared and would
 * inflate every pair's score).
 *
 * We propose pairs only when similarity >= 0.75. Below that, too
 * much noise. A suggestion NEVER auto-merges — always Yes-click from
 * the user.
 *
 * Merge semantics:
 *  - Pick the recipe with more components as canonical (it's usually
 *    the more-complete one)
 *  - Re-point every PosVariationMapping from duplicate → canonical
 *  - Set the duplicate's status to ARCHIVED (reversible for 30 days
 *    via an un-archive path we'll wire later)
 *  - History (sales, movements) is untouched — already attributed
 *    to its own mapping, no re-processing
 */

import { db } from "@/lib/db";

const MIN_SIMILARITY = 0.75;

const MODIFIER_STOPWORDS = new Set([
  "small",
  "medium",
  "large",
  "xl",
  "reg",
  "regular",
  "hot",
  "iced",
  "frozen",
  "decaf",
  "extra",
  "double",
  "single",
  "oat",
  "almond",
  "soy",
  "coconut",
  "skim",
  "whole",
  "2%",
  "3.25%",
]);

export type DuplicateCandidate = {
  canonicalRecipeId: string;
  canonicalName: string;
  duplicateRecipeId: string;
  duplicateName: string;
  similarity: number;
  sharedIngredientsCount: number;
  rationale: string;
};

export async function findDuplicateRecipeCandidates(
  locationId: string
): Promise<DuplicateCandidate[]> {
  // Skip pairs the manager has explicitly dismissed (either direction)
  // within the last 90 days. After that we re-surface so recipe drift
  // can cause a fresh suggestion.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const dismissedRows = await db.recipeDuplicateDismissal.findMany({
    where: { locationId, dismissedAt: { gte: ninetyDaysAgo } },
    select: { recipeAId: true, recipeBId: true },
  });
  const dismissedKeys = new Set<string>();
  for (const d of dismissedRows) {
    dismissedKeys.add(dismissalKey(d.recipeAId, d.recipeBId));
  }

  const recipes = await db.recipe.findMany({
    where: { locationId, status: "APPROVED" },
    select: {
      id: true,
      menuItemVariant: {
        select: {
          name: true,
          menuItem: { select: { name: true } },
        },
      },
      components: {
        where: { componentType: "INGREDIENT" },
        select: { inventoryItemId: true },
      },
      _count: { select: { components: true } },
    },
  });

  if (recipes.length < 2) return [];

  const enriched = recipes.map((r) => {
    const menuName = r.menuItemVariant.menuItem.name.trim();
    const variantName = r.menuItemVariant.name.trim();
    // Pick whichever is longer / more specific. When variant contains
    // the menu name ("Medium Latte" vs "Latte") we keep the variant.
    // When the menu name is the richer label, use that. Prevents
    // "Latte Medium Latte" duplication in the UI.
    let displayName = variantName || menuName || "Recipe";
    if (menuName && variantName && menuName !== variantName) {
      const lowerMenu = menuName.toLowerCase();
      const lowerVar = variantName.toLowerCase();
      if (lowerVar.includes(lowerMenu)) {
        displayName = variantName;
      } else if (lowerMenu.includes(lowerVar)) {
        displayName = menuName;
      } else {
        displayName = `${menuName} · ${variantName}`;
      }
    } else if (menuName) {
      displayName = menuName;
    }
    return {
      id: r.id,
      displayName,
      bareName: stripModifiers(displayName),
      ingredientIds: new Set(r.components.map((c) => c.inventoryItemId)),
      componentCount: r._count.components,
    };
  });

  const candidates: DuplicateCandidate[] = [];
  for (let i = 0; i < enriched.length; i += 1) {
    for (let j = i + 1; j < enriched.length; j += 1) {
      const a = enriched[i];
      const b = enriched[j];
      const nameSim = stringSimilarity(a.bareName, b.bareName);
      const ingOverlap = jaccard(a.ingredientIds, b.ingredientIds);
      const score = 0.5 * nameSim + 0.5 * ingOverlap;
      if (score < MIN_SIMILARITY) continue;
      if (dismissedKeys.has(dismissalKey(a.id, b.id))) continue;

      // The fuller recipe wins as canonical.
      const [canonical, duplicate] =
        a.componentCount >= b.componentCount ? [a, b] : [b, a];

      const shared = [...canonical.ingredientIds].filter((x) =>
        duplicate.ingredientIds.has(x)
      ).length;

      candidates.push({
        canonicalRecipeId: canonical.id,
        canonicalName: canonical.displayName,
        duplicateRecipeId: duplicate.id,
        duplicateName: duplicate.displayName,
        similarity: score,
        sharedIngredientsCount: shared,
        rationale: buildRationale(canonical, duplicate, nameSim, shared),
      });
    }
  }

  candidates.sort((a, b) => b.similarity - a.similarity);
  return candidates.slice(0, 5);
}

export async function mergeDuplicateRecipes(input: {
  locationId: string;
  canonicalRecipeId: string;
  duplicateRecipeId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (input.canonicalRecipeId === input.duplicateRecipeId) {
    return { ok: false, reason: "Can't merge a recipe with itself." };
  }

  const [canonical, duplicate] = await Promise.all([
    db.recipe.findFirst({
      where: { id: input.canonicalRecipeId, locationId: input.locationId },
      select: { id: true, status: true },
    }),
    db.recipe.findFirst({
      where: { id: input.duplicateRecipeId, locationId: input.locationId },
      select: { id: true, status: true },
    }),
  ]);
  if (!canonical) return { ok: false, reason: "Canonical recipe not found." };
  if (!duplicate) return { ok: false, reason: "Duplicate recipe not found." };

  await db.$transaction(async (tx) => {
    // Re-point every mapping from duplicate → canonical so future
    // sales feed into the canonical recipe.
    await tx.posVariationMapping.updateMany({
      where: { recipeId: duplicate.id },
      data: { recipeId: canonical.id },
    });
    // Archive the duplicate (reversible by flipping back to APPROVED).
    await tx.recipe.update({
      where: { id: duplicate.id },
      data: { status: "ARCHIVED" },
    });
  });

  return { ok: true };
}

// ── Internals ───────────────────────────────────────────────────────

/** Canonical key so the dismiss table is symmetric: (A,B) == (B,A). */
function dismissalKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export async function dismissDuplicatePair(input: {
  locationId: string;
  recipeAId: string;
  recipeBId: string;
  userId: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (input.recipeAId === input.recipeBId) {
    return { ok: false, reason: "Pair must be two different recipes." };
  }
  // Normalise order so the unique index catches A/B and B/A as same.
  const [aId, bId] =
    input.recipeAId < input.recipeBId
      ? [input.recipeAId, input.recipeBId]
      : [input.recipeBId, input.recipeAId];
  await db.recipeDuplicateDismissal.upsert({
    where: {
      locationId_recipeAId_recipeBId: {
        locationId: input.locationId,
        recipeAId: aId,
        recipeBId: bId,
      },
    },
    update: {
      dismissedAt: new Date(),
      dismissedById: input.userId,
    },
    create: {
      locationId: input.locationId,
      recipeAId: aId,
      recipeBId: bId,
      dismissedById: input.userId,
    },
  });
  return { ok: true };
}

function stripModifiers(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0 && !MODIFIER_STOPWORDS.has(w))
    .join(" ")
    .trim();
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

/** Dice-Sørensen bigram similarity — 0-1, 1 = identical. */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const aBigrams = new Set<string>();
  for (let i = 0; i < a.length - 1; i += 1) aBigrams.add(a.slice(i, i + 2));
  const bBigrams = new Set<string>();
  for (let i = 0; i < b.length - 1; i += 1) bBigrams.add(b.slice(i, i + 2));
  let intersection = 0;
  for (const g of aBigrams) if (bBigrams.has(g)) intersection += 1;
  return (2 * intersection) / (aBigrams.size + bBigrams.size);
}

function buildRationale(
  canonical: { displayName: string; bareName: string; componentCount: number },
  duplicate: { displayName: string; bareName: string; componentCount: number },
  nameSim: number,
  sharedIngredients: number
): string {
  const nameWord = nameSim >= 0.9 ? "share the same name root" : "have similar names";
  return `${canonical.displayName} and ${duplicate.displayName} ${nameWord} and share ${sharedIngredients} ingredient${sharedIngredients === 1 ? "" : "s"}.`;
}
