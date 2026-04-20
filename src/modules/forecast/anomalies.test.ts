import test from "node:test";
import assert from "node:assert/strict";

import { isCountStale, isHighUsageSpike } from "./anomalies";

// ─── isCountStale ────────────────────────────────────────────────────────────

test("isCountStale: null lastCountedAt → stale (no count ever)", () => {
  assert.equal(isCountStale(null), true);
});

test("isCountStale: undefined lastCountedAt → stale", () => {
  assert.equal(isCountStale(undefined), true);
});

test("isCountStale: 4 days old vs 3-day limit → stale", () => {
  assert.equal(
    isCountStale(
      new Date("2026-04-01T09:00:00.000Z"),
      3,
      new Date("2026-04-05T09:00:00.000Z")
    ),
    true
  );
});

test("isCountStale: exactly at threshold → stale (>= comparison)", () => {
  assert.equal(
    isCountStale(
      new Date("2026-04-01T09:00:00.000Z"),
      3,
      new Date("2026-04-04T09:00:00.000Z")
    ),
    true
  );
});

test("isCountStale: 1 day old vs 3-day limit → fresh", () => {
  assert.equal(
    isCountStale(
      new Date("2026-04-04T09:00:00.000Z"),
      3,
      new Date("2026-04-05T09:00:00.000Z")
    ),
    false
  );
});

test("isCountStale: default maxAgeDays=3", () => {
  const now = new Date("2026-04-10T09:00:00.000Z");
  const fiveDaysAgo = new Date("2026-04-05T09:00:00.000Z");
  assert.equal(isCountStale(fiveDaysAgo, undefined, now), true);
});

test("isCountStale: future lastCountedAt (clock skew) → not stale", () => {
  // Should not flag items counted in the "future" (e.g. clock skew,
  // test seed data). Safer to trust the stamp than panic.
  const now = new Date("2026-04-05T09:00:00.000Z");
  const future = new Date("2026-04-10T09:00:00.000Z");
  assert.equal(isCountStale(future, 3, now), false);
});

test("isCountStale: custom maxAgeDays=7 (weekly count cadence)", () => {
  const now = new Date("2026-04-10T09:00:00.000Z");
  const fiveDaysAgo = new Date("2026-04-05T09:00:00.000Z");
  assert.equal(isCountStale(fiveDaysAgo, 7, now), false);
});

// ─── isHighUsageSpike ────────────────────────────────────────────────────────

test("isHighUsageSpike: 90 vs 50 baseline, 1.5x, +10 delta → spike", () => {
  assert.equal(
    isHighUsageSpike({
      recentAverageDailyUsageBase: 90,
      baselineAverageDailyUsageBase: 50,
      multiplier: 1.5,
      minimumDeltaBase: 10,
    }),
    true
  );
});

test("isHighUsageSpike: 55 vs 50 baseline → not a spike (fails multiplier)", () => {
  assert.equal(
    isHighUsageSpike({
      recentAverageDailyUsageBase: 55,
      baselineAverageDailyUsageBase: 50,
      multiplier: 1.5,
      minimumDeltaBase: 10,
    }),
    false
  );
});

test("isHighUsageSpike: meets multiplier but not delta → not a spike", () => {
  // 0.3 is 3× 0.1 (beats 1.5x), but delta is only 0.2, under min delta.
  // Prevents flagging tiny items (e.g. saffron) where noise can beat the ratio.
  assert.equal(
    isHighUsageSpike({
      recentAverageDailyUsageBase: 0.3,
      baselineAverageDailyUsageBase: 0.1,
      multiplier: 1.5,
      minimumDeltaBase: 1,
    }),
    false
  );
});

test("isHighUsageSpike: zero baseline → not a spike (requires history)", () => {
  // Intentional: 'spike' is comparative. First-time usage needs a
  // separate detector (we have alerts for that), not this one.
  assert.equal(
    isHighUsageSpike({
      recentAverageDailyUsageBase: 100,
      baselineAverageDailyUsageBase: 0,
    }),
    false
  );
});

test("isHighUsageSpike: zero recent usage → not a spike", () => {
  assert.equal(
    isHighUsageSpike({
      recentAverageDailyUsageBase: 0,
      baselineAverageDailyUsageBase: 50,
    }),
    false
  );
});

test("isHighUsageSpike: negative baseline → not a spike (bad data)", () => {
  assert.equal(
    isHighUsageSpike({
      recentAverageDailyUsageBase: 100,
      baselineAverageDailyUsageBase: -10,
    }),
    false
  );
});

test("isHighUsageSpike: defaults (1.5x + 1 min delta)", () => {
  assert.equal(
    isHighUsageSpike({
      recentAverageDailyUsageBase: 80,
      baselineAverageDailyUsageBase: 50,
    }),
    true
  );
});

test("isHighUsageSpike: exactly at multiplier threshold → spike (inclusive)", () => {
  assert.equal(
    isHighUsageSpike({
      recentAverageDailyUsageBase: 75, // 50 * 1.5
      baselineAverageDailyUsageBase: 50,
      multiplier: 1.5,
      minimumDeltaBase: 1,
    }),
    true
  );
});

test("isHighUsageSpike: custom 2x multiplier for quieter signal", () => {
  assert.equal(
    isHighUsageSpike({
      recentAverageDailyUsageBase: 90,
      baselineAverageDailyUsageBase: 50,
      multiplier: 2,
      minimumDeltaBase: 1,
    }),
    false
  );
  assert.equal(
    isHighUsageSpike({
      recentAverageDailyUsageBase: 110,
      baselineAverageDailyUsageBase: 50,
      multiplier: 2,
      minimumDeltaBase: 1,
    }),
    true
  );
});
