import { BaseUnit, InventoryCategory, MeasurementUnit, SupplierOrderingMode } from "@/lib/prisma";

// ── Category parsing ──────────────────────────────────────────────────────────

const CATEGORY_MAP: Array<[RegExp, InventoryCategory]> = [
  [/coffee|espresso|bean/i, InventoryCategory.COFFEE],
  [/dairy|milk(?! alt)|cream|butter|cheese|yogurt/i, InventoryCategory.DAIRY],
  [/oat|almond|soy|coconut|alt.?dairy|plant.?based|non.?dairy/i, InventoryCategory.ALT_DAIRY],
  [/syrup|sauce|caramel|vanilla|hazelnut|pump/i, InventoryCategory.SYRUP],
  [/bakel?y|flour|sugar|egg|bread|muffin|pastry|ingredi/i, InventoryCategory.BAKERY_INGREDIENT],
  [/packag|cup|lid|straw|bag|box|wrap|foil|napkin|sleeve/i, InventoryCategory.PACKAGING],
  [/clean|soap|sanitiz|detergent|wip/i, InventoryCategory.CLEANING],
  [/paper|tissue|towel|receipt/i, InventoryCategory.PAPER_GOODS],
  [/retail|resell|gift|bottle.?sell/i, InventoryCategory.RETAIL],
  [/season|holiday|special/i, InventoryCategory.SEASONAL],
  [/produce|fruit|vegetable|fresh|banana|apple|lemon|berr|avocado|tomato|herb/i, InventoryCategory.SUPPLY],
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

  // volume: NL / Nml
  const literMatch = lower.match(/(\d+(?:\.\d+)?)\s*l(?:ite?r?)?(?:\s|s|$)/);
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

  // box / bag / bottle with count
  const countMatch = lower.match(/(\d+)\s*(?:pack|box|bag|bottle|can|jar|sachet)/);
  if (countMatch) {
    const n = parseInt(countMatch[1]);
    if (/bottle|can|jar/.test(lower)) return { packSizeBase: n, purchaseUnit: MeasurementUnit.BOTTLE };
    if (/box/.test(lower)) return { packSizeBase: n, purchaseUnit: MeasurementUnit.BOX };
    return { packSizeBase: n, purchaseUnit: MeasurementUnit.BAG };
  }

  // plain number
  const plain = parseNumber(text);
  if (plain && plain > 0) {
    return { packSizeBase: plain, purchaseUnit: baseUnit === BaseUnit.COUNT ? MeasurementUnit.COUNT : MeasurementUnit.BOX };
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
