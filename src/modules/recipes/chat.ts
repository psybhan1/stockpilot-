/**
 * StockBuddy chat layer. Two entry points:
 *
 *   1. recipeChatTurn — edits a single recipe via natural language.
 *      Returns an assistant reply + a list of structured operations
 *      (add/remove/update qty/set summary) that the caller applies
 *      against the DB inside a transaction.
 *
 *   2. menuChatTurn — answers questions about the whole menu (cost,
 *      merge candidates, health). Returns a reply + optional
 *      suggestedActions (links the UI renders as one-tap buttons).
 *
 * Both route through Groq with response_format: json_object so we
 * don't have to parse free-form text. Catalog and recipe snapshots
 * are embedded in the prompt so the model answers from truth.
 */

import { MeasurementUnit } from "@/lib/prisma";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL =
  process.env.GROQ_AI_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct";

export type RecipeChatOp =
  | { type: "update_quantity"; componentId: string; quantityBase: number }
  | { type: "remove"; componentId: string }
  | {
      type: "add";
      inventoryItemId: string;
      quantityBase: number;
      displayUnit: MeasurementUnit;
    }
  | { type: "set_summary"; summary: string };

export type RecipeChatResponse = {
  reply: string;
  operations: RecipeChatOp[];
};

export type MenuChatAction =
  | { type: "open_recipe"; recipeId: string; label: string }
  | {
      type: "consolidate";
      recipeIds: string[];
      label: string;
    };

export type MenuChatResponse = {
  reply: string;
  suggestedActions: MenuChatAction[];
};

export async function recipeChatTurn(input: {
  recipeSnapshot: {
    id: string;
    name: string;
    summary: string;
    components: Array<{
      id: string;
      inventoryItemName: string;
      quantityBase: number;
      displayUnit: string;
    }>;
  };
  inventoryCatalog: Array<{
    id: string;
    name: string;
    displayUnit: string;
    category: string;
  }>;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
}): Promise<RecipeChatResponse | { error: string }> {
  if (!process.env.GROQ_API_KEY) return { error: "AI offline." };

  const system = `You are StockBuddy, editing ONE café recipe in response to the user's natural-language instructions.

Output JSON only:
{
  "reply": "plain-English one-line confirmation of what you changed",
  "operations": [
    {"type":"update_quantity","componentId":"<id>","quantityBase":<int>},
    {"type":"remove","componentId":"<id>"},
    {"type":"add","inventoryItemId":"<catalog id>","quantityBase":<int>,"displayUnit":"GRAM|MILLILITER|COUNT|..."},
    {"type":"set_summary","summary":"one-line description"}
  ]
}

Rules:
 - componentId MUST come from the snapshot's components list.
 - inventoryItemId MUST come from the inventory catalog; never invent one.
 - displayUnit for an added component must match the catalog entry's displayUnit.
 - quantityBase is always an integer in the item's base unit (grams, ml, count).
 - "make it bigger/smaller" → multiply every component's quantity by the factor (1.5× for a size bump, 2× for double, 0.5× for half).
 - "swap X for Y" → remove X's component and add Y from the catalog with the same quantity/unit.
 - If the user asks a question instead of an edit, return reply only and operations=[].
 - Keep reply under 140 chars.`;

  const user = `Recipe snapshot:
${JSON.stringify(input.recipeSnapshot, null, 2)}

Inventory catalog (only use these ids):
${JSON.stringify(input.inventoryCatalog)}

Conversation so far:
${input.history.map((t) => `${t.role}: ${t.content}`).join("\n") || "(first turn)"}

New user message:
${input.userMessage}

Produce the JSON.`;

  try {
    const raw = await callGroqJson(system, user);
    return coerceRecipeResponse(raw, input.recipeSnapshot, input.inventoryCatalog);
  } catch (err) {
    return {
      error:
        err instanceof Error ? `Chat failed: ${err.message}` : "Chat failed.",
    };
  }
}

export async function menuChatTurn(input: {
  menuSnapshot: Array<{
    id: string;
    name: string;
    status: string;
    componentCount: number;
    totalCostCents: number | null;
  }>;
  consolidationCandidates: Array<{
    label: string;
    recipeIds: string[];
  }>;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
}): Promise<MenuChatResponse | { error: string }> {
  if (!process.env.GROQ_API_KEY) return { error: "AI offline." };

  const system = `You are StockBuddy, helping a café owner understand and organize their whole menu.

Output JSON only:
{
  "reply": "plain-English answer or confirmation, ≤ 3 sentences",
  "suggestedActions": [
    {"type":"open_recipe","recipeId":"<id>","label":"Open Latte"},
    {"type":"consolidate","recipeIds":["id1","id2","id3"],"label":"Merge 3 latte variants"}
  ]
}

Rules:
 - Use ONLY recipeIds from the snapshot; never invent ids.
 - If the user asks "why is X expensive" / "what has best margin", answer from totalCostCents (null means cost unknown — say so).
 - If the user says "merge / consolidate / combine" a family, include a consolidate action built from the matching recipes.
 - Empty suggestedActions is fine for pure Q&A.
 - Be concrete. Never say "consider reviewing" — either suggest an action or just answer.`;

  const user = `Menu snapshot (recipeId, name, status, component count, total cost in cents or null):
${JSON.stringify(input.menuSnapshot)}

Auto-detected consolidation candidates:
${JSON.stringify(input.consolidationCandidates)}

Conversation so far:
${input.history.map((t) => `${t.role}: ${t.content}`).join("\n") || "(first turn)"}

New user message:
${input.userMessage}

Produce the JSON.`;

  try {
    const raw = await callGroqJson(system, user);
    return coerceMenuResponse(raw, input.menuSnapshot);
  } catch (err) {
    return {
      error:
        err instanceof Error ? `Chat failed: ${err.message}` : "Chat failed.",
    };
  }
}

async function callGroqJson(
  system: string,
  user: string,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
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
          { role: "system", content: system },
          { role: "user", content: `${user}\n\nReturn valid JSON only.` },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const body = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(body.error?.message ?? "Groq call failed.");
  return JSON.parse(body.choices?.[0]?.message?.content ?? "{}") as Record<
    string,
    unknown
  >;
}

function coerceRecipeResponse(
  raw: Record<string, unknown>,
  snapshot: { components: Array<{ id: string }> },
  catalog: Array<{ id: string; displayUnit: string }>,
): RecipeChatResponse {
  const reply =
    typeof raw.reply === "string" ? raw.reply.slice(0, 280) : "Done.";
  const validComponentIds = new Set(snapshot.components.map((c) => c.id));
  const catalogById = new Map(catalog.map((c) => [c.id, c]));
  const validUnits = Object.values(MeasurementUnit) as string[];

  const ops: RecipeChatOp[] = [];
  const rawOps = Array.isArray(raw.operations) ? raw.operations : [];
  for (const ro of rawOps) {
    const o = ro as Record<string, unknown>;
    if (o.type === "update_quantity") {
      const id = typeof o.componentId === "string" ? o.componentId : "";
      const q = Math.max(0, Math.round(Number(o.quantityBase) || 0));
      if (validComponentIds.has(id))
        ops.push({ type: "update_quantity", componentId: id, quantityBase: q });
    } else if (o.type === "remove") {
      const id = typeof o.componentId === "string" ? o.componentId : "";
      if (validComponentIds.has(id))
        ops.push({ type: "remove", componentId: id });
    } else if (o.type === "add") {
      const invId =
        typeof o.inventoryItemId === "string" ? o.inventoryItemId : "";
      if (!catalogById.has(invId)) continue;
      const q = Math.max(1, Math.round(Number(o.quantityBase) || 0));
      const unitRaw = typeof o.displayUnit === "string" ? o.displayUnit : "";
      const unit = (
        validUnits.includes(unitRaw)
          ? unitRaw
          : catalogById.get(invId)!.displayUnit
      ) as MeasurementUnit;
      ops.push({
        type: "add",
        inventoryItemId: invId,
        quantityBase: q,
        displayUnit: unit,
      });
    } else if (o.type === "set_summary") {
      const s = typeof o.summary === "string" ? o.summary.slice(0, 500) : "";
      if (s) ops.push({ type: "set_summary", summary: s });
    }
  }
  return { reply, operations: ops };
}

function coerceMenuResponse(
  raw: Record<string, unknown>,
  menuSnapshot: Array<{ id: string }>,
): MenuChatResponse {
  const reply =
    typeof raw.reply === "string"
      ? raw.reply.slice(0, 600)
      : "Here's what I found.";
  const validIds = new Set(menuSnapshot.map((r) => r.id));
  const actions: MenuChatAction[] = [];
  const rawActions = Array.isArray(raw.suggestedActions)
    ? raw.suggestedActions
    : [];
  for (const ra of rawActions) {
    const a = ra as Record<string, unknown>;
    const label = typeof a.label === "string" ? a.label.slice(0, 80) : null;
    if (!label) continue;
    if (a.type === "open_recipe") {
      const id = typeof a.recipeId === "string" ? a.recipeId : "";
      if (validIds.has(id))
        actions.push({ type: "open_recipe", recipeId: id, label });
    } else if (a.type === "consolidate") {
      const ids = Array.isArray(a.recipeIds)
        ? (a.recipeIds.filter(
            (x) => typeof x === "string" && validIds.has(x),
          ) as string[])
        : [];
      if (ids.length >= 2)
        actions.push({ type: "consolidate", recipeIds: ids, label });
    }
  }
  return { reply, suggestedActions: actions };
}
