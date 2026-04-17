/**
 * Run the invoice-OCR pipeline against a REAL invoice image and
 * (optionally) diff it against an expected-output JSON file.
 *
 *   npm run smoke:invoice -- ./real-invoice.jpg
 *   npm run smoke:invoice -- ./real-invoice.jpg --expected ./expected.json
 *   npm run smoke:invoice -- ./real-invoice.jpg --po ./po-context.json
 *
 * Flags:
 *   --expected <path>  JSON with the shape described below; the
 *                       script computes accuracy vs this ground truth.
 *   --po       <path>  JSON with the PO context to send to the model.
 *                       If omitted, a synthetic context is generated
 *                       from the image filename and a few guessed lines.
 *   --model    <id>    Override VISION_MODEL.
 *   --json             Output machine-readable JSON only (no pretty
 *                       text). Useful for piping into other tools.
 *
 * Expected-output file shape (all fields optional except lines):
 *   {
 *     "supplierName": "Sysco Toronto",
 *     "invoiceNumber": "INV-1234",
 *     "totals": { "subtotalCents": 12345, "taxCents": 987, "totalCents": 13332 },
 *     "lines": [
 *       { "rawDescription": "Milk 2% 4L", "quantityPacks": 3, "unitCostCents": 1200 },
 *       ...
 *     ]
 *   }
 *
 * PO-context file shape:
 *   {
 *     "orderNumber": "PO-REAL-1",
 *     "supplierName": "Sysco Toronto",
 *     "lines": [
 *       { "lineId": "line-1", "description": "Milk 2% 4L",
 *         "inventoryItemName": "Milk 2%", "quantityOrdered": 3,
 *         "purchaseUnit": "CASE", "packSizeBase": 4000,
 *         "expectedUnitCostCents": 1200 }
 *     ]
 *   }
 *
 * Exit code is 0 when the parse succeeded; 1 when the OCR returned
 * ok=false; 2 when --expected was provided and any line's qty/price
 * diverged from ground truth.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { basename, extname } from "node:path";

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const imagePath = args[0];
const flag = (name: string): string | null => {
  const i = args.findIndex((a) => a === `--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const expectedPath = flag("expected");
const poPath = flag("po");
const modelOverride = flag("model");
const asJson = args.includes("--json");

if (!existsSync(imagePath)) {
  console.error(`Image not found: ${imagePath}`);
  process.exit(2);
}
const stat = statSync(imagePath);
if (stat.size === 0) {
  console.error("Image is empty.");
  process.exit(2);
}
if (stat.size > 6 * 1024 * 1024) {
  console.error("Image >6 MB — resize before running.");
  process.exit(2);
}

const contentType = mimeFromExt(extname(imagePath).toLowerCase());
if (!contentType) {
  console.error(`Unsupported image type: ${extname(imagePath)}`);
  process.exit(2);
}

const imageBytes = readFileSync(imagePath);
const dataUrl = `data:${contentType};base64,${imageBytes.toString("base64")}`;

// Load PO context (real or synthetic).
type PoCtx = {
  orderNumber: string;
  supplierName: string;
  lines: Array<{
    lineId: string;
    description: string;
    inventoryItemName: string;
    quantityOrdered: number;
    purchaseUnit: string;
    packSizeBase: number;
    expectedUnitCostCents: number | null;
  }>;
};

let po: PoCtx;
if (poPath) {
  if (!existsSync(poPath)) {
    console.error(`PO context file not found: ${poPath}`);
    process.exit(2);
  }
  po = JSON.parse(readFileSync(poPath, "utf8")) as PoCtx;
} else {
  // Synthetic PO: the model can still read the invoice; we just won't
  // be able to match any lines by id. Useful for "does the model read
  // THIS supplier's format at all" triage.
  po = {
    orderNumber: `PO-SMOKE-${Date.now().toString(36)}`,
    supplierName: basename(imagePath, extname(imagePath)).replace(/[-_]/g, " "),
    lines: [],
  };
}

// Load expected output (optional).
type Expected = {
  supplierName?: string | null;
  invoiceNumber?: string | null;
  totals?: {
    subtotalCents?: number | null;
    taxCents?: number | null;
    totalCents?: number | null;
  };
  lines?: Array<{
    rawDescription?: string;
    quantityPacks?: number | null;
    unitCostCents?: number | null;
    extPriceCents?: number | null;
  }>;
};
let expected: Expected | null = null;
if (expectedPath) {
  if (!existsSync(expectedPath)) {
    console.error(`Expected-output file not found: ${expectedPath}`);
    process.exit(2);
  }
  expected = JSON.parse(readFileSync(expectedPath, "utf8")) as Expected;
}

// Run the OCR. Dynamic import so tsx handles the aliased paths.
const { parseInvoiceImage } = await import("../src/modules/invoices/parse.ts");

const start = Date.now();
const result = await parseInvoiceImage({
  imageDataUrl: dataUrl,
  imageContentType: contentType,
  poContext: po,
  ...(modelOverride ? { model: modelOverride } : {}),
});
const elapsedMs = Date.now() - start;

if (asJson) {
  console.log(JSON.stringify({ result, elapsedMs }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

// Pretty-print the report.
console.log("\n━━ Invoice OCR smoke test ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  image:     ${imagePath} (${Math.round(imageBytes.byteLength / 1024)} KB)`);
console.log(`  po:        ${po.orderNumber} / ${po.supplierName} (${po.lines.length} expected line${po.lines.length === 1 ? "" : "s"})`);
console.log(`  model:     ${result.debug?.model ?? "n/a"}`);
console.log(`  elapsed:   ${elapsedMs} ms`);
console.log(`  ok:        ${result.ok}`);
if (!result.ok) {
  console.log(`  reason:    ${result.reason ?? "—"}`);
  process.exit(1);
}
console.log(`  supplier:  ${result.supplierName ?? "(not read)"}`);
console.log(`  invoice#:  ${result.invoiceNumber ?? "(not read)"}`);
console.log(`  summary:   ${result.summary ?? "—"}`);
if (result.totals) {
  const t = result.totals;
  console.log(
    `  totals:    subtotal=${fmt(t.subtotalCents)}  tax=${fmt(t.taxCents)}  total=${fmt(t.totalCents)}`
  );
}

console.log(`\n  Lines (${result.lines.length}):`);
for (const [i, line] of result.lines.entries()) {
  const conf = `[${line.confidence}]`.padEnd(8);
  const qty = line.quantityPacks != null ? String(line.quantityPacks) : "?";
  const unit = line.unitCostCents != null ? `$${(line.unitCostCents / 100).toFixed(2)}` : "?";
  const ext = line.extPriceCents != null ? `= $${(line.extPriceCents / 100).toFixed(2)}` : "";
  console.log(`    ${String(i + 1).padStart(2)}. ${conf} ${line.rawDescription}`);
  console.log(`        qty=${qty}  unit=${unit}  ${ext}${line.lineId ? ` (matched ${line.lineId})` : "  — unmatched"}`);
  if (line.note) console.log(`        note: ${line.note}`);
}

if (result.sanity && result.sanity.length > 0) {
  console.log(`\n  Sanity flags (${result.sanity.length}):`);
  for (const flag of result.sanity) {
    console.log(`    ⚠ ${describeFlag(flag, result)}`);
  }
} else {
  console.log("\n  Sanity flags: none");
}

// Diff vs expected.
let divergences = 0;
if (expected) {
  console.log("\n━━ Ground-truth comparison ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (expected.supplierName && result.supplierName) {
    const m =
      expected.supplierName.toLowerCase() === result.supplierName.toLowerCase();
    console.log(`  supplier: ${m ? "✓" : "✗"} expected="${expected.supplierName}"  got="${result.supplierName}"`);
    if (!m) divergences += 1;
  }
  if (expected.totals) {
    for (const key of ["subtotalCents", "taxCents", "totalCents"] as const) {
      const exp = expected.totals[key];
      if (exp == null) continue;
      const got = result.totals?.[key] ?? null;
      const ok = exp === got;
      console.log(`  ${key}: ${ok ? "✓" : "✗"} expected=${fmt(exp)}  got=${fmt(got)}`);
      if (!ok) divergences += 1;
    }
  }

  // Line diff: match on rawDescription via fuzzy "shares a token".
  if (expected.lines) {
    console.log(`\n  Line accuracy:`);
    const remainingParsed = [...result.lines];
    for (const exp of expected.lines) {
      const idx = remainingParsed.findIndex((p) =>
        fuzzyMatch(p.rawDescription, exp.rawDescription ?? "")
      );
      if (idx < 0) {
        console.log(`    ✗ MISSING: "${exp.rawDescription}"`);
        divergences += 1;
        continue;
      }
      const parsed = remainingParsed.splice(idx, 1)[0];
      const qtyOk = exp.quantityPacks == null || exp.quantityPacks === parsed.quantityPacks;
      const unitOk = exp.unitCostCents == null || exp.unitCostCents === parsed.unitCostCents;
      const extOk =
        exp.extPriceCents == null || exp.extPriceCents === parsed.extPriceCents;
      const allOk = qtyOk && unitOk && extOk;
      const marker = allOk ? "✓" : "✗";
      console.log(`    ${marker} "${exp.rawDescription}"`);
      if (!qtyOk) {
        console.log(`        qty: expected=${exp.quantityPacks}  got=${parsed.quantityPacks}`);
        divergences += 1;
      }
      if (!unitOk) {
        console.log(`        unit cost: expected=${fmt(exp.unitCostCents)}  got=${fmt(parsed.unitCostCents)}`);
        divergences += 1;
      }
      if (!extOk) {
        console.log(`        ext price: expected=${fmt(exp.extPriceCents)}  got=${fmt(parsed.extPriceCents)}`);
        divergences += 1;
      }
    }
    if (remainingParsed.length > 0) {
      console.log(`    (note: ${remainingParsed.length} extra parsed line(s) not in expected)`);
    }
  }

  console.log(
    `\n  Divergences: ${divergences}${divergences === 0 ? " — clean run" : ""}`
  );
}

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
process.exit(divergences > 0 ? 2 : 0);

// ────────────────────────────────────────────────────────────────────

function mimeFromExt(ext: string): string | null {
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".heic":
      return "image/heic";
    default:
      return null;
  }
}

function fmt(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function fuzzyMatch(a: string, b: string): boolean {
  const tok = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3);
  const aT = new Set(tok(a));
  const bT = tok(b);
  if (bT.length === 0) return aT.size === 0;
  let shared = 0;
  for (const t of bT) if (aT.has(t)) shared += 1;
  return shared >= Math.max(1, Math.ceil(bT.length / 2));
}

type FlagShape =
  | { kind: "line_math_mismatch"; lineIndex: number; delta: number }
  | { kind: "subtotal_mismatch"; reportedCents: number; sumCents: number }
  | { kind: "supplier_name_mismatch"; invoiceName: string; expectedName: string }
  | { kind: "quantity_outlier"; lineIndex: number; ordered: number; reported: number };

function describeFlag(f: FlagShape, result: { lines: Array<{ rawDescription: string }> }): string {
  switch (f.kind) {
    case "line_math_mismatch": {
      const line = result.lines[f.lineIndex];
      const sign = f.delta > 0 ? "over" : "under";
      return `Line ${f.lineIndex + 1} ("${line?.rawDescription ?? "?"}"): row total off by ${fmt(Math.abs(f.delta))} ${sign}.`;
    }
    case "subtotal_mismatch":
      return `Subtotal mismatch: invoice printed ${fmt(f.reportedCents)}, line items sum to ${fmt(f.sumCents)}.`;
    case "supplier_name_mismatch":
      return `Supplier-name mismatch: invoice says "${f.invoiceName}", PO expects "${f.expectedName}".`;
    case "quantity_outlier": {
      const line = result.lines[f.lineIndex];
      return `Line ${f.lineIndex + 1} ("${line?.rawDescription ?? "?"}"): parsed qty ${f.reported} vs ordered ${f.ordered} — ${(f.reported / f.ordered).toFixed(1)}× ordered, possible misread.`;
    }
  }
}

function printHelp() {
  console.log(`
Usage: npm run smoke:invoice -- <image> [flags]

Flags:
  --expected <path>   Ground-truth JSON to diff against (see scripts/smoke-invoice.mts for shape)
  --po       <path>   PO context JSON (ordered lines with ids)
  --model    <id>     Override VISION_MODEL env var
  --json              Machine-readable JSON output only
  --help              This text

Exit codes:
  0  clean run (or no --expected given, parse ok)
  1  OCR failed (ok=false)
  2  ground-truth comparison found divergences
`);
}
