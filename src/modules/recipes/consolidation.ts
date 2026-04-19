/**
 * Recipe consolidation — collapse N recipes that are really "the same
 * drink with modifiers" into ONE canonical recipe with a choice-group
 * tree. The user's original frustration: /recipes shows 5 lattes
 * (Medium Latte × 3, Latte, Large Iced Vanilla Latte) when it should
 * show ONE "Latte" with size / milk / syrup / temp modifiers.
 *
 * Flow:
 *   1. findConsolidationCandidates() — group APPROVED recipes whose
 *      variant names strip to the same bare name ("latte").
 *   2. planConsolidation() — hand the group to Groq to infer the
 *      unified base + choiceGroups that covers every sibling.
 *   3. applyConsolidationPlan() — write the plan: update canonical's
 *      components + choiceGroups, re-point PosVariationMapping rows
 *      from siblings → canonical, archive siblings.
 *
 * Depletion still works post-merge because processSaleEventById
 * infers modifier keys from the incoming variation name using the
 * choice-group vocabulary (see inferModifierKeysFromVariationName).
 */

import { MeasurementUnit, ServiceMode } from "@/lib/prisma";

import { db } from "@/lib/db";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL =
  process.env.GROQ_AI_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct";

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
  "vanilla",
  "caramel",
  "hazelnut",
  "mocha",
]);

export type ConsolidationCandidate = {
  bareName: string;
  displayLabel: string;
  recipes: Array<{
    id: string;
    variantName: string;
    menuItemName: string;
    componentCount: number;
  }>;
};

// ── Detection ───────────────────────────────────────────────────────

export async function findConsolidationCandidates(
  locationId: string
): Promise<ConsolidationCandidate[]> {
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
      _count: { select: { components: true } },
    },
  });

  const groups = new Map<string, typeof recipes>();
  for (const r of recipes) {
    const displayName =
      r.menuItemVariant.menuItem.name === r.menuItemVariant.name
        ? r.menuItemVariant.name
        : r.menuItemVariant.name;
    const bare = stripModifiers(displayName);
    if (!bare) continue;
    const arr = groups.get(bare) ?? [];
    arr.push(r);
    groups.set(bare, arr);
  }

  return [...groups.entries()]
    .filter(([, rs]) => rs.length >= 2)
    .map(([bare, rs]) => ({
      bareName: bare,
      displayLabel: toTitleCase(bare),
      recipes: rs.map((r) => ({
        id: r.id,
        variantName: r.menuItemVariant.name,
        menuItemName: r.menuItemVariant.menuItem.name,
        componentCount: r._count.components,
      })),
    }))
    .sort((a, b) => b.recipes.length - a.recipes.length);
}

// ── Planner (Groq-powered) ──────────────────────────────────────────

export type ConsolidationPlan = {
  displayLabel: string;
  summary: string;
  canonicalRecipeId: string;
  siblingRecipeIds: string[];
  base: Array<{
    inventoryItemId: string;
    inventoryItemName: string;
    componentType: "INGREDIENT" | "PACKAGING";
    quantityBase: number;
    displayUnit: MeasurementUnit;
    modifierKey: string | null;
    conditionServiceMode: ServiceMode | null;
    optional: boolean;
  }>;
  choiceGroups: Array<{
    name: string;
    groupType: "SINGLE_SELECT" | "MULTI_SELECT" | "SIZE_SCALE";
    modifierCategory: string;
    required: boolean;
    options: Array<{
      label: string;
      modifierKey: string;
      inventoryItemId: string | null;
      inventoryItemName: string | null;
      quantityBase: number;
      sizeScaleFactor: number;
      displayUnit: MeasurementUnit;
      isDefault: boolean;
    }>;
  }>;
};

export async function planConsolidation(input: {
  locationId: string;
  recipeIds: string[];
}): Promise<ConsolidationPlan | { error: string }> {
  if (input.recipeIds.length < 2) {
    return { error: "Need at least 2 recipes to consolidate." };
  }

  const recipes = await db.recipe.findMany({
    where: { id: { in: input.recipeIds }, locationId: input.locationId },
    select: {
      id: true,
      status: true,
      menuItemVariant: {
        select: {
          id: true,
          name: true,
          menuItem: { select: { name: true } },
        },
      },
      components: {
        select: {
          inventoryItemId: true,
          componentType: true,
          quantityBase: true,
          displayUnit: true,
          modifierKey: true,
          conditionServiceMode: true,
          optional: true,
          inventoryItem: { select: { name: true } },
        },
      },
      _count: { select: { components: true } },
    },
  });

  if (recipes.length !== input.recipeIds.length) {
    return { error: "Some recipes not found." };
  }

  // Canonical = recipe with the MOST components, tiebreaker oldest.
  const sorted = [...recipes].sort(
    (a, b) => b._count.components - a._count.components
  );
  const canonical = sorted[0];
  const siblings = sorted.slice(1);

  const catalog = await db.inventoryItem.findMany({
    where: { locationId: input.locationId },
    select: {
      id: true,
      name: true,
      category: true,
      baseUnit: true,
      displayUnit: true,
    },
  });

  const promptInput = {
    canonical: shapeForPrompt(canonical),
    siblings: siblings.map(shapeForPrompt),
    inventoryCatalog: catalog.map((c) => ({
      id: c.id,
      name: c.name,
      category: String(c.category),
      baseUnit: String(c.baseUnit),
      displayUnit: String(c.displayUnit),
    })),
  };

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return { error: "AI planner offline (GROQ_API_KEY missing)." };
  }

  let raw: Record<string, unknown>;
  try {
    raw = await callGroqJson({
      system: buildPlannerSystemPrompt(),
      prompt: buildPlannerUserPrompt(promptInput),
    });
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? `AI planner failed: ${err.message}`
          : "AI planner failed.",
    };
  }

  return shapePlanFromGroq({
    raw,
    canonicalRecipeId: canonical.id,
    siblingRecipeIds: siblings.map((s) => s.id),
    displayLabel: toTitleCase(
      stripModifiers(canonical.menuItemVariant.name) || "Merged recipe"
    ),
    catalog,
    allSiblingComponents: recipes.flatMap((r) =>
      r.components.map((c) => ({
        inventoryItemId: c.inventoryItemId,
        inventoryItemName: c.inventoryItem.name,
        componentType: c.componentType as "INGREDIENT" | "PACKAGING",
        quantityBase: c.quantityBase,
        displayUnit: c.displayUnit as MeasurementUnit,
      })),
    ),
  });
}

// ── Apply ───────────────────────────────────────────────────────────

export async function applyConsolidationPlan(input: {
  locationId: string;
  plan: ConsolidationPlan;
  userId: string;
}): Promise<{ ok: true; archivedCount: number } | { ok: false; reason: string }> {
  // Guard: canonical + siblings all belong to this location and are
  // APPROVED (we don't accidentally archive recipes from elsewhere).
  const count = await db.recipe.count({
    where: {
      id: { in: [input.plan.canonicalRecipeId, ...input.plan.siblingRecipeIds] },
      locationId: input.locationId,
      status: "APPROVED",
    },
  });
  if (count !== 1 + input.plan.siblingRecipeIds.length) {
    return {
      ok: false,
      reason: "Some recipes aren't in this location or already archived.",
    };
  }

  await db.$transaction(async (tx) => {
    // 1. Wipe canonical's existing components + choice groups
    //    (we're replacing them wholesale with the new tree).
    await tx.recipeComponent.deleteMany({
      where: { recipeId: input.plan.canonicalRecipeId },
    });
    await tx.recipeChoiceOption.deleteMany({
      where: { choiceGroup: { recipeId: input.plan.canonicalRecipeId } },
    });
    await tx.recipeChoiceGroup.deleteMany({
      where: { recipeId: input.plan.canonicalRecipeId },
    });

    // 2. Write the new base components.
    if (input.plan.base.length > 0) {
      await tx.recipeComponent.createMany({
        data: input.plan.base.map((c) => ({
          recipeId: input.plan.canonicalRecipeId,
          inventoryItemId: c.inventoryItemId,
          componentType: c.componentType,
          quantityBase: c.quantityBase,
          displayUnit: c.displayUnit,
          confidenceScore: 0.85,
          optional: c.optional,
          conditionServiceMode: c.conditionServiceMode,
          modifierKey: c.modifierKey,
        })),
      });
    }

    // 3. Write choice groups + options.
    for (let gi = 0; gi < input.plan.choiceGroups.length; gi += 1) {
      const g = input.plan.choiceGroups[gi];
      const created = await tx.recipeChoiceGroup.create({
        data: {
          recipeId: input.plan.canonicalRecipeId,
          name: g.name,
          groupType: g.groupType,
          modifierCategory: g.modifierCategory,
          required: g.required,
          sortOrder: gi,
        },
        select: { id: true },
      });
      if (g.options.length > 0) {
        await tx.recipeChoiceOption.createMany({
          data: g.options.map((o, oi) => ({
            choiceGroupId: created.id,
            inventoryItemId: o.inventoryItemId,
            label: o.label,
            modifierKey: o.modifierKey,
            quantityBase: o.quantityBase,
            sizeScaleFactor: o.sizeScaleFactor,
            displayUnit: o.displayUnit,
            isDefault: o.isDefault,
            sortOrder: oi,
          })),
        });
      }
    }

    // 4. Re-point every PosVariationMapping from siblings → canonical.
    await tx.posVariationMapping.updateMany({
      where: { recipeId: { in: input.plan.siblingRecipeIds } },
      data: { recipeId: input.plan.canonicalRecipeId },
    });

    // 5. Archive siblings (reversible by flipping status back).
    await tx.recipe.updateMany({
      where: { id: { in: input.plan.siblingRecipeIds } },
      data: { status: "ARCHIVED" },
    });

    // 6. Stamp a descriptive note on the canonical so there's a
    //    human-readable history record.
    await tx.recipe.update({
      where: { id: input.plan.canonicalRecipeId },
      data: {
        notes: appendNote(
          null,
          `Consolidated ${input.plan.siblingRecipeIds.length} sibling recipes on ${new Date().toISOString().slice(0, 10)}. Modifier tree: ${input.plan.choiceGroups.map((g) => g.name).join(", ") || "(none)"}.`
        ),
        approvedAt: new Date(),
        approvedById: input.userId,
        aiSummary: input.plan.summary.slice(0, 500),
      },
    });
  });

  return { ok: true, archivedCount: input.plan.siblingRecipeIds.length };
}

// ── Repair: rescue ingredients from archived siblings ──────────────

/**
 * Pre-fix merges silently dropped ingredients the planner didn't
 * re-derive. This re-hydrates a canonical recipe by unioning every
 * archived sibling's components (matched by bare name) and appending
 * anything the canonical is missing as base components.
 *
 * Scope: only ADDS missing components; never removes or reshapes
 * existing ones. Safe to run repeatedly. Does not call Groq.
 */
export async function repairConsolidatedRecipe(input: {
  locationId: string;
  recipeId: string;
}): Promise<
  | { ok: true; addedComponents: number; sourceSiblings: number }
  | { ok: false; reason: string }
> {
  const canonical = await db.recipe.findFirst({
    where: { id: input.recipeId, locationId: input.locationId },
    include: {
      menuItemVariant: { include: { menuItem: true } },
      components: true,
      choiceGroups: { include: { options: true } },
    },
  });
  if (!canonical) return { ok: false, reason: "Recipe not found." };
  const bare = stripModifiers(canonical.menuItemVariant.name);
  if (!bare) return { ok: false, reason: "Can't derive a bare name." };

  const siblings = await db.recipe.findMany({
    where: {
      locationId: input.locationId,
      status: "ARCHIVED",
      id: { not: canonical.id },
    },
    include: {
      menuItemVariant: true,
      components: { include: { inventoryItem: true } },
    },
  });
  const matching = siblings.filter(
    (s) => stripModifiers(s.menuItemVariant.name) === bare,
  );
  if (matching.length === 0) {
    return { ok: false, reason: "No archived siblings found to pull from." };
  }

  // What's already on the canonical (base components OR placed inside
  // a choice-group option) — we don't want to double up.
  const placed = new Set<string>();
  for (const c of canonical.components) placed.add(c.inventoryItemId);
  for (const g of canonical.choiceGroups) {
    for (const o of g.options) {
      if (o.inventoryItemId) placed.add(o.inventoryItemId);
    }
  }

  const byInv = new Map<
    string,
    {
      componentType: "INGREDIENT" | "PACKAGING";
      quantities: number[];
      displayUnit: MeasurementUnit;
    }
  >();
  for (const s of matching) {
    for (const c of s.components) {
      if (placed.has(c.inventoryItemId)) continue;
      const prev = byInv.get(c.inventoryItemId);
      if (prev) {
        prev.quantities.push(c.quantityBase);
      } else {
        byInv.set(c.inventoryItemId, {
          componentType: c.componentType as "INGREDIENT" | "PACKAGING",
          quantities: [c.quantityBase],
          displayUnit: c.displayUnit as MeasurementUnit,
        });
      }
    }
  }

  if (byInv.size === 0) {
    return { ok: true, addedComponents: 0, sourceSiblings: matching.length };
  }

  const rows = [...byInv.entries()].map(([invId, agg]) => {
    const sorted = [...agg.quantities].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return {
      recipeId: canonical.id,
      inventoryItemId: invId,
      componentType: agg.componentType,
      quantityBase: Math.max(1, Math.round(median)),
      displayUnit: agg.displayUnit,
      confidenceScore: 0.75,
      optional: false,
    };
  });
  await db.recipeComponent.createMany({ data: rows });

  return {
    ok: true,
    addedComponents: rows.length,
    sourceSiblings: matching.length,
  };
}

// ── Depletion helper: infer modifier keys from a variant name ──────

/**
 * When a Square sale arrives for "Medium Iced Vanilla Latte" with NO
 * modifier keys on the line, we still want the depletion engine to
 * act as if the user selected Medium + Iced + Vanilla. This function
 * scans the variant name against the choice-group option labels and
 * produces the matching modifier keys.
 *
 * Called from processSaleEventById after the real lineModifierKeys
 * are extracted; the two sets are unioned.
 */
export function inferModifierKeysFromVariationName(
  variationName: string | null | undefined,
  choiceGroups: Array<{
    options: Array<{ label: string; modifierKey: string }>;
  }>
): string[] {
  if (!variationName) return [];
  const lower = variationName.toLowerCase();
  const out = new Set<string>();
  for (const group of choiceGroups) {
    for (const opt of group.options) {
      const label = opt.label.toLowerCase().trim();
      if (!label) continue;
      // Match whole word-ish — avoid "oat" matching "boat".
      const pattern = new RegExp(
        `(^|[^a-z0-9])${escapeRegExp(label)}([^a-z0-9]|$)`,
        "i"
      );
      if (pattern.test(lower)) out.add(opt.modifierKey);
    }
  }
  return [...out];
}

// ── Internals ───────────────────────────────────────────────────────

function stripModifiers(raw: string): string {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0 && !MODIFIER_STOPWORDS.has(w))
    .join(" ")
    .trim();
}

function toTitleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function shapeForPrompt(r: {
  id: string;
  menuItemVariant: { name: string; menuItem: { name: string } };
  components: Array<{
    inventoryItemId: string;
    componentType: string;
    quantityBase: number;
    displayUnit: string;
    modifierKey: string | null;
    conditionServiceMode: ServiceMode | null;
    optional: boolean;
    inventoryItem: { name: string };
  }>;
}) {
  return {
    id: r.id,
    variantName: r.menuItemVariant.name,
    menuItemName: r.menuItemVariant.menuItem.name,
    components: r.components.map((c) => ({
      inventoryItemId: c.inventoryItemId,
      inventoryItemName: c.inventoryItem.name,
      componentType: c.componentType,
      quantityBase: c.quantityBase,
      displayUnit: c.displayUnit,
      modifierKey: c.modifierKey,
      optional: c.optional,
    })),
  };
}

function buildPlannerSystemPrompt(): string {
  return `You consolidate N café recipes that are really the same drink into ONE canonical recipe with a modifier tree. Inputs: canonical + sibling recipes + the inventory catalog. Output JSON only.

Your job is to:
 - Identify what's SHARED across all siblings → becomes "base" components (always applied).
 - Identify what VARIES → becomes "choiceGroups" with options.
 - Common groups to look for:
     Size (SIZE_SCALE) — detect size words (small/medium/large/ oz labels) that change liquid/packaging quantities.
     Milk (SINGLE_SELECT) — detect oat/almond/soy/dairy swaps in the dairy component.
     Syrup (MULTI_SELECT) — detect optional vanilla/caramel/hazelnut additions.
     Temp (SINGLE_SELECT) — detect iced vs hot (swaps cup, adds ice).
 - Use inventoryItemId values ONLY from the catalog. Drop any component whose id isn't in catalog.
 - Always set ONE option per SINGLE_SELECT / SIZE_SCALE group as isDefault=true.
 - Modifier keys must be "<category>:<value>" lowercase, e.g. milk:oat, size:medium, temp:iced, syrup:vanilla.
 - sizeScaleFactor only matters for SIZE_SCALE groups (0.8 small, 1.0 medium, 1.25 large, etc.). Default 1.0 otherwise.
 - quantityBase is the amount the OPTION adds/replaces when selected. 0 for pure SIZE_SCALE options without their own inventoryItem.

Output JSON schema:
{
  "summary": "one-sentence description of the consolidated recipe",
  "base": [
    {"inventoryItemId":"<catalog id>", "componentType":"INGREDIENT"|"PACKAGING", "quantityBase":<int>, "displayUnit":"GRAM|MILLILITER|COUNT|...", "modifierKey":null, "conditionServiceMode":null, "optional":false}
  ],
  "choiceGroups": [
    {
      "name":"Size"|"Milk"|"Syrup"|"Temp"|...,
      "groupType":"SIZE_SCALE"|"SINGLE_SELECT"|"MULTI_SELECT",
      "modifierCategory":"size"|"milk"|"syrup"|"temp"|...,
      "required":<bool>,
      "options":[
        {"label":"Small"|"Oat"|..., "modifierKey":"size:small"|"milk:oat"|..., "inventoryItemId":"<catalog id or null>", "quantityBase":<int>, "sizeScaleFactor":<float>, "displayUnit":"...", "isDefault":<bool>}
      ]
    }
  ]
}`;
}

function buildPlannerUserPrompt(input: {
  canonical: unknown;
  siblings: unknown[];
  inventoryCatalog: unknown[];
}): string {
  return `Canonical (most components, starting point):
${JSON.stringify(input.canonical)}

Siblings to fold in:
${JSON.stringify(input.siblings)}

Inventory catalog:
${JSON.stringify(input.inventoryCatalog)}

Produce the unified recipe with modifier tree.`;
}

async function callGroqJson(input: {
  system: string;
  prompt: string;
}): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.system },
          {
            role: "user",
            content: `${input.prompt}\n\nReturn valid JSON only.`,
          },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const body = (await response.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(body.error?.message ?? "Groq call failed.");
  }
  const text = body.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

function shapePlanFromGroq(input: {
  raw: Record<string, unknown>;
  canonicalRecipeId: string;
  siblingRecipeIds: string[];
  displayLabel: string;
  catalog: Array<{ id: string; name: string; displayUnit: string }>;
  allSiblingComponents: Array<{
    inventoryItemId: string;
    inventoryItemName: string;
    componentType: "INGREDIENT" | "PACKAGING";
    quantityBase: number;
    displayUnit: MeasurementUnit;
  }>;
}): ConsolidationPlan {
  const catalogById = new Map(input.catalog.map((c) => [c.id, c]));
  const raw = input.raw;
  const summary =
    typeof raw.summary === "string" ? raw.summary.slice(0, 500) : "Consolidated recipe";

  const base: ConsolidationPlan["base"] = [];
  const rawBase = Array.isArray(raw.base) ? raw.base : [];
  for (const rc of rawBase) {
    const c = rc as Record<string, unknown>;
    const id = typeof c.inventoryItemId === "string" ? c.inventoryItemId : null;
    if (!id || !catalogById.has(id)) continue;
    const ci = catalogById.get(id)!;
    base.push({
      inventoryItemId: id,
      inventoryItemName: ci.name,
      componentType: c.componentType === "PACKAGING" ? "PACKAGING" : "INGREDIENT",
      quantityBase: Math.max(1, Math.round(Number(c.quantityBase) || 0)),
      displayUnit: coerceUnit(c.displayUnit, ci.displayUnit),
      modifierKey:
        typeof c.modifierKey === "string" && c.modifierKey ? c.modifierKey : null,
      conditionServiceMode:
        c.conditionServiceMode === "DINE_IN"
          ? ServiceMode.DINE_IN
          : c.conditionServiceMode === "TO_GO"
            ? ServiceMode.TO_GO
            : null,
      optional: c.optional === true,
    });
  }

  const choiceGroups: ConsolidationPlan["choiceGroups"] = [];
  const rawGroups = Array.isArray(raw.choiceGroups) ? raw.choiceGroups : [];
  for (const rg of rawGroups) {
    const g = rg as Record<string, unknown>;
    const name = typeof g.name === "string" ? g.name.slice(0, 60) : null;
    if (!name) continue;
    const gt =
      g.groupType === "MULTI_SELECT"
        ? "MULTI_SELECT"
        : g.groupType === "SIZE_SCALE"
          ? "SIZE_SCALE"
          : "SINGLE_SELECT";
    const modifierCategory =
      typeof g.modifierCategory === "string"
        ? g.modifierCategory.toLowerCase().slice(0, 32)
        : name.toLowerCase();
    const options: ConsolidationPlan["choiceGroups"][number]["options"] = [];
    const rawOpts = Array.isArray(g.options) ? g.options : [];
    for (const ro of rawOpts) {
      const o = ro as Record<string, unknown>;
      const label = typeof o.label === "string" ? o.label.slice(0, 50) : null;
      const modifierKey =
        typeof o.modifierKey === "string" ? o.modifierKey.slice(0, 64) : null;
      if (!label || !modifierKey) continue;
      const rawItemId =
        typeof o.inventoryItemId === "string" ? o.inventoryItemId : null;
      const inventoryItemId =
        rawItemId && catalogById.has(rawItemId) ? rawItemId : null;
      const inventoryItemName = inventoryItemId
        ? catalogById.get(inventoryItemId)!.name
        : null;
      options.push({
        label,
        modifierKey,
        inventoryItemId,
        inventoryItemName,
        quantityBase: Math.max(0, Math.round(Number(o.quantityBase) || 0)),
        sizeScaleFactor:
          typeof o.sizeScaleFactor === "number" && o.sizeScaleFactor > 0
            ? Math.min(5, o.sizeScaleFactor)
            : 1.0,
        displayUnit: coerceUnit(
          o.displayUnit,
          inventoryItemId
            ? catalogById.get(inventoryItemId)!.displayUnit
            : "COUNT"
        ),
        isDefault: o.isDefault === true,
      });
    }
    if (options.length === 0) continue;
    // Guarantee one default for SINGLE_SELECT and SIZE_SCALE groups.
    if (
      (gt === "SINGLE_SELECT" || gt === "SIZE_SCALE") &&
      !options.some((o) => o.isDefault)
    ) {
      options[0].isDefault = true;
    }
    choiceGroups.push({
      name,
      groupType: gt,
      modifierCategory,
      required: g.required === true,
      options,
    });
  }

  // Safety net: if Groq dropped ingredients that exist in the siblings,
  // append them to `base` using the median sibling quantity. Losing an
  // ingredient during merge silently destroys the recipe's accuracy —
  // depletion would stop working for that component. We'd rather keep
  // a noisy base than lose data.
  const placedIds = new Set<string>();
  for (const c of base) placedIds.add(c.inventoryItemId);
  for (const g of choiceGroups) {
    for (const o of g.options) {
      if (o.inventoryItemId) placedIds.add(o.inventoryItemId);
    }
  }
  const byInvId = new Map<
    string,
    {
      componentType: "INGREDIENT" | "PACKAGING";
      quantities: number[];
      displayUnit: MeasurementUnit;
      name: string;
    }
  >();
  for (const sc of input.allSiblingComponents) {
    if (placedIds.has(sc.inventoryItemId)) continue;
    if (!input.catalog.some((c) => c.id === sc.inventoryItemId)) continue;
    const existing = byInvId.get(sc.inventoryItemId);
    if (existing) {
      existing.quantities.push(sc.quantityBase);
    } else {
      byInvId.set(sc.inventoryItemId, {
        componentType: sc.componentType,
        quantities: [sc.quantityBase],
        displayUnit: sc.displayUnit,
        name: sc.inventoryItemName,
      });
    }
  }
  for (const [invId, agg] of byInvId) {
    const sorted = [...agg.quantities].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    base.push({
      inventoryItemId: invId,
      inventoryItemName: agg.name,
      componentType: agg.componentType,
      quantityBase: Math.max(1, Math.round(median)),
      displayUnit: agg.displayUnit,
      modifierKey: null,
      conditionServiceMode: null,
      optional: false,
    });
  }

  return {
    displayLabel: input.displayLabel,
    summary,
    canonicalRecipeId: input.canonicalRecipeId,
    siblingRecipeIds: input.siblingRecipeIds,
    base,
    choiceGroups,
  };
}

function coerceUnit(raw: unknown, fallback: string): MeasurementUnit {
  const valid = Object.values(MeasurementUnit) as string[];
  if (typeof raw === "string" && valid.includes(raw)) return raw as MeasurementUnit;
  if (valid.includes(fallback)) return fallback as MeasurementUnit;
  return MeasurementUnit.COUNT;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appendNote(existing: string | null, addition: string): string {
  const sep = existing && existing.trim() ? "\n" : "";
  return `${existing ?? ""}${sep}${addition}`;
}
