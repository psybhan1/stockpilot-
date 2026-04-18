import test from "node:test";
import assert from "node:assert/strict";

import { summarizePriceChange, type PriceHistoryPoint } from "./math";

function point(at: string, unitCostCents: number, idx = 0): PriceHistoryPoint {
  return {
    at,
    unitCostCents,
    supplierId: `sup-${idx}`,
    supplierName: `Supplier ${idx}`,
    purchaseOrderId: `po-${idx}`,
    orderNumber: `PO-${idx}`,
  };
}

// ── Empty / degenerate inputs ───────────────────────────────────────

test("empty input: all null, 'unknown' trend, 'clean' severity", () => {
  const s = summarizePriceChange([]);
  assert.deepEqual(s, {
    currentCents: null,
    baselineCents: null,
    deltaCents: null,
    deltaPct: null,
    trend: "unknown",
    severity: "clean",
    points: 0,
  });
});

test("single point: current is set but baseline/delta null (UI: 'not enough data')", () => {
  // One delivery doesn't establish a trend. UI shows the current
  // price but can't say "up 5%".
  const s = summarizePriceChange([point("2026-04-01", 500)]);
  assert.equal(s.currentCents, 500);
  assert.equal(s.baselineCents, null);
  assert.equal(s.deltaCents, null);
  assert.equal(s.deltaPct, null);
  assert.equal(s.trend, "unknown");
  assert.equal(s.severity, "clean");
  assert.equal(s.points, 1);
});

// ── Trend classification ────────────────────────────────────────────

test("two points, later price higher → trend 'up'", () => {
  const s = summarizePriceChange([
    point("2026-04-01", 500),
    point("2026-04-10", 520),
  ]);
  assert.equal(s.trend, "up");
  assert.equal(s.currentCents, 520);
  assert.equal(s.baselineCents, 500);
  assert.equal(s.deltaCents, 20);
  assert.ok(s.deltaPct != null);
  assert.ok(Math.abs((s.deltaPct as number) - 0.04) < 1e-9);
});

test("two points, later price lower → trend 'down'", () => {
  const s = summarizePriceChange([
    point("2026-04-01", 500),
    point("2026-04-10", 450),
  ]);
  assert.equal(s.trend, "down");
  assert.equal(s.deltaCents, -50);
});

test("two points at same price → trend 'flat', severity 'clean'", () => {
  const s = summarizePriceChange([
    point("2026-04-01", 500),
    point("2026-04-10", 500),
  ]);
  assert.equal(s.trend, "flat");
  assert.equal(s.deltaCents, 0);
  assert.equal(s.deltaPct, 0);
  assert.equal(s.severity, "clean");
});

// ── Severity band thresholds ────────────────────────────────────────

test("severity 'clean' for swings under 5% absolute", () => {
  // 4% up — noise, not worth flagging.
  const s = summarizePriceChange([
    point("2026-04-01", 100),
    point("2026-04-10", 104),
  ]);
  assert.equal(s.severity, "clean");
});

test("severity 'watch' at exactly the 5% absolute boundary (inclusive)", () => {
  const s = summarizePriceChange([
    point("2026-04-01", 100),
    point("2026-04-10", 105),
  ]);
  assert.equal(s.severity, "watch");
});

test("severity 'watch' for swings between 5% and 15%", () => {
  const s = summarizePriceChange([
    point("2026-04-01", 100),
    point("2026-04-10", 112),
  ]);
  assert.equal(s.severity, "watch");
});

test("severity 'review' at exactly the 15% absolute boundary (inclusive)", () => {
  const s = summarizePriceChange([
    point("2026-04-01", 100),
    point("2026-04-10", 115),
  ]);
  assert.equal(s.severity, "review");
});

test("severity 'review' for big swings", () => {
  // 30% up — definitely a margin attack.
  const s = summarizePriceChange([
    point("2026-04-01", 100),
    point("2026-04-10", 130),
  ]);
  assert.equal(s.severity, "review");
});

test("severity triggers on ABSOLUTE pct — drops are flagged as loudly as hikes", () => {
  // A 20% drop means a supplier discount OR a data-entry mistake.
  // Either way the operator should look.
  const s = summarizePriceChange([
    point("2026-04-01", 100),
    point("2026-04-10", 80),
  ]);
  assert.equal(s.trend, "down");
  assert.equal(s.severity, "review");
});

// ── Sorting: input order doesn't matter ────────────────────────────

test("unsorted input is sorted chronologically before summarising", () => {
  // If someone passes points in reverse order, we still get the
  // right baseline/current — not the reverse.
  const s = summarizePriceChange([
    point("2026-04-10", 520),
    point("2026-04-01", 500),
  ]);
  assert.equal(s.baselineCents, 500);
  assert.equal(s.currentCents, 520);
  assert.equal(s.trend, "up");
});

test("shuffled multi-point input picks the earliest as baseline, latest as current", () => {
  const s = summarizePriceChange([
    point("2026-04-05", 510),
    point("2026-04-01", 500),
    point("2026-04-15", 525),
    point("2026-04-10", 515),
  ]);
  assert.equal(s.baselineCents, 500);
  assert.equal(s.currentCents, 525);
  assert.equal(s.points, 4);
});

test("does not mutate the caller's array", () => {
  // Internal sorted copy: sort must not reorder the input in place.
  const input = [
    point("2026-04-10", 520, 1),
    point("2026-04-01", 500, 2),
  ];
  const snapshot = input.map((p) => p.at);
  summarizePriceChange(input);
  assert.deepEqual(
    input.map((p) => p.at),
    snapshot,
    "input array should be untouched after summarisation",
  );
});

// ── Zero-baseline edge case ─────────────────────────────────────────

test("zero baseline: deltaPct is null (avoid divide-by-zero noise), severity falls to 'clean'", () => {
  // A supplier with a $0 baseline is almost always a data-entry
  // artefact (a free sample or OCR misread). We refuse to compute
  // a percentage — UI should render "—" instead of "+∞%".
  const s = summarizePriceChange([
    point("2026-04-01", 0),
    point("2026-04-10", 100),
  ]);
  assert.equal(s.baselineCents, 0);
  assert.equal(s.currentCents, 100);
  assert.equal(s.deltaCents, 100);
  assert.equal(s.deltaPct, null);
  // Trend is still "up" — we saw the price increase even if we
  // can't compute a %.
  assert.equal(s.trend, "up");
  assert.equal(s.severity, "clean");
});

test("negative baseline never happens, but if it did deltaPct stays null", () => {
  // Unit costs are unsigned-cent integers in production. This is
  // a defence-in-depth check in case bad data sneaks in.
  const s = summarizePriceChange([
    point("2026-04-01", -10),
    point("2026-04-10", 20),
  ]);
  assert.equal(s.deltaPct, null);
});

// ── Same-timestamp stability ────────────────────────────────────────

test("points with identical timestamps: later-in-array wins as 'current' (stable sort)", () => {
  // Two POs delivered the same day — we don't fabricate an order,
  // we preserve the one that came in later in the array.
  const s = summarizePriceChange([
    point("2026-04-01", 500, 1),
    point("2026-04-10", 510, 2),
    point("2026-04-10", 520, 3),
  ]);
  assert.equal(s.currentCents, 520);
  assert.equal(s.baselineCents, 500);
  assert.equal(s.points, 3);
});

// ── Points count is preserved ───────────────────────────────────────

test("reports exact number of input points", () => {
  const points = Array.from({ length: 7 }, (_, i) =>
    point(`2026-04-0${i + 1}`, 100 + i * 5, i),
  );
  assert.equal(summarizePriceChange(points).points, 7);
});
