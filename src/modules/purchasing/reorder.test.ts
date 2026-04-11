import test from "node:test";
import assert from "node:assert/strict";

import { calculateRecommendedOrder, getApprovalOutcome } from "./reorder";

test("reorder engine: rounds recommended orders to pack size and moq", () => {
  const result = calculateRecommendedOrder({
    stockOnHandBase: 3500,
    averageDailyUsageBase: 1300,
    parLevelBase: 12000,
    safetyStockBase: 3000,
    leadTimeDays: 2,
    deliveryDays: [1, 4],
    packSizeBase: 8000,
    minimumOrderQuantity: 1,
  });

  assert.equal(result.recommendedOrderQuantityBase, 16000);
  assert.equal(result.recommendedPackCount, 2);
});

test("reorder engine: routes website suppliers to agent-task approval outcomes", () => {
  assert.equal(getApprovalOutcome("WEBSITE"), "agent-task");
});
