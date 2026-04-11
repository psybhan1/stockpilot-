import { MeasurementUnit, ServiceMode } from "@/lib/prisma";

import { buildRecipeSuggestion } from "@/modules/recipes/suggestions";
import type { AiProvider, AssistantAnswer, RecipeSuggestion } from "@/providers/contracts";

type OpenAiProviderOptions = {
  apiKey: string;
  model: string;
  baseUrl: string;
};

export class OpenAiProvider implements AiProvider {
  constructor(private readonly options: OpenAiProviderOptions) {}

  async suggestRecipe(input: {
    menuItemName: string;
    variationName: string;
    serviceMode?: ServiceMode | null;
  }) {
    const fallback = buildRecipeSuggestion(input.variationName || input.menuItemName);

    try {
      const suggestion = await this.createJsonCompletion<Partial<RecipeSuggestion>>({
        system:
          "You suggest recipe and BOM mappings for a cafe inventory system. Return compact JSON only, be conservative, and prefer manager-reviewable defaults over guessing.",
        prompt: `Menu item: ${input.menuItemName}
Variation: ${input.variationName}
Service mode: ${input.serviceMode ?? "unknown"}

Return JSON with:
- summary: string
- confidenceScore: number between 0 and 1
- components: array of objects with
  - inventorySku: string
  - componentType: "INGREDIENT" | "PACKAGING"
  - quantityBase: integer
  - displayUnit: "GRAM" | "KILOGRAM" | "MILLILITER" | "LITER" | "COUNT" | "CASE" | "BOTTLE" | "BAG"
  - suggestedMinBase?: integer
  - suggestedMaxBase?: integer
  - confidenceScore: number between 0 and 1
  - conditionServiceMode?: "DINE_IN" | "TO_GO"
  - optional?: boolean
  - notes?: string

Prefer common cafe SKUs like:
- INV-BEANS-ESP
- INV-MILK-DAIRY
- INV-OAT-01
- INV-SYR-VAN
- INV-MATCHA-01
- INV-CHOC-01
- INV-CUP-HOT-16
- INV-LID-HOT-16
- INV-SLEEVE-01`,
      });

      return coerceRecipeSuggestion(suggestion, fallback);
    } catch {
      return fallback;
    }
  }

  async explainRisk(input: {
    inventoryName: string;
    daysLeft: number | null;
    projectedRunoutAt: Date | null;
  }) {
    return this.createTextCompletion({
      system:
        "You explain inventory risk for cafe managers in concise operational language. Be direct, practical, and avoid hype.",
      prompt: `Inventory item: ${input.inventoryName}
Days left: ${input.daysLeft ?? "unknown"}
Projected runout: ${input.projectedRunoutAt?.toISOString() ?? "unknown"}

Explain the stock risk in 1-2 sentences.`,
    });
  }

  async explainReorder(input: {
    inventoryName: string;
    projectedRunoutAt: Date | null;
    recommendedPackCount: number;
    recommendedUnit: MeasurementUnit;
  }) {
    return this.createTextCompletion({
      system:
        "You explain reorder recommendations for physical-business managers. Keep the explanation concise, concrete, and approval-friendly.",
      prompt: `Inventory item: ${input.inventoryName}
Projected runout: ${input.projectedRunoutAt?.toISOString() ?? "unknown"}
Recommended quantity: ${input.recommendedPackCount} ${input.recommendedUnit.toLowerCase()}

Explain why this reorder makes sense in 1-2 sentences.`,
    });
  }

  async draftSupplierMessage(input: {
    supplierName: string;
    orderNumber: string;
    lines: Array<{ description: string; quantity: number; unit: string }>;
  }) {
    const content = await this.createJsonCompletion<{
      subject: string;
      body: string;
    }>({
      system:
        "You draft professional purchase-order emails for hospitality suppliers. Return compact JSON only.",
      prompt: `Supplier: ${input.supplierName}
Order number: ${input.orderNumber}
Lines: ${input.lines.map((line) => `${line.quantity} ${line.unit} ${line.description}`).join("; ")}

Return JSON with:
- subject
- body`,
    });

    return {
      subject: content.subject || `Purchase order ${input.orderNumber}`,
      body:
        content.body ||
        `Hello ${input.supplierName},\n\nPlease confirm PO ${input.orderNumber}.\n\nThank you,\nStockPilot`,
    };
  }

  async answerOpsQuery(input: {
    question: string;
    summary: {
      lowStockItems: string[];
      pendingApprovals: string[];
      recentAnomalies: string[];
    };
  }) {
    return this.createJsonCompletion<AssistantAnswer>({
      system:
        "You are the StockPilot operations assistant. Answer with concise, operationally trustworthy guidance. Return JSON only.",
      prompt: `Question: ${input.question}

Current low stock items: ${input.summary.lowStockItems.join(", ") || "none"}
Pending approvals: ${input.summary.pendingApprovals.join(", ") || "none"}
Recent anomalies: ${input.summary.recentAnomalies.join(", ") || "none"}

Return JSON with:
- answer: string
- suggestedActions: string[]`,
    });
  }

  private async createTextCompletion(input: {
    system: string;
    prompt: string;
  }) {
    const response = await this.requestChatCompletion({
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.prompt },
      ],
    });

    return extractAssistantText(response);
  }

  private async createJsonCompletion<T>(input: {
    system: string;
    prompt: string;
  }) {
    const response = await this.requestChatCompletion({
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: `${input.prompt}\n\nReturn valid JSON only.` },
      ],
    });

    const rawText = extractAssistantText(response);
    return JSON.parse(rawText) as T;
  }

  private async requestChatCompletion(body: Record<string, unknown>) {
    const response = await fetch(
      `${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0.2,
          ...body,
        }),
      }
    );

    const payload = (await response.json().catch(() => ({}))) as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }>;
        };
      }>;
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(payload.error?.message ?? "OpenAI request failed.");
    }

    return payload;
  }
}

function coerceRecipeSuggestion(
  candidate: Partial<RecipeSuggestion>,
  fallback: RecipeSuggestion
): RecipeSuggestion {
  const components: RecipeSuggestion["components"] = [];

  if (Array.isArray(candidate.components)) {
    for (const component of candidate.components) {
      if (!component || typeof component !== "object") {
        continue;
      }

      const entry = component as Record<string, unknown>;
      const inventorySku =
        typeof entry.inventorySku === "string" && entry.inventorySku.trim()
          ? entry.inventorySku.trim()
          : null;
      const componentType =
        entry.componentType === "PACKAGING"
          ? "PACKAGING"
          : entry.componentType === "INGREDIENT"
            ? "INGREDIENT"
            : null;
      const quantityBase = Number(entry.quantityBase);
      const displayUnit = parseMeasurementUnit(entry.displayUnit);

      if (!inventorySku || !componentType || !Number.isFinite(quantityBase) || !displayUnit) {
        continue;
      }

      components.push({
        inventorySku,
        componentType,
        quantityBase: Math.max(1, Math.round(quantityBase)),
        displayUnit,
        suggestedMinBase: parseOptionalInteger(entry.suggestedMinBase),
        suggestedMaxBase: parseOptionalInteger(entry.suggestedMaxBase),
        confidenceScore: clampScore(Number(entry.confidenceScore), 0.75),
        conditionServiceMode: parseServiceMode(entry.conditionServiceMode),
        optional: entry.optional === true,
        notes: typeof entry.notes === "string" ? entry.notes.trim() || undefined : undefined,
      });
    }
  }

  if (components.length === 0) {
    return fallback;
  }

  return {
    summary:
      typeof candidate.summary === "string" && candidate.summary.trim()
        ? candidate.summary.trim()
        : fallback.summary,
    confidenceScore: clampScore(Number(candidate.confidenceScore), fallback.confidenceScore),
    components,
  };
}

function parseMeasurementUnit(value: unknown) {
  switch (value) {
    case MeasurementUnit.GRAM:
    case MeasurementUnit.KILOGRAM:
    case MeasurementUnit.MILLILITER:
    case MeasurementUnit.LITER:
    case MeasurementUnit.COUNT:
    case MeasurementUnit.CASE:
    case MeasurementUnit.BOTTLE:
    case MeasurementUnit.BAG:
      return value as RecipeSuggestion["components"][number]["displayUnit"];
    default:
      return null;
  }
}

function parseServiceMode(value: unknown) {
  switch (value) {
    case ServiceMode.DINE_IN:
    case ServiceMode.TO_GO:
      return value;
    default:
      return undefined;
  }
}

function parseOptionalInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
}

function clampScore(value: number, fallback: number) {
  return Number.isFinite(value) ? Math.min(0.98, Math.max(0.2, value)) : fallback;
}

function extractAssistantText(payload: {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}) {
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part.text ?? "")
      .join("")
      .trim();
  }

  throw new Error("OpenAI response did not include assistant content.");
}

