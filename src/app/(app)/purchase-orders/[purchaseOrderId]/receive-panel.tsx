"use client";

/**
 * Receive-delivery panel, client side.
 *
 * Extends the existing server-action form with:
 *
 *  - Camera / file input to upload a photo of the supplier's
 *    delivery invoice. POSTs to /api/purchase-orders/:id/invoice,
 *    which runs OCR and returns parsed lines + totals.
 *  - Per-line "actual unit cost" input + "received packs" input.
 *  - Auto-fills both from parsed invoice data when OCR succeeds.
 *  - Variance badges (green/amber/red) comparing actuals to what
 *    the PO was priced at.
 *
 * The form itself still posts to the existing `deliverPurchaseOrder
 * Action` server action — we just add `actualCost-<lineId>` fields
 * it knows how to read now.
 */

import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { deliverPurchaseOrderAction } from "@/app/actions/operations";

export type ReceiveLine = {
  id: string;
  description: string;
  quantityOrdered: number;
  purchaseUnit: string;
  packSizeBase: number;
  expectedUnitCostCents: number | null;
  itemName: string;
};

type ParsedLine = {
  lineId: string | null;
  rawDescription: string;
  quantityPacks: number | null;
  unitCostCents: number | null;
  extPriceCents: number | null;
  confidence: "high" | "medium" | "low";
  note: string;
};

type SanityFlag =
  | { kind: "line_math_mismatch"; lineIndex: number; delta: number }
  | { kind: "subtotal_mismatch"; reportedCents: number; sumCents: number }
  | { kind: "supplier_name_mismatch"; invoiceName: string; expectedName: string }
  | { kind: "quantity_outlier"; lineIndex: number; ordered: number; reported: number };

type ParseResult = {
  ok: boolean;
  lines: ParsedLine[];
  totals?: {
    subtotalCents?: number | null;
    taxCents?: number | null;
    totalCents?: number | null;
  };
  supplierName?: string | null;
  invoiceNumber?: string | null;
  summary?: string;
  reason?: string;
  sanity?: SanityFlag[];
};

type LineState = {
  receivedPacks: string;
  actualUnitCostCents: string;
};

export function ReceivePanel({
  purchaseOrderId,
  lines,
}: {
  purchaseOrderId: string;
  lines: ReceiveLine[];
}) {
  const [states, setStates] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(
      lines.map((l) => [
        l.id,
        {
          receivedPacks: String(l.quantityOrdered),
          actualUnitCostCents:
            l.expectedUnitCostCents != null
              ? (l.expectedUnitCostCents / 100).toFixed(2)
              : "",
        },
      ])
    )
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const updateLine = (lineId: string, patch: Partial<LineState>) => {
    setStates((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], ...patch },
    }));
  };

  const handleFile = async (file: File) => {
    setUploadError(null);
    setParseResult(null);
    if (!/^image\/(jpeg|png|webp|heic)$/i.test(file.type)) {
      setUploadError("Upload a JPEG, PNG, or WEBP photo of the invoice.");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setUploadError("Photo is larger than 6 MB — try a smaller one.");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await fetch(
        `/api/purchase-orders/${encodeURIComponent(purchaseOrderId)}/invoice`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ imageDataUrl: dataUrl }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setUploadError(body.message || `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { parsed: ParseResult };
      setParseResult(data.parsed);
      if (data.parsed.ok) {
        applyParsedToForm(data.parsed);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const applyParsedToForm = (parsed: ParseResult) => {
    const next = { ...states };
    for (const p of parsed.lines) {
      if (!p.lineId) continue;
      const existing = next[p.lineId];
      if (!existing) continue;
      next[p.lineId] = {
        receivedPacks:
          p.quantityPacks != null ? String(Math.round(p.quantityPacks)) : existing.receivedPacks,
        actualUnitCostCents:
          p.unitCostCents != null
            ? (p.unitCostCents / 100).toFixed(2)
            : existing.actualUnitCostCents,
      };
    }
    setStates(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-muted/20 p-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="rounded-2xl"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Reading invoice…" : "📷 Scan invoice"}
        </Button>
        <div className="flex-1 text-sm text-muted-foreground">
          Snap the supplier's delivery invoice. We auto-fill received quantities
          and actual costs — you review before saving.
        </div>
      </div>

      {uploadError ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300">
          {uploadError}
        </div>
      ) : null}

      {parseResult ? (
        <ParseResultSummary
          result={parseResult}
          onReapply={() => applyParsedToForm(parseResult)}
        />
      ) : null}

      <form action={deliverPurchaseOrderAction} className="space-y-4">
        <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />

        <div className="grid gap-3 md:grid-cols-2">
          {lines.map((line) => {
            const state = states[line.id];
            const actualCents = parseDollarsToCents(state.actualUnitCostCents);
            const variance = classifyVariance(
              line.expectedUnitCostCents,
              actualCents
            );
            return (
              <div key={line.id} className="notif-card space-y-3 p-4">
                <div>
                  <span className="font-medium">{line.description}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    Ordered {line.quantityOrdered} {line.purchaseUnit.toLowerCase()}
                    {line.expectedUnitCostCents != null ? (
                      <>
                        {" "}
                        @ ~${(line.expectedUnitCostCents / 100).toFixed(2)}
                      </>
                    ) : null}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs uppercase tracking-wide text-muted-foreground">
                    Received ({line.purchaseUnit.toLowerCase()})
                    <Input
                      name={`received-${line.id}`}
                      type="number"
                      min={0}
                      step="1"
                      value={state.receivedPacks}
                      onChange={(e) =>
                        updateLine(line.id, { receivedPacks: e.target.value })
                      }
                      className="mt-1 h-11 rounded-2xl"
                    />
                  </label>
                  <label className="block text-xs uppercase tracking-wide text-muted-foreground">
                    Actual $/ {line.purchaseUnit.toLowerCase()}
                    <Input
                      name={`actualCost-${line.id}`}
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={state.actualUnitCostCents}
                      placeholder={
                        line.expectedUnitCostCents != null
                          ? (line.expectedUnitCostCents / 100).toFixed(2)
                          : "0.00"
                      }
                      onChange={(e) =>
                        updateLine(line.id, { actualUnitCostCents: e.target.value })
                      }
                      className="mt-1 h-11 rounded-2xl"
                    />
                  </label>
                </div>

                {variance.severity !== "none" ? (
                  <VarianceBadge
                    severity={variance.severity}
                    deltaPct={variance.deltaPct}
                  />
                ) : null}
              </div>
            );
          })}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Receiving note</p>
          <Textarea
            name="notes"
            rows={3}
            placeholder="Optional note (e.g. driver name, packaging issues, short-dated items)"
            className="rounded-2xl"
          />
        </div>

        <Button type="submit" className="rounded-2xl">
          Mark delivered &amp; update inventory
        </Button>
      </form>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────

function ParseResultSummary({
  result,
  onReapply,
}: {
  result: ParseResult;
  onReapply: () => void;
}) {
  if (!result.ok) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-800 dark:text-amber-200">
        <p className="font-medium">OCR couldn't read that photo.</p>
        <p className="mt-1">{result.reason || "Try a clearer photo."}</p>
      </div>
    );
  }
  const found = result.lines.length;
  return (
    <div className="space-y-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
      <div className="flex items-start gap-3">
        <div className="grow">
          <p className="font-medium text-emerald-900 dark:text-emerald-100">
            Invoice scanned — {found} line{found === 1 ? "" : "s"} matched.
          </p>
          {result.summary ? (
            <p className="mt-1 text-emerald-900/80 dark:text-emerald-100/80">
              {result.summary}
            </p>
          ) : null}
          {result.totals?.totalCents != null ? (
            <p className="mt-1 text-emerald-900/70 dark:text-emerald-100/70">
              Invoice total: ${(result.totals.totalCents / 100).toFixed(2)}
              {result.totals.taxCents != null
                ? ` (incl. $${(result.totals.taxCents / 100).toFixed(2)} tax)`
                : ""}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReapply}
          className="shrink-0 rounded-xl"
        >
          Re-apply
        </Button>
      </div>
      {result.sanity && result.sanity.length > 0 ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">
          <p className="font-medium">Double-check these — our math doesn't quite add up:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {result.sanity.map((f, i) => (
              <li key={i}>{describeSanityFlag(f, result)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <details className="text-xs">
        <summary className="cursor-pointer text-emerald-900/80 dark:text-emerald-100/80">
          What the model read
        </summary>
        <ul className="mt-2 space-y-1">
          {result.lines.map((l, i) => (
            <li key={i} className="text-emerald-900/80 dark:text-emerald-100/80">
              <span className={`mr-2 ${confidenceClass(l.confidence)}`}>
                [{l.confidence}]
              </span>
              {l.rawDescription} —{" "}
              {l.quantityPacks != null ? `${l.quantityPacks} pack(s)` : "qty ?"}{" "}
              {l.unitCostCents != null
                ? `@ $${(l.unitCostCents / 100).toFixed(2)}`
                : "@ price ?"}{" "}
              {l.extPriceCents != null
                ? `= $${(l.extPriceCents / 100).toFixed(2)}`
                : ""}{" "}
              {l.note ? `(${l.note})` : ""}
              {l.lineId ? "" : "  — unmatched"}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function VarianceBadge({
  severity,
  deltaPct,
}: {
  severity: "watch" | "review";
  deltaPct: number;
}) {
  const label = deltaPct > 0 ? "over" : "under";
  const abs = Math.abs(deltaPct * 100);
  const tone =
    severity === "review"
      ? "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300"
      : "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-200";
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs ${tone}`}
    >
      <span className="font-medium">
        {abs.toFixed(1)}% {label} PO estimate
      </span>
      <span className="opacity-70">
        {severity === "review" ? "needs review" : "watch"}
      </span>
    </div>
  );
}

function describeSanityFlag(f: SanityFlag, result: ParseResult): string {
  switch (f.kind) {
    case "line_math_mismatch": {
      const line = result.lines[f.lineIndex];
      const sign = f.delta > 0 ? "over" : "under";
      return `"${line?.rawDescription ?? "?"}": row total is $${(Math.abs(f.delta) / 100).toFixed(2)} ${sign} (qty × unit price doesn't equal extended price).`;
    }
    case "subtotal_mismatch":
      return `Invoice subtotal printed as $${(f.reportedCents / 100).toFixed(2)} but the line items we read add up to $${(f.sumCents / 100).toFixed(2)}. One or more lines may have been misread.`;
    case "supplier_name_mismatch":
      return `Invoice says "${f.invoiceName}", but this PO was sent to "${f.expectedName}". Make sure you uploaded the right invoice.`;
    case "quantity_outlier": {
      const line = result.lines[f.lineIndex];
      return `"${line?.rawDescription ?? "?"}": parsed as ${f.reported} packs but you ordered ${f.ordered}. Verify the quantity column didn't get misread (e.g. "3" → "33").`;
    }
  }
}

function confidenceClass(c: "high" | "medium" | "low") {
  if (c === "high") return "text-emerald-700 dark:text-emerald-300";
  if (c === "medium") return "text-amber-700 dark:text-amber-300";
  return "text-red-700 dark:text-red-300";
}

function parseDollarsToCents(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function classifyVariance(
  expectedCents: number | null,
  actualCents: number | null
): { severity: "none" | "watch" | "review"; deltaPct: number } {
  if (expectedCents == null || actualCents == null || expectedCents <= 0) {
    return { severity: "none", deltaPct: 0 };
  }
  const deltaPct = (actualCents - expectedCents) / expectedCents;
  const absPct = Math.abs(deltaPct);
  if (absPct >= 0.15) return { severity: "review", deltaPct };
  if (absPct >= 0.05) return { severity: "watch", deltaPct };
  return { severity: "none", deltaPct };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("File read didn't return a string"));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Read error"));
    reader.readAsDataURL(file);
  });
}
