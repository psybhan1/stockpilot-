import test from "node:test";
import assert from "node:assert/strict";
import { getDay, isAfter } from "date-fns";

import {
  buildRecommendationSummary,
  calculateRecommendedOrder,
  getApprovalOutcome,
  getNextDeliveryDate,
} from "./reorder";

// ─── calculateRecommendedOrder ───────────────────────────────────────────────

test("calculateRecommendedOrder: rounds up to pack size and MOQ", () => {
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

test("calculateRecommendedOrder: honors MOQ as floor even if demand is small", () => {
  const result = calculateRecommendedOrder({
    stockOnHandBase: 0,
    averageDailyUsageBase: 10,
    parLevelBase: 100,
    safetyStockBase: 20,
    leadTimeDays: 1,
    deliveryDays: [],
    packSizeBase: 10,
    minimumOrderQuantity: 20, // operator forces 20-pack minimum
  });

  assert.equal(result.recommendedPackCount, 20);
  assert.equal(result.recommendedOrderQuantityBase, 200);
});

test("calculateRecommendedOrder: brand-new item with no usage history still orders to par", () => {
  // averageDailyUsage=0 means demandCoverage=0, but par+safety should
  // still drive a sensible order.
  const result = calculateRecommendedOrder({
    stockOnHandBase: 0,
    averageDailyUsageBase: 0,
    parLevelBase: 5000,
    safetyStockBase: 1000,
    leadTimeDays: 2,
    deliveryDays: [3],
    packSizeBase: 1000,
    minimumOrderQuantity: 1,
  });

  // target = max(par+safety=6000, 0+safety=1000) = 6000 → 6 packs
  assert.equal(result.recommendedPackCount, 6);
  assert.equal(result.recommendedOrderQuantityBase, 6000);
});

test("calculateRecommendedOrder: demand-coverage dominates when usage is high", () => {
  // par+safety is small; high burn rate drives the target up.
  const result = calculateRecommendedOrder({
    stockOnHandBase: 0,
    averageDailyUsageBase: 1000,
    parLevelBase: 500,
    safetyStockBase: 200,
    leadTimeDays: 3,
    deliveryDays: [],
    packSizeBase: 500,
    minimumOrderQuantity: 1,
  });

  // daysUntilCoverageTarget = max(3+2, 3) = 5
  // demand = 1000 * 5 = 5000
  // target = max(500+200=700, 5000+200=5200) = 5200
  // needed = 5200
  // packs = ceil(5200/500) = 11 → 11 * 500 = 5500
  assert.equal(result.recommendedPackCount, 11);
  assert.equal(result.recommendedOrderQuantityBase, 5500);
});

test("calculateRecommendedOrder: zero pack size is treated as 1 (guards /0)", () => {
  const result = calculateRecommendedOrder({
    stockOnHandBase: 0,
    averageDailyUsageBase: 5,
    parLevelBase: 20,
    safetyStockBase: 5,
    leadTimeDays: 1,
    deliveryDays: [],
    packSizeBase: 0, // bad data
    minimumOrderQuantity: 1,
  });

  // Treated as packSize=1, so packCount = ceil(needed/1) = needed
  assert.equal(result.recommendedOrderQuantityBase, 25);
  assert.ok(result.recommendedPackCount >= 1);
});

test("calculateRecommendedOrder: stock at target, MOQ=1 still orders one pack", () => {
  // Documents current behavior: needed=0 still produces a 1-pack order
  // because MOQ acts as a floor. Callers gate whether to call this at all.
  const result = calculateRecommendedOrder({
    stockOnHandBase: 10000,
    averageDailyUsageBase: 10,
    parLevelBase: 500,
    safetyStockBase: 100,
    leadTimeDays: 1,
    deliveryDays: [],
    packSizeBase: 100,
    minimumOrderQuantity: 1,
  });

  assert.equal(result.recommendedPackCount, 1);
  assert.equal(result.recommendedOrderQuantityBase, 100);
});

test("calculateRecommendedOrder: lead time of 0 still gets 3-day coverage floor", () => {
  // daysUntilCoverageTarget = max(0+2, 3) = 3
  const result = calculateRecommendedOrder({
    stockOnHandBase: 0,
    averageDailyUsageBase: 100,
    parLevelBase: 0,
    safetyStockBase: 0,
    leadTimeDays: 0,
    deliveryDays: [],
    packSizeBase: 50,
    minimumOrderQuantity: 1,
  });

  // demand = 100 * 3 = 300 → 6 packs
  assert.equal(result.recommendedPackCount, 6);
  assert.equal(result.recommendedOrderQuantityBase, 300);
});

test("calculateRecommendedOrder: returns a projected delivery date", () => {
  const result = calculateRecommendedOrder({
    stockOnHandBase: 0,
    averageDailyUsageBase: 10,
    parLevelBase: 100,
    safetyStockBase: 20,
    leadTimeDays: 1,
    deliveryDays: [],
    packSizeBase: 10,
    minimumOrderQuantity: 1,
  });

  assert.ok(result.projectedDeliveryDate instanceof Date);
});

// ─── getNextDeliveryDate ─────────────────────────────────────────────────────

test("getNextDeliveryDate: empty array → tomorrow (best-effort default)", () => {
  const today = new Date();
  const result = getNextDeliveryDate([]);
  assert.ok(isAfter(result, today));
  // Tomorrow should be within 2 days
  const diff = (result.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  assert.ok(diff > 0 && diff <= 2);
});

test("getNextDeliveryDate: single weekday returns that weekday within a week", () => {
  const result = getNextDeliveryDate([3]); // Wednesday
  assert.equal(getDay(result), 3);
  const today = new Date();
  assert.ok(isAfter(result, today));
  const diff = (result.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  assert.ok(diff > 0 && diff <= 7);
});

test("getNextDeliveryDate: multiple weekdays picks the nearest one", () => {
  // Given all weekdays, the nearest should be within 1 week of today.
  const result = getNextDeliveryDate([0, 1, 2, 3, 4, 5, 6]);
  const today = new Date();
  const diff = (result.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  assert.ok(diff > 0 && diff <= 7);
});

// ─── buildRecommendationSummary ──────────────────────────────────────────────

test("buildRecommendationSummary: CRITICAL wording mentions stockout risk", () => {
  const summary = buildRecommendationSummary({
    inventoryName: "Whole milk",
    recommendedPackCount: 4,
    purchaseUnit: "CASE",
    supplierName: "Sysco",
    urgency: "CRITICAL",
  });

  assert.match(summary, /Order 4 case of Whole milk from Sysco/);
  assert.match(summary, /stockout/i);
});

test("buildRecommendationSummary: WARNING wording emphasizes staying above safety", () => {
  const summary = buildRecommendationSummary({
    inventoryName: "Olive oil",
    recommendedPackCount: 2,
    purchaseUnit: "BOTTLE",
    supplierName: "US Foods",
    urgency: "WARNING",
  });

  assert.match(summary, /Order 2 bottle of Olive oil from US Foods/);
  assert.match(summary, /safety stock/i);
});

test("buildRecommendationSummary: purchase unit is lowercased for readability", () => {
  const summary = buildRecommendationSummary({
    inventoryName: "Flour",
    recommendedPackCount: 1,
    purchaseUnit: "BAG",
    supplierName: "Costco",
    urgency: "WARNING",
  });

  assert.match(summary, / bag /);
  assert.doesNotMatch(summary, / BAG /);
});

// ─── getApprovalOutcome ──────────────────────────────────────────────────────

test("getApprovalOutcome: WEBSITE supplier → agent-task", () => {
  assert.equal(getApprovalOutcome("WEBSITE"), "agent-task");
});

test("getApprovalOutcome: EMAIL supplier → purchase-order", () => {
  assert.equal(getApprovalOutcome("EMAIL"), "purchase-order");
});

test("getApprovalOutcome: MANUAL supplier → purchase-order (fallback)", () => {
  assert.equal(getApprovalOutcome("MANUAL"), "purchase-order");
});
