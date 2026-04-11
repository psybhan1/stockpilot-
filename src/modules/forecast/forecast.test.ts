import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateAverageDailyUsage,
  calculateDaysLeft,
  classifyUrgency,
} from "./forecast";

test("forecasting: computes daily usage from recent depletion", () => {
  assert.equal(calculateAverageDailyUsage(2800, 7), 400);
});

test("forecasting: computes days left from stock and usage", () => {
  assert.ok(Math.abs((calculateDaysLeft(3500, 1300) ?? 0) - 2.6923) < 0.001);
});

test("forecasting: marks inventory critical when days left is inside lead time", () => {
  assert.equal(
    classifyUrgency({
      daysLeft: 1.5,
      leadTimeDays: 2,
      safetyDays: 1,
    }),
    "CRITICAL"
  );
});
