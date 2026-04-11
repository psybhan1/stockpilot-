import test from "node:test";
import assert from "node:assert/strict";

import { isCountStale, isHighUsageSpike } from "./anomalies";

test("anomalies: flags stale counts when no recent count exists", () => {
  assert.equal(isCountStale(new Date("2026-04-01T09:00:00.000Z"), 3, new Date("2026-04-05T09:00:00.000Z")), true);
  assert.equal(isCountStale(new Date("2026-04-04T09:00:00.000Z"), 3, new Date("2026-04-05T09:00:00.000Z")), false);
});

test("anomalies: flags usage spikes when recent usage breaks the baseline band", () => {
  assert.equal(
    isHighUsageSpike({
      recentAverageDailyUsageBase: 90,
      baselineAverageDailyUsageBase: 50,
      multiplier: 1.5,
      minimumDeltaBase: 10,
    }),
    true
  );

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
