import test from "node:test";
import assert from "node:assert/strict";

import {
  canCancelPurchaseOrder,
  canDeliverPurchaseOrder,
  canMarkPurchaseOrderSent,
  normalizeReceivedPackCount,
  receivedQuantityBaseFromPacks,
} from "./lifecycle";

test("purchase order lifecycle: only approved orders can be marked sent directly", () => {
  assert.equal(canMarkPurchaseOrderSent("APPROVED"), true);
  assert.equal(canMarkPurchaseOrderSent("SENT"), false);
});

test("purchase order lifecycle: delivery is allowed until the order is closed", () => {
  assert.equal(canDeliverPurchaseOrder("ACKNOWLEDGED"), true);
  assert.equal(canDeliverPurchaseOrder("DELIVERED"), false);
  assert.equal(canCancelPurchaseOrder("CANCELLED"), false);
});

test("purchase order lifecycle: receiving uses fallback quantities and pack-size math", () => {
  assert.equal(normalizeReceivedPackCount("2", 1), 2);
  assert.equal(normalizeReceivedPackCount("", 3), 3);
  assert.equal(receivedQuantityBaseFromPacks(2, 8000), 16000);
});
