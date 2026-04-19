import { MeasurementUnit, ServiceMode } from "@/lib/prisma";

import { db } from "@/lib/db";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL =
  process.env.GROQ_AI_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct";

export type DraftComponent = {
  inventoryItemId: string;
  inventoryItemName: string;
  componentType: "INGREDIENT" | "PACKAGING";
  quantityBase: number;
  displayUnit: MeasurementUnit;
  confidenceScore: number;
  optional: boolean;
  conditionServiceMode: ServiceMode | null;
  // When set, this component only applies to POS sales that carry
  // the matching modifier key (e.g. "milk:oat", "temp:iced"). Used
  // for modifier-aware composition: one Latte recipe with components
  // like Whole Milk (no key), Oat Milk (milk:oat), Ice (temp:iced)
  // etc. The depletion engine already honours this via
  // componentMatchesModifierKey in processSaleEventById.
  modifierKey: string | null;
  notes: string | null;
};

export type ProposedNewItem = {
  // Stable id the UI uses to correlate a "Create" click back to the
  // draft slot. Shape: "proposed:<slug>". Never hits the DB.
  proposalKey: string;
  name: string;
  category: string; // InventoryCategory enum string
  baseUnit: string; // GRAM | MILLILITER | COUNT
  displayUnit: string; // matches MeasurementUnit
  componentType: "INGREDIENT" | "PACKAGING";
  quantityBase: number; // how much of this proposed item the recipe needs
  modifierKey: string | null;
  conditionServiceMode: ServiceMode | null;
  optional: boolean;
  reason: string; // one-line explanation for the user
};

export type DraftState = {
  summary: string;
  components: DraftComponent[];
  proposedNewItems: ProposedNewItem[];
};

export type CatalogItem = {
  id: string;
  name: string;
  sku: string;
  category: string;
  baseUnit: string;
  displayUnit: string;
};

export type ChatTurn = { role: "user" | "assistant"; content: string };

export async function loadInventoryCatalog(
  locationId: string
): Promise<CatalogItem[]> {
  const items = await db.inventoryItem.findMany({
    where: { locationId },
    select: {
      id: true,
      name: true,
      sku: true,
      category: true,
      baseUnit: true,
      displayUnit: true,
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    sku: i.sku,
    category: String(i.category),
    baseUnit: String(i.baseUnit),
    displayUnit: String(i.displayUnit),
  }));
}

export async function draftRecipeForMapping(input: {
  locationId: string;
  menuItemName: string;
  variationName: string;
  serviceMode: ServiceMode | null;
}): Promise<DraftState> {
  const catalog = await loadInventoryCatalog(input.locationId);

  if (catalog.length === 0) {
    return {
      summary:
        "Your inventory is empty — add a few items (milk, espresso beans, cups) then try again.",
      components: [],
      proposedNewItems: [],
    };
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return {
      summary: `AI is offline — fill the recipe manually below. Menu item: ${input.menuItemName}.`,
      components: [],
      proposedNewItems: [],
    };
  }

  const systemPrompt = buildDraftSystemPrompt(catalog);
  const userPrompt = buildDraftUserPrompt(input);

  try {
    const response = await callGroqJson({
      system: systemPrompt,
      prompt: userPrompt,
    });
    return coerceDraftState(response, catalog);
  } catch {
    return {
      summary:
        "We couldn't reach the AI drafter this time — add components manually, the chat edit will retry.",
      components: [],
      proposedNewItems: [],
    };
  }
}

export async function applyChatEditToDraft(input: {
  draft: DraftState;
  userMessage: string;
  catalog: CatalogItem[];
  history: ChatTurn[];
}): Promise<{ draft: DraftState; reply: string }> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return {
      draft: input.draft,
      reply:
        "AI editing is offline — use the manual form to adjust components.",
    };
  }

  const systemPrompt = buildEditSystemPrompt(input.catalog);
  const userPrompt = buildEditUserPrompt(input);

  try {
    const response = await callGroqJson({
      system: systemPrompt,
      prompt: userPrompt,
    });
    const nextDraft = coerceDraftState(response, input.catalog);
    const reply =
      typeof (response as Record<string, unknown>).reply === "string"
        ? String((response as Record<string, unknown>).reply)
        : "Updated.";
    return { draft: nextDraft, reply };
  } catch {
    return {
      draft: input.draft,
      reply:
        "Sorry, the AI call just failed. Try rephrasing, or edit the component directly.",
    };
  }
}

export async function commitDraftedRecipe(input: {
  mappingId: string;
  locationId: string;
  draft: DraftState;
  userId: string;
}): Promise<{ recipeId: string }> {
  const mapping = await db.posVariationMapping.findFirst({
    where: { id: input.mappingId },
    select: {
      id: true,
      menuItemVariantId: true,
      menuItemVariant: { select: { menuItem: { select: { locationId: true } } } },
    },
  });

  if (!mapping) {
    throw new Error("Mapping not found.");
  }
  if (mapping.menuItemVariant.menuItem.locationId !== input.locationId) {
    throw new Error("Mapping does not belong to this location.");
  }
  if (input.draft.components.length === 0) {
    throw new Error(
      "Can't commit an empty recipe. Draft at least one component."
    );
  }

  const latest = await db.recipe.findFirst({
    where: { menuItemVariantId: mapping.menuItemVariantId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (latest?.version ?? 0) + 1;

  const recipe = await db.$transaction(async (tx) => {
    const created = await tx.recipe.create({
      data: {
        locationId: input.locationId,
        menuItemVariantId: mapping.menuItemVariantId,
        version: nextVersion,
        status: "APPROVED",
        approvedById: input.userId,
        approvedAt: new Date(),
        aiSuggestedBy: "groq",
        aiSummary: input.draft.summary.slice(0, 500),
        confidenceScore: averageConfidence(input.draft.components),
      },
      select: { id: true },
    });

    await tx.recipeComponent.createMany({
      data: input.draft.components.map((c) => ({
        recipeId: created.id,
        inventoryItemId: c.inventoryItemId,
        componentType: c.componentType,
        quantityBase: c.quantityBase,
        displayUnit: c.displayUnit,
        confidenceScore: c.confidenceScore,
        optional: c.optional,
        conditionServiceMode: c.conditionServiceMode,
        modifierKey: c.modifierKey,
        notes: c.notes,
      })),
    });

    await tx.posVariationMapping.update({
      where: { id: input.mappingId },
      data: {
        recipeId: created.id,
        mappingStatus: "READY",
      },
    });

    return created;
  });

  return { recipeId: recipe.id };
}

function buildDraftSystemPrompt(catalog: CatalogItem[]): string {
  return `You draft recipes for a café inventory app. Given a menu item, return a BOM using ONLY items in this catalog. Be conservative on quantities.

Catalog JSON:
${JSON.stringify(catalog)}

Output JSON schema:
{
  "summary": "one sentence",
  "components": [
    {
      "inventoryItemId": "<must match an id in the catalog>",
      "componentType": "INGREDIENT" | "PACKAGING",
      "quantityBase": <int, in base units>,
      "displayUnit": "GRAM" | "KILOGRAM" | "MILLILITER" | "LITER" | "COUNT",
      "confidenceScore": <0-1>,
      "optional": <bool>,
      "conditionServiceMode": "DINE_IN" | "TO_GO" | null,
      "modifierKey": "<string or null>",
      "notes": "<short note or null>"
    }
  ]
}

Rules:
- Use inventoryItemId from catalog only.
- Base units: GRAM=1g, MILLILITER=1ml, COUNT=1 each.
- Include packaging (cup, lid) when service mode is TO_GO.
- ModifierKey semantics: when a component only applies IF a POS modifier is
  selected, set modifierKey to a stable key like "milk:oat", "temp:iced",
  "size:large", "shot:extra". Leave null for components that ALWAYS apply.
- For an initial draft, default to modifierKey=null on every component —
  modifiers get added by the user via chat ("make iced swap hot cup for
  cold cup"). Don't invent modifiers unless the menu name makes them
  obvious (e.g. "Iced Latte" → temp:iced on cold cup + ice).
- Always return "proposedNewItems": [] on the initial draft. The
  initial pass should only use items already in the catalog. Proposals
  happen during chat edits when the manager explicitly asks for
  something missing.`;
}

function buildDraftUserPrompt(input: {
  menuItemName: string;
  variationName: string;
  serviceMode: ServiceMode | null;
}): string {
  return `Menu item: ${input.menuItemName}
Variation: ${input.variationName}
Service mode: ${input.serviceMode ?? "unknown"}

Draft a recipe.`;
}

function buildEditSystemPrompt(catalog: CatalogItem[]): string {
  return `You edit a drafted café recipe based on a manager's natural-language instruction. Return the FULL updated recipe plus a one-sentence reply.

Catalog:
${JSON.stringify(catalog)}

Output JSON:
{
  "reply": "one sentence",
  "summary": "...",
  "components": [<same shape as draft, includes "modifierKey" field>],
  "proposedNewItems": [
    {
      "proposalKey": "proposed:<short-slug>",
      "name": "<human name, Title Case>",
      "category": "COFFEE" | "DAIRY" | "ALT_DAIRY" | "SYRUP" | "BAKERY_INGREDIENT" | "PACKAGING" | "CLEANING" | "PAPER_GOODS" | "RETAIL" | "SEASONAL" | "SUPPLY",
      "baseUnit": "GRAM" | "MILLILITER" | "COUNT",
      "displayUnit": "GRAM" | "KILOGRAM" | "MILLILITER" | "LITER" | "COUNT",
      "componentType": "INGREDIENT" | "PACKAGING",
      "quantityBase": <int, how much the recipe needs in base units>,
      "modifierKey": "<string or null>",
      "conditionServiceMode": "DINE_IN" | "TO_GO" | null,
      "optional": <bool>,
      "reason": "<one-line explanation for the user>"
    }
  ]
}

Rules:
- Use catalog inventoryItemId values verbatim in "components".
- Preserve unchanged components exactly (including their modifierKey).

Missing inventory items:
- If the manager asks for something NOT in the catalog (e.g. "add 12 oz
  cup" when only 16 oz exists, "add paper straw" when no straw exists),
  DO NOT invent a fake inventoryItemId. Instead put it in
  "proposedNewItems" so the user can create it with one click.
- Keep "components" only for items that already exist in the catalog.
- Match category sensibly: cups/lids/sleeves/straws → PACKAGING,
  milks → DAIRY/ALT_DAIRY, coffee beans → COFFEE, syrups → SYRUP.
- Base units: a cup/lid/bottle → COUNT; milk/syrup → MILLILITER;
  beans/powder → GRAM.
- proposalKey should be short and kebab-case, prefixed with "proposed:",
  e.g. "proposed:12oz-hot-cup".
- If the user adds nothing new, return proposedNewItems: [].

Modifier-aware composition:
- The manager may add modifier-conditional components — components that
  ONLY deplete when a matching POS modifier is present. Set the
  "modifierKey" field to link them.
- Examples the manager might say:
  - "When iced, swap hot cup for cold cup and add ice"
    → Keep hot cup with modifierKey="temp:hot", add cold cup with
      modifierKey="temp:iced", add ice with modifierKey="temp:iced".
  - "If oat milk is selected, use oat milk instead of whole milk"
    → Whole milk gets modifierKey="milk:dairy" (or null if dairy is
      the default), oat milk gets modifierKey="milk:oat".
  - "Extra shot adds 18g espresso"
    → Add espresso component with modifierKey="shot:extra".
- Use consistent key patterns: "<category>:<value>". Common ones:
  milk:oat, milk:almond, milk:dairy, temp:iced, temp:hot,
  shot:extra, shot:decaf, size:small, size:large.
- Leave modifierKey null for components that should ALWAYS apply
  regardless of modifiers (the default path).`;
}

function buildEditUserPrompt(input: {
  draft: DraftState;
  userMessage: string;
  history: ChatTurn[];
}): string {
  const historyText = input.history
    .slice(-4)
    .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
    .join("\n");
  return `Current draft:
${JSON.stringify(input.draft)}

Recent chat:
${historyText || "(none)"}

Manager says: ${input.userMessage}

Return updated draft.`;
}

async function callGroqJson(input: {
  system: string;
  prompt: string;
}): Promise<unknown> {
  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.system },
        {
          role: "user",
          content: `${input.prompt}\n\nReturn valid JSON only.`,
        },
      ],
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(body.error?.message ?? "Groq request failed.");
  }

  const text = body.choices?.[0]?.message?.content ?? "";
  return JSON.parse(text) as unknown;
}

function coerceDraftState(raw: unknown, catalog: CatalogItem[]): DraftState {
  const catalogById = new Map(catalog.map((c) => [c.id, c]));
  const obj = isObj(raw) ? raw : {};
  const components: DraftComponent[] = [];
  const rawComponents = Array.isArray(obj.components) ? obj.components : [];

  for (const rc of rawComponents) {
    if (!isObj(rc)) continue;
    const id =
      typeof rc.inventoryItemId === "string" ? rc.inventoryItemId : null;
    if (!id) continue;
    const catalogItem = catalogById.get(id);
    if (!catalogItem) continue;

    const componentType =
      rc.componentType === "PACKAGING" ? "PACKAGING" : "INGREDIENT";
    const qty = Math.max(1, Math.round(Number(rc.quantityBase) || 0));
    if (!qty) continue;

    const displayUnit = coerceMeasurementUnit(
      rc.displayUnit,
      catalogItem.displayUnit
    );
    const confidence = clamp01(Number(rc.confidenceScore) || 0.7);
    const optional = rc.optional === true;
    const conditionServiceMode =
      rc.conditionServiceMode === "DINE_IN"
        ? ServiceMode.DINE_IN
        : rc.conditionServiceMode === "TO_GO"
          ? ServiceMode.TO_GO
          : null;
    const notes =
      typeof rc.notes === "string" && rc.notes.trim()
        ? rc.notes.trim().slice(0, 250)
        : null;
    const modifierKey =
      typeof rc.modifierKey === "string" && rc.modifierKey.trim()
        ? rc.modifierKey.trim().slice(0, 64)
        : null;

    components.push({
      inventoryItemId: id,
      inventoryItemName: catalogItem.name,
      componentType,
      quantityBase: qty,
      displayUnit,
      confidenceScore: confidence,
      optional,
      conditionServiceMode,
      modifierKey,
      notes,
    });
  }

  const summary =
    typeof obj.summary === "string" && obj.summary.trim()
      ? obj.summary.trim().slice(0, 500)
      : "Draft recipe.";

  const proposedNewItems: ProposedNewItem[] = [];
  const rawProposed = Array.isArray(obj.proposedNewItems)
    ? obj.proposedNewItems
    : [];
  for (const rp of rawProposed) {
    if (!isObj(rp)) continue;
    const name =
      typeof rp.name === "string" && rp.name.trim()
        ? rp.name.trim().slice(0, 80)
        : null;
    if (!name) continue;

    const proposalKey =
      typeof rp.proposalKey === "string" && rp.proposalKey.trim()
        ? rp.proposalKey.trim().slice(0, 96)
        : `proposed:${slugify(name)}`;
    const category = coerceCategory(rp.category);
    const baseUnit = coerceBaseUnit(rp.baseUnit);
    const displayUnit = coerceMeasurementUnit(rp.displayUnit, baseUnit);
    const componentType =
      rp.componentType === "PACKAGING" ? "PACKAGING" : "INGREDIENT";
    const quantityBase = Math.max(1, Math.round(Number(rp.quantityBase) || 1));
    const modifierKey =
      typeof rp.modifierKey === "string" && rp.modifierKey.trim()
        ? rp.modifierKey.trim().slice(0, 64)
        : null;
    const conditionServiceMode =
      rp.conditionServiceMode === "DINE_IN"
        ? ServiceMode.DINE_IN
        : rp.conditionServiceMode === "TO_GO"
          ? ServiceMode.TO_GO
          : null;
    const optional = rp.optional === true;
    const reason =
      typeof rp.reason === "string" && rp.reason.trim()
        ? rp.reason.trim().slice(0, 200)
        : `Manager asked to include ${name}.`;

    proposedNewItems.push({
      proposalKey,
      name,
      category,
      baseUnit,
      displayUnit,
      componentType,
      quantityBase,
      modifierKey,
      conditionServiceMode,
      optional,
      reason,
    });
  }

  return { summary, components, proposedNewItems };
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function coerceCategory(raw: unknown): string {
  const valid = [
    "COFFEE",
    "DAIRY",
    "ALT_DAIRY",
    "SYRUP",
    "BAKERY_INGREDIENT",
    "PACKAGING",
    "CLEANING",
    "PAPER_GOODS",
    "RETAIL",
    "SEASONAL",
    "SUPPLY",
  ];
  if (typeof raw === "string" && valid.includes(raw)) return raw;
  return "SUPPLY";
}

function coerceBaseUnit(raw: unknown): string {
  if (raw === "GRAM" || raw === "MILLILITER" || raw === "COUNT") return raw;
  return "COUNT";
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function coerceMeasurementUnit(
  raw: unknown,
  fallback: string
): MeasurementUnit {
  const valid = Object.values(MeasurementUnit) as string[];
  if (typeof raw === "string" && valid.includes(raw)) {
    return raw as MeasurementUnit;
  }
  if (valid.includes(fallback)) return fallback as MeasurementUnit;
  return MeasurementUnit.COUNT;
}

function averageConfidence(components: DraftComponent[]): number {
  if (components.length === 0) return 0.5;
  const sum = components.reduce((acc, c) => acc + c.confidenceScore, 0);
  return sum / components.length;
}
