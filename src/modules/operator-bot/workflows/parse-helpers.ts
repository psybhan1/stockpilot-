import { BaseUnit, InventoryCategory, MeasurementUnit, SupplierOrderingMode } from "../../../lib/domain-enums";

// ── Category parsing ──────────────────────────────────────────────────────────

const CATEGORY_MAP: Array<[RegExp, InventoryCategory]> = [
  [/coffee|espresso|bean/i, InventoryCategory.COFFEE],
  // Syrup / sauce — checked BEFORE dairy/alt-dairy so "coconut syrup" / "vanilla syrup"
  // land in SYRUP instead of ALT_DAIRY (coconut) or DAIRY (vanilla-cream).
  [/syrup|sauce|caramel|pump(?:kin)?\s+spice/i, InventoryCategory.SYRUP],
  [/(?:hazelnut|vanilla|caramel|coconut|almond|maple)\s+(?:syrup|sauce|flavou?r|shot)/i, InventoryCategory.SYRUP],
  // Alt-dairy — MUST come before DAIRY, otherwise DAIRY's "milk|cream" swallows
  // "oat milk", "soy cream", "almond milk" etc. before the alt-dairy rule sees them.
  [/(?:oat|almond|soy|coconut|cashew|rice|hemp)\s+(?:milk|cream|yogh?urt)|alt.?dairy|plant.?based|non.?dairy/i, InventoryCategory.ALT_DAIRY],
  [/dairy|milk(?! alt)|cream|butter|cheese|yogurt/i, InventoryCategory.DAIRY],
  // Bakery / ingredient — nuts, seeds, grains treated as baking ingredients
  [/bakel?y|flour|sugar|egg|bread|muffin|pastry|ingredi|nut|seed|grain|hazelnut|walnut|almond\s+flour|pecan|cashew|pistachio/i, InventoryCategory.BAKERY_INGREDIENT],
  [/packag|cup|lid|straw|bag|box|wrap|foil|napkin|sleeve/i, InventoryCategory.PACKAGING],
  [/clean|soap|sanitiz|detergent|wip/i, InventoryCategory.CLEANING],
  [/paper|tissue|towel|receipt/i, InventoryCategory.PAPER_GOODS],
  [/retail|resell|gift|bottle.?sell/i, InventoryCategory.RETAIL],
  [/season|holiday|special/i, InventoryCategory.SEASONAL],
  // Produce / fresh
  [/produce|fruit|vegetable|fresh|banana|apple|lemon|berr|avocado|tomato|herb|carrot|potato|onion|garlic|ginger|spinach|lettuce|mango|orange|lime|celery|cucumber/i, InventoryCategory.SUPPLY],
  [/supply|misc|other/i, InventoryCategory.SUPPLY],
];

export function parseCategory(text: string): InventoryCategory | null {
  const lower = text.toLowerCase().trim();
  for (const [pattern, category] of CATEGORY_MAP) {
    if (pattern.test(lower)) return category;
  }
  return null;
}

export function categoryLabel(cat: InventoryCategory): string {
  const labels: Record<InventoryCategory, string> = {
    COFFEE: "Coffee",
    DAIRY: "Dairy",
    ALT_DAIRY: "Alt dairy / plant-based milk",
    SYRUP: "Syrup / sauce",
    BAKERY_INGREDIENT: "Bakery / ingredient",
    PACKAGING: "Packaging",
    CLEANING: "Cleaning supplies",
    PAPER_GOODS: "Paper goods",
    RETAIL: "Retail",
    SEASONAL: "Seasonal",
    SUPPLY: "Produce / supply",
  };
  return labels[cat] ?? cat;
}

// ── Base unit parsing ─────────────────────────────────────────────────────────

export function parseBaseUnit(text: string): BaseUnit | null {
  const lower = text.toLowerCase().trim();
  if (/^g$|gram|kilogram|kg\b|weight/i.test(lower)) return BaseUnit.GRAM;
  if (/^ml$|milliliter|liter|litre|fluid|liquid|^l\b/i.test(lower)) return BaseUnit.MILLILITER;
  if (/count|unit|piece|individual|each|item|portion|^ct$|^pc$/i.test(lower)) return BaseUnit.COUNT;
  return null;
}

export function baseUnitLabel(unit: BaseUnit): string {
  return unit === BaseUnit.GRAM ? "grams" : unit === BaseUnit.MILLILITER ? "ml" : "units";
}

// ── Number parsing ────────────────────────────────────────────────────────────

export function parseNumber(text: string): number | null {
  const cleaned = text.replace(/,/g, "").trim();
  const match = cleaned.match(/^[~≈]?\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = parseFloat(match[1]);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

// ── Pack size parsing ─────────────────────────────────────────────────────────

type PackSizeResult = {
  packSizeBase: number;
  purchaseUnit: MeasurementUnit;
};

/**
 * Parses things like:
 *  "1L bottles"       → { packSizeBase: 1000, purchaseUnit: BOTTLE }
 *  "500ml cans"       → { packSizeBase: 500,  purchaseUnit: BOTTLE }
 *  "1kg bags"         → { packSizeBase: 1000, purchaseUnit: BAG    }
 *  "individual units" → { packSizeBase: 1,    purchaseUnit: COUNT  }
 *  "cases of 12"      → { packSizeBase: 12,   purchaseUnit: CASE   }
 *  "100g sachets"     → { packSizeBase: 100,  purchaseUnit: BAG    }
 */
export function parsePackSize(text: string, baseUnit: BaseUnit): PackSizeResult {
  const lower = text.toLowerCase().trim();

  // individual / each / single
  if (/individual|single|each|unit|piece|^1$/.test(lower)) {
    return { packSizeBase: 1, purchaseUnit: MeasurementUnit.COUNT };
  }

  // case of N
  const caseMatch = lower.match(/case[s]?\s+of\s+(\d+)/);
  if (caseMatch) {
    return { packSizeBase: parseInt(caseMatch[1]), purchaseUnit: MeasurementUnit.CASE };
  }

  // volume: NL / Nml — accept "L", "liter(s)", "litre(s)" (British spelling)
  const literMatch = lower.match(/(\d+(?:\.\d+)?)\s*l(?:it(?:er|re))?s?(?:\s|$)/);
  if (literMatch && baseUnit === BaseUnit.MILLILITER) {
    return { packSizeBase: Math.round(parseFloat(literMatch[1]) * 1000), purchaseUnit: MeasurementUnit.BOTTLE };
  }
  const mlMatch = lower.match(/(\d+(?:\.\d+)?)\s*ml/);
  if (mlMatch && baseUnit === BaseUnit.MILLILITER) {
    return { packSizeBase: Math.round(parseFloat(mlMatch[1])), purchaseUnit: MeasurementUnit.BOTTLE };
  }

  // weight: Nkg / Ng
  const kgMatch = lower.match(/(\d+(?:\.\d+)?)\s*kg/);
  if (kgMatch && baseUnit === BaseUnit.GRAM) {
    return { packSizeBase: Math.round(parseFloat(kgMatch[1]) * 1000), purchaseUnit: MeasurementUnit.BAG };
  }
  const gMatch = lower.match(/(\d+(?:\.\d+)?)\s*g(?:ram)?/);
  if (gMatch && baseUnit === BaseUnit.GRAM) {
    return { packSizeBase: Math.round(parseFloat(gMatch[1])), purchaseUnit: MeasurementUnit.BAG };
  }

  // container with count — order matches the bare-container fallback below
  // so "12 cases" / "6 cartons" / "3 trays" don't drop through to the plain
  // number branch and come back as COUNT when the user clearly said CASE/BOX.
  const countMatch = lower.match(/(\d+)\s*(?:pack|box|bag|bottle|can|jar|sachet|case|crate|tray|carton)/);
  if (countMatch) {
    const n = parseInt(countMatch[1]);
    if (/case|crate|tray/.test(lower)) return { packSizeBase: n, purchaseUnit: MeasurementUnit.CASE };
    if (/bottle|can|jar/.test(lower)) return { packSizeBase: n, purchaseUnit: MeasurementUnit.BOTTLE };
    if (/box|carton/.test(lower)) return { packSizeBase: n, purchaseUnit: MeasurementUnit.BOX };
    return { packSizeBase: n, purchaseUnit: MeasurementUnit.BAG };
  }

  // plain number
  const plain = parseNumber(text);
  if (plain && plain > 0) {
    return { packSizeBase: plain, purchaseUnit: baseUnit === BaseUnit.COUNT ? MeasurementUnit.COUNT : MeasurementUnit.BOX };
  }

  // bare container word (no number, no quantity) — fall back to a single container
  // with the base unit as pack size; purchase unit reflects what the user said.
  if (/bottle|can|jar/.test(lower)) {
    return { packSizeBase: 1, purchaseUnit: MeasurementUnit.BOTTLE };
  }
  if (/\bbag\b|sachet|pouch/.test(lower)) {
    return { packSizeBase: 1, purchaseUnit: MeasurementUnit.BAG };
  }
  if (/\bbox\b|carton/.test(lower)) {
    return { packSizeBase: 1, purchaseUnit: MeasurementUnit.BOX };
  }
  if (/\bcase\b|crate|tray/.test(lower)) {
    return { packSizeBase: 1, purchaseUnit: MeasurementUnit.CASE };
  }

  // fallback: pack of 1
  return { packSizeBase: 1, purchaseUnit: MeasurementUnit.COUNT };
}

// ── Ordering mode parsing ─────────────────────────────────────────────────────

export function parseOrderingMode(text: string): SupplierOrderingMode | null {
  const lower = text.toLowerCase().trim();
  if (/email|mail/i.test(lower)) return SupplierOrderingMode.EMAIL;
  if (/web|site|online|portal|url|link/i.test(lower)) return SupplierOrderingMode.WEBSITE;
  if (/manual|phone|call|text|whatsapp|myself|direct/i.test(lower)) return SupplierOrderingMode.MANUAL;
  return null;
}

// ── Supplier fuzzy match ──────────────────────────────────────────────────────

export function fuzzyMatchSupplier(
  name: string,
  suppliers: Array<{ id: string; name: string }>
): { id: string; name: string } | null {
  const lower = name.toLowerCase().trim();
  if (!lower || lower === "none" || lower === "skip" || lower === "no") return null;

  // Exact match first
  const exact = suppliers.find((s) => s.name.toLowerCase() === lower);
  if (exact) return exact;

  // Contains match
  const contains = suppliers.find(
    (s) => s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase())
  );
  return contains ?? null;
}

// ── Ingredient list parsing (Groq-assisted) ───────────────────────────────────

type ParsedIngredient = {
  rawName: string;
  quantity: number;
  unit: MeasurementUnit;
};

/**
 * Uses Groq to parse a free-text ingredient list like:
 * "2 bananas, 200ml oat milk, 15g honey, 1 cup ice"
 * Returns structured ingredient objects.
 */
export async function parseIngredientList(text: string): Promise<ParsedIngredient[]> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return [];

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You parse ingredient lists from recipe descriptions.",
              "Valid units are: GRAM, KILOGRAM, MILLILITER, LITER, COUNT, CASE, BOTTLE, BAG, BOX.",
              "For cups/tablespoons/teaspoons, convert to ml (1 cup=240ml, 1tbsp=15ml, 1tsp=5ml).",
              "For 'each', 'piece', 'unit' use COUNT.",
              "Return JSON with one key: ingredients — array of {rawName, quantity, unit}.",
            ].join(" "),
          },
          {
            role: "user",
            content: `Parse this ingredient list:\n${text}\n\nReturn valid JSON only.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!raw) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(raw) as { ingredients?: any[] };
    if (!Array.isArray(parsed.ingredients)) return [];

    return parsed.ingredients
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((i: any) => typeof i.rawName === "string" && typeof i.quantity === "number")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((i: any) => ({
        rawName: String(i.rawName).trim().toLowerCase(),
        quantity: Math.max(1, Math.round(Number(i.quantity))),
        unit: Object.values(MeasurementUnit).includes(i.unit) ? i.unit : MeasurementUnit.COUNT,
      }));
  } catch {
    return [];
  }
}

/**
 * Matches parsed ingredients to known inventory items by name similarity.
 * Returns matched items and a list of unmatched names.
 */
export function matchIngredientsToInventory(
  parsed: ParsedIngredient[],
  inventoryItems: Array<{ id: string; name: string; sku: string }>
): {
  matched: Array<{
    inventoryItemId: string;
    inventoryItemName: string;
    quantityBase: number;
    displayUnit: MeasurementUnit;
  }>;
  unmatched: string[];
} {
  const matched = [];
  const unmatched = [];

  for (const ingredient of parsed) {
    const lower = ingredient.rawName.toLowerCase();
    const item = inventoryItems.find((inv) => {
      const invLower = inv.name.toLowerCase();
      return invLower === lower || invLower.includes(lower) || lower.includes(invLower);
    });

    if (item) {
      matched.push({
        inventoryItemId: item.id,
        inventoryItemName: item.name,
        quantityBase: ingredient.quantity,
        displayUnit: ingredient.unit,
      });
    } else {
      unmatched.push(ingredient.rawName);
    }
  }

  return { matched, unmatched };
}

// ── Smart item-default suggestion (Groq-backed) ──────────────────────────────

export type ItemDefaults = {
  baseUnit: BaseUnit;
  parLevel: number;
  packText: string;
  /** Optional LLM-corrected category. Null when the LLM agrees with the input. */
  category: InventoryCategory | null;
};

/**
 * Given a partial picture of a new inventory item (name + optional brand /
 * usage / category), asks Groq to suggest sensible defaults for how it's
 * measured, a typical par level for a small café/restaurant, and a typical
 * supplier pack size. Falls back to safe defaults if Groq is unavailable.
 */
export async function suggestItemDefaults(input: {
  name: string;
  brand?: string | null;
  usage?: string | null;
  storage?: string | null;
  category?: InventoryCategory | null;
}): Promise<ItemDefaults> {
  const fallback: ItemDefaults = {
    baseUnit: BaseUnit.COUNT,
    parLevel: 10,
    packText: "individual units",
    category: null,
  };
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return fallback;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: process.env.GROQ_BOT_MODEL ?? "llama-3.3-70b-versatile",
        temperature: 0.1,
        max_tokens: 250,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You suggest sensible inventory defaults for a small café/restaurant.",
              "Given an item, output JSON: {category, baseUnit, parLevel, packText}.",
              "category ∈ {COFFEE, DAIRY, ALT_DAIRY, SYRUP, BAKERY_INGREDIENT, PACKAGING, CLEANING, PAPER_GOODS, RETAIL, SEASONAL, SUPPLY}.",
              "Choose category based on what the item ACTUALLY is. E.g. 'coconut syrup' is SYRUP (not ALT_DAIRY — ALT_DAIRY is for milks like oat/almond/soy/coconut MILK). 'Oat milk' is ALT_DAIRY. 'Coffee beans' is COFFEE. 'Bananas' is SUPPLY.",
              "baseUnit ∈ {GRAM, MILLILITER, COUNT}.",
              "parLevel = a reasonable weekly par in base units (e.g. 5000 grams of coffee, 10000 ml of milk, 50 count bananas).",
              "packText = how it's typically ordered from a wholesaler (e.g. '1kg bags', '1L bottles', 'cases of 12', 'individual units').",
              "Keep parLevel realistic for a small business — not a warehouse.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({
              name: input.name,
              brand: input.brand ?? null,
              usage: input.usage ?? null,
              storage: input.storage ?? null,
              category: input.category ?? null,
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return fallback;
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as {
      category?: string;
      baseUnit?: string;
      parLevel?: number;
      packText?: string;
    };

    const baseUnit =
      parsed.baseUnit === "GRAM" || parsed.baseUnit === "MILLILITER" || parsed.baseUnit === "COUNT"
        ? (parsed.baseUnit as BaseUnit)
        : fallback.baseUnit;
    const parLevel =
      typeof parsed.parLevel === "number" && parsed.parLevel > 0 && parsed.parLevel < 1_000_000
        ? Math.round(parsed.parLevel)
        : fallback.parLevel;
    const packText = typeof parsed.packText === "string" && parsed.packText.trim()
      ? parsed.packText.trim()
      : fallback.packText;
    const validCategories = Object.values(InventoryCategory) as string[];
    const category =
      typeof parsed.category === "string" && validCategories.includes(parsed.category)
        ? (parsed.category as InventoryCategory)
        : null;

    return { baseUnit, parLevel, packText, category };
  } catch {
    return fallback;
  }
}

// ── SKU generation ────────────────────────────────────────────────────────────

export function generateSku(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${slug}-${suffix}`;
}

// ── "skip" detection ──────────────────────────────────────────────────────────

export function isSkip(text: string): boolean {
  return /^(skip|none|no|n\/a|-)$/i.test(text.trim());
}

// ── measurementUnit → BaseUnit conversion for display ────────────────────────

export function measurementUnitFromBaseUnit(base: BaseUnit): MeasurementUnit {
  if (base === BaseUnit.GRAM) return MeasurementUnit.GRAM;
  if (base === BaseUnit.MILLILITER) return MeasurementUnit.MILLILITER;
  return MeasurementUnit.COUNT;
}
