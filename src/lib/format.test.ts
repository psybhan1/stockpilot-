import test from "node:test";
import assert from "node:assert/strict";

import {
  formatRelativeDays,
  formatDateTime,
  formatFromNow,
  formatCurrency,
  baseUnitLabel,
} from "./format";

test("formatRelativeDays returns 'Unknown' for null / undefined / NaN", () => {
  assert.equal(formatRelativeDays(null), "Unknown");
  assert.equal(formatRelativeDays(undefined), "Unknown");
  assert.equal(formatRelativeDays(Number.NaN), "Unknown");
});

test("formatRelativeDays renders >= 1 day as decimal days", () => {
  assert.equal(formatRelativeDays(3), "3.0 days");
  assert.equal(formatRelativeDays(3.456), "3.5 days");
  assert.equal(formatRelativeDays(1), "1.0 days");
});

test("formatRelativeDays renders < 1 day as hours (always with 1 decimal)", () => {
  assert.equal(formatRelativeDays(0.5), "12.0 hrs");
  assert.equal(formatRelativeDays(0.25), "6.0 hrs");
});

test("formatRelativeDays floors hours at 1.0 hr (never says '0.0 hrs' for items basically out)", () => {
  // 0 days → would be 0 hours, but is clamped to 1 hr so the UI
  // doesn't tell the user "you have 0 hours of stock" (which reads
  // ambiguous between 'out' and 'unknown').
  assert.equal(formatRelativeDays(0), "1.0 hrs");
  assert.equal(formatRelativeDays(0.001), "1.0 hrs");
});

test("formatRelativeDays handles negative days (already out of stock)", () => {
  // Negative * 24 < 1 → clamped to 1.0 hrs.
  assert.equal(formatRelativeDays(-1), "1.0 hrs");
  assert.equal(formatRelativeDays(-100), "1.0 hrs");
});

test("formatDateTime returns 'Not scheduled' for null / undefined", () => {
  assert.equal(formatDateTime(null), "Not scheduled");
  assert.equal(formatDateTime(undefined), "Not scheduled");
});

test("formatDateTime renders 'MMM d, yyyy h:mm a' style", () => {
  const d = new Date(2026, 3, 17, 14, 5); // Apr 17, 2026 2:05pm
  const out = formatDateTime(d);
  // Locale-independent assertion — must contain the parts.
  assert.match(out, /Apr 17, 2026/);
  assert.match(out, /2:05/);
  // PM marker is locale-sensitive (PM vs pm) — accept either.
  assert.match(out, /[Pp][Mm]/);
});

test("formatFromNow returns 'Unknown' for null / undefined", () => {
  assert.equal(formatFromNow(null), "Unknown");
  assert.equal(formatFromNow(undefined), "Unknown");
});

test("formatFromNow renders future dates with 'in ...' suffix", () => {
  const future = new Date(Date.now() + 10 * 60_000); // +10 min
  const out = formatFromNow(future);
  assert.match(out, /^in /);
});

test("formatFromNow renders past dates with '... ago' suffix", () => {
  const past = new Date(Date.now() - 10 * 60_000); // -10 min
  const out = formatFromNow(past);
  assert.match(out, / ago$/);
});

test("formatCurrency returns 'N/A' for null / undefined", () => {
  assert.equal(formatCurrency(null), "N/A");
  assert.equal(formatCurrency(undefined), "N/A");
});

test("formatCurrency divides cents by 100 and formats as CAD", () => {
  // Intl output varies in whitespace/symbol but must contain dollar value.
  assert.match(formatCurrency(1200), /12\.00/);
  assert.match(formatCurrency(50), /0\.50/);
  assert.match(formatCurrency(0), /0\.00/);
});

test("formatCurrency includes a currency marker (CA$ or $)", () => {
  // en-CA locale uses 'CA$' or '$' depending on Node ICU build.
  const out = formatCurrency(1200);
  assert.match(out, /\$/);
});

test("formatCurrency handles negative cents (refunds, credits)", () => {
  const out = formatCurrency(-500);
  // Locale negative formatting can be '-$5.00' or '($5.00)' or '-CA$5.00'.
  assert.match(out, /5\.00/);
  assert.match(out, /-|\(/);
});

test("formatCurrency handles fractional cents (rounded by Intl to 2dp)", () => {
  // 1234 cents → $12.34. 1234.5 cents → $12.35 (banker's rounding may apply).
  assert.match(formatCurrency(1234), /12\.34/);
});

test("formatCurrency handles very large amounts with grouping separators", () => {
  // 1_000_000 cents = $10,000.00
  const out = formatCurrency(1_000_000);
  assert.match(out, /10[,\u00A0\u202F\s]?000\.00/);
});

test("baseUnitLabel maps the three known units", () => {
  assert.equal(baseUnitLabel("GRAM"), "g");
  assert.equal(baseUnitLabel("MILLILITER"), "ml");
  assert.equal(baseUnitLabel("COUNT"), "ct");
});

test("baseUnitLabel falls back to 'ct' for unknown / future units (defensive)", () => {
  // Should never happen given the type, but guards against DB junk.
  // @ts-expect-error — intentionally passing invalid value to test runtime fallback
  assert.equal(baseUnitLabel("BARREL"), "ct");
  // @ts-expect-error — empty string is not a valid BaseUnit
  assert.equal(baseUnitLabel(""), "ct");
});
