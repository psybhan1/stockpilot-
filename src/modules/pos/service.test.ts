import test from "node:test";
import assert from "node:assert/strict";

import { getSquareWebhookJobType } from "@/modules/pos/service";

test("maps Square catalog events to catalog sync jobs", () => {
  assert.equal(getSquareWebhookJobType("catalog.version.updated"), "SYNC_CATALOG");
  assert.equal(getSquareWebhookJobType("item.updated"), "SYNC_CATALOG");
});

test("maps Square order-style events to sales sync jobs", () => {
  assert.equal(getSquareWebhookJobType("order.created"), "SYNC_SALES");
  assert.equal(getSquareWebhookJobType("payment.updated"), "SYNC_SALES");
});

test("ignores unsupported Square webhook events", () => {
  assert.equal(getSquareWebhookJobType("labor.shift.updated"), null);
  assert.equal(getSquareWebhookJobType(undefined), null);
});
