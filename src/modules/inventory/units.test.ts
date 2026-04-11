import test from "node:test";
import assert from "node:assert/strict";

import {
  applyDelta,
  calculateCountAdjustment,
  convertBaseToDisplay,
  convertDisplayToBase,
} from "./units";

test("inventory units: applies ledger deltas deterministically", () => {
  assert.deepEqual(applyDelta(120, -18), {
    beforeBalanceBase: 120,
    afterBalanceBase: 102,
  });
});

test("inventory units: calculates count adjustment from expected vs counted", () => {
  assert.equal(calculateCountAdjustment(3500, 3200), -300);
});

test("inventory units: converts base quantities to display units", () => {
  assert.equal(convertBaseToDisplay(3500, "LITER"), 3.5);
  assert.equal(convertBaseToDisplay(200, "CASE", 100), 2);
});

test("inventory units: converts display quantities back to base units", () => {
  assert.equal(convertDisplayToBase(2, "LITER"), 2000);
  assert.equal(convertDisplayToBase(2, "CASE", 12), 24);
});
