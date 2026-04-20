/**
 * Vision-based stock count helper. Takes a photo of a shelf /
 * storage area + the list of items the manager is counting, and
 * asks Meta Llama 4 Scout (via Groq) to count each visible item.
 *
 * Why Groq + Llama 4 Scout:
 *   - We already have GROQ_API_KEY set (powers the bot + reply
 *     classifier), so no extra auth / env vars.
 *   - Scout is multimodal, very fast, and comfortably within the
 *     free tier for typical café volume (a few counts per day).
 *   - OpenAI-compatible API shape, so the image_url content block
 *     works identically to GPT-4o-mini.
 *
 * Set VISION_MODEL env var to override (e.g. switch to Maverick for
 * harder scenes: meta-llama/llama-4-maverick-17b-128e-instruct).
 *
 * We scope the vision call to items the manager has PRE-SELECTED on
 * the client — this keeps the model focused and drastically cuts
 * hallucination vs. a free-form "what do you see".
 */

import { NextRequest, NextResponse } from "next/server";
import { Role } from "@/lib/domain-enums";
import { getSession } from "@/modules/auth/session";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

type IncomingBody = {
  imageDataUrl?: string;
  itemIds?: string[];
  note?: string;
};

type VisionCount = {
  inventoryItemId: string;
  name: string;
  count: number | null;
  confidence: "high" | "medium" | "low";
  rationale: string;
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Photo count needs GROQ_API_KEY set on the server. Ask your admin to add it, then try again.",
      },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => null)) as IncomingBody | null;
  if (!body?.imageDataUrl || !body.itemIds || body.itemIds.length === 0) {
    return NextResponse.json(
      { ok: false, message: "Missing imageDataUrl or itemIds" },
      { status: 400 }
    );
  }

  const items = await db.inventoryItem.findMany({
    where: {
      id: { in: body.itemIds },
      locationId: session.locationId,
    },
    select: {
      id: true,
      name: true,
      displayUnit: true,
      packSizeBase: true,
      baseUnit: true,
    },
  });
  if (items.length === 0) {
    return NextResponse.json({ ok: false, message: "No valid items" }, { status: 400 });
  }

  const itemCatalog = items
    .map(
      (i) =>
        `- id=${i.id} name="${i.name}" display_unit=${i.displayUnit.toLowerCase()}`
    )
    .join("\n");

  const systemPrompt = `You help a café staff member count inventory from a photo. The user will send ONE photo and a list of items they're trying to count. For each item in the list, count how many you can see in the photo (in the item's display unit).

Return STRICT JSON: {"counts":[{"inventoryItemId":"...","count":<integer-or-null>,"confidence":"high|medium|low","rationale":"short reason"}]}

Rules:
- Only report items you can actually see in the photo. If an item from the list is not visible, set count=null and confidence="low" and rationale="not visible".
- Count in the item's display_unit (e.g. if display_unit=liter and you see 3 one-liter cartons, count=3).
- "high" confidence = clearly visible and countable. "medium" = partially obscured. "low" = guessing.
- Keep rationale under 20 words.
- Do not invent items that aren't in the provided list.`;

  try {
    const model =
      process.env.VISION_MODEL ??
      "meta-llama/llama-4-scout-17b-16e-instruct";
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Items to count (use their IDs in the response):\n${itemCatalog}${
                  body.note ? `\n\nNote from user: ${body.note}` : ""
                }`,
              },
              {
                type: "image_url",
                image_url: { url: body.imageDataUrl },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { ok: false, message: `Vision API error: ${res.status} ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(raw) as {
      counts?: Array<{
        inventoryItemId?: string;
        count?: number | null;
        confidence?: string;
        rationale?: string;
      }>;
    };

    const byId = new Map(items.map((i) => [i.id, i]));
    const counts: VisionCount[] = (parsed.counts ?? [])
      .filter((c) => c.inventoryItemId && byId.has(c.inventoryItemId))
      .map((c) => ({
        inventoryItemId: String(c.inventoryItemId),
        name: byId.get(String(c.inventoryItemId))!.name,
        count:
          c.count === null || typeof c.count !== "number"
            ? null
            : Math.max(0, Math.round(c.count)),
        confidence:
          c.confidence === "high" || c.confidence === "medium" || c.confidence === "low"
            ? (c.confidence as "high" | "medium" | "low")
            : "low",
        rationale: (c.rationale ?? "").slice(0, 140),
      }));

    return NextResponse.json({ ok: true, counts });
  } catch (err) {
    console.error("[vision/count] failed:", err);
    return NextResponse.json(
      {
        ok: false,
        message: err instanceof Error ? err.message : "Vision call failed",
      },
      { status: 500 }
    );
  }
}
