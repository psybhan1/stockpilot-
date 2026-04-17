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
  /** Extended price (row total, qty × unit price) in cents — used to cross-check the math. */
  extPriceCents: number | null;
  /** OCR confidence — the UI shows low-confidence rows more prominently. */
  confidence: "high" | "medium" | "low";
  /** Short human-readable note (e.g. "line partially obscured", "weight-pricing not standard pack"). */
  note: string;
};

export type InvoiceSanityFlag =
  /** extPrice doesn't match qty*unit, off by more than 5%. */
  | { kind: "line_math_mismatch"; lineIndex: number; delta: number }
  /** sum of extPrices doesn't match reported subtotal. */
  | { kind: "subtotal_mismatch"; reportedCents: number; sumCents: number }
  /** supplier name on invoice doesn't resemble the PO's supplier. */
  | { kind: "supplier_name_mismatch"; invoiceName: string; expectedName: string }
  /** a line's quantityPacks is absurd vs what was ordered (e.g. 1000× the PO). */
  | { kind: "quantity_outlier"; lineIndex: number; ordered: number; reported: number };

export type InvoiceParseResult = {
  ok: boolean;
  lines: InvoiceParsedLine[];
  /** Supplier-level totals the model thinks it read, for cross-check UI. */
  totals?: {
    subtotalCents?: number | null;
    taxCents?: number | null;
    totalCents?: number | null;
  };
  /** Supplier name as printed on the invoice, if the model could read it. */
  supplierName?: string | null;
  /** Invoice/packing-slip number printed on the page. */
  invoiceNumber?: string | null;
  /** Short free-text model observation (e.g. "Delivery short 2 cases of tomatoes"). */
  summary?: string;
  /** If ok=false, why (network, JSON parse fail, missing key, etc.). */
  reason?: string;
  /** Server-side sanity checks that look for obvious parse errors. */
  sanity?: InvoiceSanityFlag[];
  /** Debugging: raw model response body + model id. Persisted on the PO
   * so ops can inspect what the model actually said when a parse looks off.
   * Never shown in the main UI; only in an admin detail view. */
  debug?: {
    model: string;
    raw: string;
  };
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

  const systemPrompt = `You are a bookkeeping assistant reading a supplier's delivery invoice for a restaurant. The invoice is typically a printed document (or sometimes a packing slip) with the following structure that you should scan in order:

1. HEADER area (top of page): supplier name, invoice number or packing slip number, date, and often a PO number referencing the restaurant's order.
2. LINE ITEMS TABLE (middle): each row = one product delivered. Columns usually include: item SKU / code, description, quantity, unit of measure (cs=case, bt=bottle, lb=pound, ea=each, kg=kilogram), unit price, extended price (= qty × unit price).
3. TOTALS block (bottom): subtotal, tax, delivery/fuel surcharge, and grand total.

The restaurant will send you THEIR ordered lines (with stable ids). Your job: for each LINE ITEM you can read, match it to one of those ids by description/SKU, and return what was actually delivered and charged.

Return STRICT JSON with this exact shape:
{
  "supplierName": "<name as printed at top, or null>",
  "invoiceNumber": "<printed on the invoice, or null>",
  "lines": [
    {
      "lineId": "<exact PO line id or null if no match>",
      "rawDescription": "<product as printed on the invoice>",
      "quantityPacks": <number or null>,
      "unitCostCents": <integer cents or null>,
      "extPriceCents": <integer cents: the row's extended/line total, or null>,
      "confidence": "high" | "medium" | "low",
      "note": "<short reason, under 25 words>"
    }
  ],
  "totals": {
    "subtotalCents": <integer cents or null>,
    "taxCents": <integer cents or null>,
    "totalCents": <integer cents or null>
  },
  "summary": "<one line, e.g. 'Delivery short 2 cases of tomatoes'>"
}

Rules:
- Match each invoice row to a PO line by product description or SKU. Use the EXACT lineId from the PO context. If there is no match (bonus item, unreadable row, supplier substituted), set lineId=null — don't force a match.
- quantityPacks is the COUNT in the purchase unit as written on the invoice (e.g. "3 CS" → 3; "2.5 LB" → 2.5). Do NOT convert to grams/ml — our server handles that.
- unitCostCents is the PRICE-PER-UNIT as printed in integer cents. $12.45/case → 1245. A $4.99/lb line with qty 2.5 lb and ext price $12.48 → unitCostCents=499. Exclude taxes, delivery fees, and fuel surcharges — those go in totals.
- extPriceCents is the line's extended total (qty × unit price). Include it when visible — we cross-check the math.
- Totals.* are for the WHOLE invoice, including tax and delivery if printed.
- Confidence: "high" only when both description AND numbers are crisply legible. "medium" when one number is smudged, you're inferring a column, or the format is unusual. "low" when you're guessing more than reading.
- NEVER invent lines. A row you can't read at all → skip it. A row missing a price → include with unitCostCents=null and confidence="low".
- If the invoice is not readable at all (blank page, wrong document, too blurry), return { "lines": [] } and use summary to explain.
- Keep rawDescription faithful to what's printed; don't expand abbreviations or correct typos.`;

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

  const coerced = coerceParsedResponse(raw, input.poContext.lines);
  if (!coerced.ok) return coerced;
  // Attach debug + sanity checks now that we have a clean parse.
  coerced.debug = { model, raw };
  coerced.sanity = sanityCheckParse(coerced, {
    supplierName: input.poContext.supplierName,
    lines: input.poContext.lines,
  });
  return coerced;
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
      extPriceCents: coerceNonNegativeInteger(e.extPriceCents),
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

  const supplierName =
    typeof obj.supplierName === "string" ? obj.supplierName.slice(0, 120) : null;
  const invoiceNumber =
    typeof obj.invoiceNumber === "string" ? obj.invoiceNumber.slice(0, 64) : null;

  return {
    ok: true,
    lines,
    totals: {
      subtotalCents: coerceNonNegativeInteger(totalsObj.subtotalCents),
      taxCents: coerceNonNegativeInteger(totalsObj.taxCents),
      totalCents: coerceNonNegativeInteger(totalsObj.totalCents),
    },
    supplierName,
    invoiceNumber,
    summary: typeof obj.summary === "string" ? obj.summary.slice(0, 400) : undefined,
  };
}

/**
 * Post-parse sanity checks. Run after coerceParsedResponse; returns
 * a list of warnings the UI surfaces next to the parsed data.
 *
 * Each check is a cheap deterministic test that catches common model
 * hallucinations without needing a second LLM pass:
 *   - Line math: qty × unit ≠ extPrice (off > 5%)
 *   - Subtotal math: sum of extPrices ≠ reported subtotal (off > 5%)
 *   - Supplier name mismatch: model saw a different supplier than
 *     the PO claims — happens when the user photographs the wrong
 *     invoice by accident
 *   - Quantity outlier: reported > 10× ordered or > 100 when ordered
 *     was a small number; catches the "3" → "33" misread that
 *     would otherwise charge you for 33 cases
 */
export function sanityCheckParse(
  result: InvoiceParseResult,
  poContext: { supplierName: string; lines: InvoicePoLineContext[] }
): InvoiceSanityFlag[] {
  const flags: InvoiceSanityFlag[] = [];

  // 1. per-line math
  for (let i = 0; i < result.lines.length; i++) {
    const line = result.lines[i];
    if (
      line.quantityPacks != null &&
      line.unitCostCents != null &&
      line.extPriceCents != null &&
      line.extPriceCents > 0
    ) {
      const expected = line.quantityPacks * line.unitCostCents;
      const delta = line.extPriceCents - expected;
      const pct = Math.abs(delta) / Math.max(line.extPriceCents, expected);
      if (pct > 0.05) {
        flags.push({ kind: "line_math_mismatch", lineIndex: i, delta });
      }
    }
  }

  // 2. subtotal math
  if (result.totals?.subtotalCents != null && result.totals.subtotalCents > 0) {
    let sum = 0;
    let any = false;
    for (const line of result.lines) {
      if (line.extPriceCents != null && line.extPriceCents > 0) {
        sum += line.extPriceCents;
        any = true;
      } else if (line.quantityPacks != null && line.unitCostCents != null) {
        sum += Math.round(line.quantityPacks * line.unitCostCents);
        any = true;
      }
    }
    if (any) {
      const reported = result.totals.subtotalCents;
      const pct = Math.abs(sum - reported) / Math.max(reported, sum);
      if (pct > 0.05) {
        flags.push({ kind: "subtotal_mismatch", reportedCents: reported, sumCents: sum });
      }
    }
  }

  // 3. supplier-name mismatch
  if (result.supplierName) {
    const got = result.supplierName.toLowerCase();
    const expected = poContext.supplierName.toLowerCase();
    if (!nameLooksSimilar(got, expected)) {
      flags.push({
        kind: "supplier_name_mismatch",
        invoiceName: result.supplierName,
        expectedName: poContext.supplierName,
      });
    }
  }

  // 4. quantity outlier
  const poByLineId = new Map(poContext.lines.map((l) => [l.lineId, l]));
  for (let i = 0; i < result.lines.length; i++) {
    const line = result.lines[i];
    if (line.quantityPacks == null || line.lineId == null) continue;
    const po = poByLineId.get(line.lineId);
    if (!po || po.quantityOrdered <= 0) continue;
    const ratio = line.quantityPacks / po.quantityOrdered;
    // Outlier if reported is >10x ordered. Typos like "3" → "33"
    // fall in this band; supplier overshipment by 2-3x doesn't.
    if (ratio > 10) {
      flags.push({
        kind: "quantity_outlier",
        lineIndex: i,
        ordered: po.quantityOrdered,
        reported: line.quantityPacks,
      });
    }
  }

  return flags;
}

/**
 * Loose name-similarity check. "Sysco Toronto" should match "Sysco"
 * (the PO's stored supplier name), and "Acme Foods" should match
 * "Acme Foods Inc." — common bookkeeping normalization. We tokenize
 * on word boundaries and check for any shared ≥3-char token. False
 * positives are fine; false negatives trigger a warning, not a
 * reject, so the user can confirm manually.
 */
function nameLooksSimilar(a: string, b: string): boolean {
  const tokens = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !GENERIC_CORP_TOKENS.has(t));
  const aTokens = new Set(tokens(a));
  for (const t of tokens(b)) {
    if (aTokens.has(t)) return true;
  }
  return false;
}
const GENERIC_CORP_TOKENS = new Set([
  "inc",
  "corp",
  "ltd",
  "llc",
  "co",
  "company",
  "foods",
  "food",
  "supply",
  "company",
  "the",
  "and",
]);

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
