/**
 * Supplier-invoice parser.
 *
 * Takes a photo (or PDF-page screenshot) of a supplier's delivery
 * invoice plus the PO's ordered lines, and asks Groq's multimodal
 * Llama 4 Scout to pull out: actual quantity received, actual unit
 * cost charged, and a line-to-PO match so we can auto-fill the
 * receiving form.
 *
 * Design notes:
 *   - We pass the PO's EXPECTED lines as context so the model can
 *     match invoice rows back to PO rows deterministically (by id)
 *     rather than guessing line order.
 *   - We return a confidence per line. The UI presents every parsed
 *     row for human review BEFORE writing — we never write actuals
 *     without a human confirmation. This is both correct (OCR on
 *     arbitrary invoice formats is inherently approximate) and
 *     covers the compliance angle (a manager's signature is on
 *     every cost change).
 *   - `unitCostCents` is an integer (so $12.45 → 1245). The model is
 *     prompted to return exactly this shape; we coerce / clamp on
 *     the way out to defend against hallucinated floats.
 *   - `quantityBase` is expressed in the INVENTORY ITEM's base unit
 *     (grams / millilitres / pieces), derived from packSizeBase *
 *     purchaseUnit count. Matching the PO's shape makes the variance
 *     math straightforward on receive.
 *   - Model output gets normalised through `coerceParsedResponse`
 *     before reaching the caller — a junk response returns an empty
 *     lines array + reason, never throws.
 */

export type InvoicePoLineContext = {
  lineId: string;
  description: string;
  inventoryItemName: string;
  quantityOrdered: number;
  purchaseUnit: string;
  packSizeBase: number;
  expectedUnitCostCents: number | null;
};

export type InvoiceParsedLine = {
  /** PO line this invoice row maps to, or null if it looks like a new item. */
  lineId: string | null;
  /** Raw description as printed on the invoice. */
  rawDescription: string;
  /** Quantity in the PO line's purchaseUnit count (packs / cases / bottles). */
  quantityPacks: number | null;
  /** Per-pack cost in cents; null if the invoice didn't print one we could read. */
  unitCostCents: number | null;
  /** OCR confidence — the UI shows low-confidence rows more prominently. */
  confidence: "high" | "medium" | "low";
  /** Short human-readable note (e.g. "line partially obscured", "weight-pricing not standard pack"). */
  note: string;
};

export type InvoiceParseResult = {
  ok: boolean;
  lines: InvoiceParsedLine[];
  /** Supplier-level totals the model thinks it read, for cross-check UI. */
  totals?: {
    subtotalCents?: number | null;
    taxCents?: number | null;
    totalCents?: number | null;
  };
  /** Short free-text model observation (e.g. "Delivery short 2 cases of tomatoes"). */
  summary?: string;
  /** If ok=false, why (network, JSON parse fail, missing key, etc.). */
  reason?: string;
};

/**
 * Call Groq with the invoice image + PO context. Returns a
 * normalised InvoiceParseResult. Never throws — errors become
 * `{ok: false, reason}` so the route handler can surface them
 * cleanly to the UI.
 */
export async function parseInvoiceImage(input: {
  imageDataUrl: string;
  imageContentType: string;
  poContext: {
    orderNumber: string;
    supplierName: string;
    lines: InvoicePoLineContext[];
  };
  fetchImpl?: typeof fetch;
  apiKey?: string;
  model?: string;
}): Promise<InvoiceParseResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiKey = input.apiKey ?? process.env.GROQ_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      lines: [],
      reason:
        "Invoice OCR needs GROQ_API_KEY on the server. Ask your admin to set it, then retry.",
    };
  }
  if (!input.imageDataUrl?.startsWith("data:")) {
    return { ok: false, lines: [], reason: "Invoice image missing or not a data URL" };
  }

  const systemPrompt = `You are a bookkeeping assistant for a restaurant. Given a photo of a supplier's delivery invoice and the PO the restaurant sent, extract each line item they actually received.

Return STRICT JSON: {"lines":[{"lineId":"po-line-id-or-null","rawDescription":"...","quantityPacks":<number-or-null>,"unitCostCents":<integer-or-null>,"confidence":"high|medium|low","note":"short reason"}],"totals":{"subtotalCents":<int-or-null>,"taxCents":<int-or-null>,"totalCents":<int-or-null>},"summary":"one-line observation"}

Rules:
- Match each invoice line to a PO line by product description or SKU. Use the PO line's id EXACTLY as given; if no match exists (a bonus item, or a line you can't read), set lineId=null.
- quantityPacks is the COUNT of purchase units on the invoice (cases, bottles, pounds as written). Not converted to base units — we'll do that.
- unitCostCents is the PER-UNIT cost charged (price printed per case / per bottle / etc.) in integer cents. A $12.45/case → 1245. Exclude taxes and delivery fees from unit cost; those go in totals.
- Totals are for the whole invoice. Include them if clearly printed.
- confidence="high" when the line and numbers are crisply legible; "medium" when something is smudged or a format guess; "low" for anything that's plausibly wrong.
- Keep note under 25 words.
- Never invent lines. If you can't read a row, skip it.`;

  const poLinesText = input.poContext.lines
    .map((l) => {
      const expected = l.expectedUnitCostCents != null
        ? ` expected ~$${(l.expectedUnitCostCents / 100).toFixed(2)}/${l.purchaseUnit.toLowerCase()}`
        : "";
      return `- id=${l.lineId} item="${l.inventoryItemName}" desc="${l.description}" ordered=${l.quantityOrdered} ${l.purchaseUnit.toLowerCase()}${expected}`;
    })
    .join("\n");

  const userText = `Supplier: ${input.poContext.supplierName}
PO: ${input.poContext.orderNumber}
Lines ordered on the PO (use these ids when matching):
${poLinesText}

Read the invoice photo and extract what was actually delivered and charged.`;

  const model =
    input.model ??
    process.env.VISION_MODEL ??
    "meta-llama/llama-4-scout-17b-16e-instruct";

  let response: Response;
  try {
    response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: input.imageDataUrl } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    return {
      ok: false,
      lines: [],
      reason:
        err instanceof Error && err.name === "TimeoutError"
          ? "Vision model didn't respond within 60s."
          : `Vision call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      lines: [],
      reason: `Vision API ${response.status}: ${text.slice(0, 200)}`,
    };
  }

  let raw: string;
  try {
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    raw = data.choices?.[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    return {
      ok: false,
      lines: [],
      reason: `Vision response wasn't JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return coerceParsedResponse(raw, input.poContext.lines);
}

/**
 * Normalise the model's free-text JSON into our typed shape. Always
 * returns a well-formed InvoiceParseResult — never throws. Filters
 * out lines whose lineId doesn't match a known PO line (model
 * occasionally invents ids) except when lineId is null (which means
 * "I couldn't match it", and the UI lists those as "new items").
 */
export function coerceParsedResponse(
  raw: string,
  poLines: InvoicePoLineContext[]
): InvoiceParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, lines: [], reason: "Vision JSON parse failed" };
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const rawLines = Array.isArray(obj.lines) ? obj.lines : [];
  const validLineIds = new Set(poLines.map((l) => l.lineId));

  const lines: InvoiceParsedLine[] = [];
  for (const entry of rawLines) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;

    const rawDescription =
      typeof e.rawDescription === "string" ? e.rawDescription.slice(0, 200) : "";
    if (!rawDescription) continue;

    const rawLineId = typeof e.lineId === "string" ? e.lineId : null;
    const lineId = rawLineId && validLineIds.has(rawLineId) ? rawLineId : null;

    lines.push({
      lineId,
      rawDescription,
      quantityPacks: coerceNonNegativeNumber(e.quantityPacks),
      unitCostCents: coerceNonNegativeInteger(e.unitCostCents),
      confidence:
        e.confidence === "high" || e.confidence === "medium" || e.confidence === "low"
          ? (e.confidence as "high" | "medium" | "low")
          : "low",
      note: typeof e.note === "string" ? e.note.slice(0, 200) : "",
    });
  }

  const totalsObj =
    obj.totals && typeof obj.totals === "object" && !Array.isArray(obj.totals)
      ? (obj.totals as Record<string, unknown>)
      : {};

  return {
    ok: true,
    lines,
    totals: {
      subtotalCents: coerceNonNegativeInteger(totalsObj.subtotalCents),
      taxCents: coerceNonNegativeInteger(totalsObj.taxCents),
      totalCents: coerceNonNegativeInteger(totalsObj.totalCents),
    },
    summary: typeof obj.summary === "string" ? obj.summary.slice(0, 400) : undefined,
  };
}

function coerceNonNegativeInteger(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return Math.round(v);
}

function coerceNonNegativeNumber(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return v;
}

/**
 * Flags a price variance that's big enough to warrant manager
 * attention. Thresholds tuned for a café: anything over ±5% on
 * unit cost is notable, ±15% is "please verify" territory.
 */
export type VarianceSeverity = "none" | "watch" | "review";

export function classifyPriceVariance(
  expectedCents: number | null | undefined,
  actualCents: number | null | undefined
): { severity: VarianceSeverity; deltaPct: number | null; deltaCents: number | null } {
  if (expectedCents == null || actualCents == null || expectedCents <= 0) {
    return { severity: "none", deltaPct: null, deltaCents: null };
  }
  const deltaCents = actualCents - expectedCents;
  const deltaPct = deltaCents / expectedCents;
  const absPct = Math.abs(deltaPct);
  let severity: VarianceSeverity = "none";
  if (absPct >= 0.15) severity = "review";
  else if (absPct >= 0.05) severity = "watch";
  return { severity, deltaPct, deltaCents };
}

/**
 * Same idea but for quantity shortfall (ordered 10 cases, got 8).
 * Overage isn't flagged because it's usually a supplier freebie /
 * cross-dock error — it'll surface on the receiving form but
 * doesn't need a "review" banner.
 */
export function classifyQuantityShortfall(
  orderedPacks: number,
  receivedPacks: number | null | undefined
): VarianceSeverity {
  if (receivedPacks == null || orderedPacks <= 0) return "none";
  const shortfall = orderedPacks - receivedPacks;
  if (shortfall <= 0) return "none";
  const pct = shortfall / orderedPacks;
  if (pct >= 0.2) return "review";
  if (pct >= 0.05) return "watch";
  return "none";
}
