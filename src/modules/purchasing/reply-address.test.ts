import test from "node:test";
import assert from "node:assert/strict";

import { env } from "../../lib/env";
import {
  buildSupplierReplyAddress,
  parsePurchaseOrderIdFromReplyAddress,
} from "./reply-address";

// env.REPLY_DOMAIN is read at call time by reply-address (not at
// import). Other test files may have already triggered env.ts with
// REPLY_DOMAIN unset, so we mutate the exported object here. Safe
// because env is a plain object (not frozen).
(env as { REPLY_DOMAIN: string | null }).REPLY_DOMAIN =
  "reply.stockpilot-test.app";

// ── buildSupplierReplyAddress ───────────────────────────────────

test("buildSupplierReplyAddress: returns reply+<poId>@<domain> for a valid PO", () => {
  assert.equal(
    buildSupplierReplyAddress("clx1abc2def3ghi4"),
    "reply+clx1abc2def3ghi4@reply.stockpilot-test.app",
  );
});

test("buildSupplierReplyAddress: null/undefined/empty PO id → null", () => {
  assert.equal(buildSupplierReplyAddress(null), null);
  assert.equal(buildSupplierReplyAddress(undefined), null);
  assert.equal(buildSupplierReplyAddress(""), null);
});

// ── parsePurchaseOrderIdFromReplyAddress: happy path ─────────────

test("parse: extracts PO id from a bare reply+<id>@<domain> address", () => {
  assert.equal(
    parsePurchaseOrderIdFromReplyAddress(
      "reply+clx1abc2def3ghi4@reply.stockpilot-test.app",
    ),
    "clx1abc2def3ghi4",
  );
});

test("parse: unwraps angle-bracket display format ('Name <addr>')", () => {
  assert.equal(
    parsePurchaseOrderIdFromReplyAddress(
      `"Replies" <reply+clx1abc2def3ghi4@reply.stockpilot-test.app>`,
    ),
    "clx1abc2def3ghi4",
  );
});

test("parse: handles just the angle-bracket form without display name", () => {
  assert.equal(
    parsePurchaseOrderIdFromReplyAddress(
      "<reply+clx1abc2def3ghi4@reply.stockpilot-test.app>",
    ),
    "clx1abc2def3ghi4",
  );
});

test("parse: case-insensitive domain matching (email addresses are case-insensitive)", () => {
  // Gmail etc. sometimes uppercase the domain in forwards.
  assert.equal(
    parsePurchaseOrderIdFromReplyAddress(
      "reply+clx1abc2def3ghi4@REPLY.STOCKPILOT-TEST.APP",
    ),
    "clx1abc2def3ghi4",
  );
});

test("parse: tolerates surrounding whitespace on the header value", () => {
  assert.equal(
    parsePurchaseOrderIdFromReplyAddress(
      "   reply+clx1abc2def3ghi4@reply.stockpilot-test.app   ",
    ),
    "clx1abc2def3ghi4",
  );
});

// ── parsePurchaseOrderIdFromReplyAddress: rejection paths ────────

test("parse: null/undefined/empty recipient → null (no crash)", () => {
  assert.equal(parsePurchaseOrderIdFromReplyAddress(null), null);
  assert.equal(parsePurchaseOrderIdFromReplyAddress(undefined), null);
  assert.equal(parsePurchaseOrderIdFromReplyAddress(""), null);
});

test("parse: domain mismatch → null (reply to another tenant never routes here)", () => {
  assert.equal(
    parsePurchaseOrderIdFromReplyAddress(
      "reply+clx1abc2def3ghi4@not-our-domain.example.com",
    ),
    null,
  );
});

test("parse: address without 'reply+' local-part prefix → null", () => {
  // Plain "orders@reply.stockpilot-test.app" isn't a PO reply —
  // reject so we don't mis-attribute a human email.
  assert.equal(
    parsePurchaseOrderIdFromReplyAddress(
      "orders@reply.stockpilot-test.app",
    ),
    null,
  );
});

test("parse: 'reply+' with EMPTY id → null (no silent fallback)", () => {
  assert.equal(
    parsePurchaseOrderIdFromReplyAddress(
      "reply+@reply.stockpilot-test.app",
    ),
    null,
  );
});

test("parse: rejects PO id shorter than 10 chars (not a real cuid)", () => {
  assert.equal(
    parsePurchaseOrderIdFromReplyAddress(
      "reply+abc@reply.stockpilot-test.app",
    ),
    null,
  );
});

test("parse: rejects PO id longer than 50 chars (injection/DoS guard)", () => {
  const huge = "a".repeat(60);
  assert.equal(
    parsePurchaseOrderIdFromReplyAddress(
      `reply+${huge}@reply.stockpilot-test.app`,
    ),
    null,
  );
});

test("parse: rejects PO id with non-alphanumeric chars (sanitises injection)", () => {
  // A crafted local-part like "reply+'; DROP TABLE--" must NOT pass.
  for (const bad of [
    "reply+foo-bar-baz-10chars@reply.stockpilot-test.app",
    "reply+foo.bar.baz.10chars@reply.stockpilot-test.app",
    "reply+foo_bar_baz_10chars@reply.stockpilot-test.app",
    "reply+foo bar baz 10char@reply.stockpilot-test.app",
    "reply+'; DROP TABLE--@reply.stockpilot-test.app",
    "reply+<script>alert@reply.stockpilot-test.app",
  ]) {
    assert.equal(
      parsePurchaseOrderIdFromReplyAddress(bad),
      null,
      `address ${JSON.stringify(bad)} should have been rejected`,
    );
  }
});

test("parse: rejects addresses missing the @ separator", () => {
  assert.equal(
    parsePurchaseOrderIdFromReplyAddress("reply+clx1abc2def3ghi4-no-at"),
    null,
  );
});

test("parse: rejects addresses with no local part", () => {
  assert.equal(
    parsePurchaseOrderIdFromReplyAddress("@reply.stockpilot-test.app"),
    null,
  );
});

test("parse: wrong subdomain (reply.OTHER-tenant.com) → null", () => {
  // Regression: substring matching on the domain would let an
  // attacker register "reply.stockpilot-test.app.evil.com" and route
  // legitimate supplier replies to themselves. Ensure equality check,
  // not suffix check.
  assert.equal(
    parsePurchaseOrderIdFromReplyAddress(
      "reply+clx1abc2def3ghi4@reply.stockpilot-test.app.evil.com",
    ),
    null,
  );
});

test("parse: lowercases the PO id consistently", () => {
  // Gmail uppercases nothing but Outlook mangles some headers.
  // Lowercasing is already done by .toLowerCase() in source; lock it.
  assert.equal(
    parsePurchaseOrderIdFromReplyAddress(
      "REPLY+CLX1ABC2DEF3GHI4@reply.stockpilot-test.app",
    ),
    "clx1abc2def3ghi4",
  );
});

test("parse: garbage input does not throw", () => {
  // Fuzzed inbound headers. All should return null; none should
  // throw or infinite-loop.
  const junk = [
    "<<<<not a real address>>>",
    "reply+@@@",
    "reply+" + "x".repeat(10_000) + "@reply.stockpilot-test.app",
    "\0\0\0",
    " ".repeat(500),
  ];
  for (const input of junk) {
    assert.doesNotThrow(() => parsePurchaseOrderIdFromReplyAddress(input));
    assert.equal(parsePurchaseOrderIdFromReplyAddress(input), null);
  }
});

// ── Round-trip contract ──────────────────────────────────────────

test("build → parse round-trips the PO id", () => {
  const poId = "clx1abc2def3ghi4jkl5";
  const addr = buildSupplierReplyAddress(poId);
  assert.ok(addr, "build should return a non-null address");
  assert.equal(parsePurchaseOrderIdFromReplyAddress(addr), poId);
});

test("build → parse round-trips even when the header is angle-bracket-wrapped", () => {
  const poId = "clx9xyz8abc7def6";
  const addr = buildSupplierReplyAddress(poId);
  const wrapped = `"StockPilot Replies" <${addr}>`;
  assert.equal(parsePurchaseOrderIdFromReplyAddress(wrapped), poId);
});
