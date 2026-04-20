import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LEAD_TIME_DAYS,
  LATE_DELIVERY_BUFFER_HOURS,
  NUDGE_AFTER_HOURS,
  buildLateDeliveryKeyboard,
  buildLateDeliveryMessage,
  buildStuckReplyBusinessLine,
  buildStuckReplyGreeting,
  buildStuckReplyHtmlBody,
  buildStuckReplySubject,
  buildStuckReplyTextBody,
  computeHoursSinceSent,
  computeLeadHours,
  computeStuckReplyCutoff,
  escapeHtml,
  isLateDeliveryPromptAlreadySent,
  isLateDeliveryReady,
  isReplyNudgeAlreadySent,
  markLateDeliveryPromptSent,
  markReplyNudgeSent,
} from "./supplier-nudges-primitives";

// ── Constants ───────────────────────────────────────────────────────

test("NUDGE_AFTER_HOURS is 24 — one business day is the supplier-reply SLO", () => {
  assert.equal(NUDGE_AFTER_HOURS, 24);
});

test("LATE_DELIVERY_BUFFER_HOURS is short (2) — we want to prompt soon after the ETA slips", () => {
  assert.equal(LATE_DELIVERY_BUFFER_HOURS, 2);
});

test("DEFAULT_LEAD_TIME_DAYS is 2 — a sensible fallback when supplier hasn't set one", () => {
  assert.equal(DEFAULT_LEAD_TIME_DAYS, 2);
});

// ── Metadata marker guards ──────────────────────────────────────────

test("isReplyNudgeAlreadySent: false for null/undefined/empty metadata", () => {
  assert.equal(isReplyNudgeAlreadySent(null), false);
  assert.equal(isReplyNudgeAlreadySent(undefined), false);
  assert.equal(isReplyNudgeAlreadySent({}), false);
});

test("isReplyNudgeAlreadySent: true once nudgeSentAt is a non-empty string", () => {
  assert.equal(
    isReplyNudgeAlreadySent({ nudgeSentAt: "2026-04-18T10:00:00Z" }),
    true
  );
});

test("isReplyNudgeAlreadySent: false when nudgeSentAt is empty string", () => {
  assert.equal(isReplyNudgeAlreadySent({ nudgeSentAt: "" }), false);
});

test("isReplyNudgeAlreadySent: false when nudgeSentAt is a non-string (number/bool)", () => {
  assert.equal(isReplyNudgeAlreadySent({ nudgeSentAt: 123 }), false);
  assert.equal(isReplyNudgeAlreadySent({ nudgeSentAt: true }), false);
  assert.equal(isReplyNudgeAlreadySent({ nudgeSentAt: null }), false);
});

test("isReplyNudgeAlreadySent: ignores other metadata keys", () => {
  assert.equal(
    isReplyNudgeAlreadySent({ lateDeliveryPromptSentAt: "2026-04-18T10:00:00Z" }),
    false
  );
  assert.equal(isReplyNudgeAlreadySent({ source: "stuck_reply_nudge" }), false);
});

test("isLateDeliveryPromptAlreadySent: false for null/undefined/empty metadata", () => {
  assert.equal(isLateDeliveryPromptAlreadySent(null), false);
  assert.equal(isLateDeliveryPromptAlreadySent(undefined), false);
  assert.equal(isLateDeliveryPromptAlreadySent({}), false);
});

test("isLateDeliveryPromptAlreadySent: true once lateDeliveryPromptSentAt is a non-empty string", () => {
  assert.equal(
    isLateDeliveryPromptAlreadySent({
      lateDeliveryPromptSentAt: "2026-04-18T10:00:00Z",
    }),
    true
  );
});

test("isLateDeliveryPromptAlreadySent: ignores nudgeSentAt — different keys, different tracks", () => {
  assert.equal(
    isLateDeliveryPromptAlreadySent({ nudgeSentAt: "2026-04-18T10:00:00Z" }),
    false
  );
});

// ── Metadata writers ────────────────────────────────────────────────

test("markReplyNudgeSent: stamps ISO string onto fresh blob", () => {
  const now = new Date("2026-04-18T12:34:56.000Z");
  const result = markReplyNudgeSent({}, now);
  assert.equal(result.nudgeSentAt, "2026-04-18T12:34:56.000Z");
});

test("markReplyNudgeSent: preserves existing keys alongside nudgeSentAt", () => {
  const now = new Date("2026-04-18T12:34:56.000Z");
  const result = markReplyNudgeSent({ source: "abc", originalCommId: "x" }, now);
  assert.deepEqual(result, {
    source: "abc",
    originalCommId: "x",
    nudgeSentAt: "2026-04-18T12:34:56.000Z",
  });
});

test("markReplyNudgeSent: overwrites an existing nudgeSentAt (re-nudge)", () => {
  const now = new Date("2026-04-18T12:34:56.000Z");
  const result = markReplyNudgeSent(
    { nudgeSentAt: "2020-01-01T00:00:00.000Z" },
    now
  );
  assert.equal(result.nudgeSentAt, "2026-04-18T12:34:56.000Z");
});

test("markReplyNudgeSent: handles null/undefined input", () => {
  const now = new Date("2026-04-18T12:34:56.000Z");
  assert.deepEqual(markReplyNudgeSent(null, now), {
    nudgeSentAt: "2026-04-18T12:34:56.000Z",
  });
  assert.deepEqual(markReplyNudgeSent(undefined, now), {
    nudgeSentAt: "2026-04-18T12:34:56.000Z",
  });
});

test("markReplyNudgeSent: does not mutate the input blob", () => {
  const input: Record<string, unknown> = { source: "abc" };
  const now = new Date("2026-04-18T12:34:56.000Z");
  markReplyNudgeSent(input, now);
  assert.deepEqual(input, { source: "abc" });
});

test("markLateDeliveryPromptSent: stamps the late-delivery key, not the nudge key", () => {
  const now = new Date("2026-04-18T12:34:56.000Z");
  const result = markLateDeliveryPromptSent({}, now);
  assert.equal(result.lateDeliveryPromptSentAt, "2026-04-18T12:34:56.000Z");
  assert.equal(result.nudgeSentAt, undefined);
});

test("markLateDeliveryPromptSent: preserves other metadata", () => {
  const now = new Date("2026-04-18T12:34:56.000Z");
  const result = markLateDeliveryPromptSent(
    { source: "late-delivery", nudgeSentAt: "2026-04-17T00:00:00Z" },
    now
  );
  assert.deepEqual(result, {
    source: "late-delivery",
    nudgeSentAt: "2026-04-17T00:00:00Z",
    lateDeliveryPromptSentAt: "2026-04-18T12:34:56.000Z",
  });
});

// ── Time math ───────────────────────────────────────────────────────

test("computeStuckReplyCutoff: returns now minus 24 hours", () => {
  const now = new Date("2026-04-18T12:00:00.000Z");
  const cutoff = computeStuckReplyCutoff(now);
  assert.equal(cutoff.toISOString(), "2026-04-17T12:00:00.000Z");
});

test("computeStuckReplyCutoff: a comm from exactly 24h ago should be included (strictly before cutoff)", () => {
  const now = new Date("2026-04-18T12:00:00.000Z");
  const cutoff = computeStuckReplyCutoff(now);
  // The Prisma filter uses lt: cutoff, so anything at or before the
  // cutoff timestamp is eligible — confirm we're computing the
  // boundary correctly.
  assert.equal(now.getTime() - cutoff.getTime(), 24 * 60 * 60 * 1000);
});

test("computeLeadHours: uses default 2 days when leadTimeDays is null", () => {
  assert.equal(computeLeadHours(null), 2 * 24 + 2);
});

test("computeLeadHours: uses default when leadTimeDays is undefined", () => {
  assert.equal(computeLeadHours(undefined), 2 * 24 + 2);
});

test("computeLeadHours: uses default when leadTimeDays is 0 or negative (defensive)", () => {
  assert.equal(computeLeadHours(0), 2 * 24 + 2);
  assert.equal(computeLeadHours(-3), 2 * 24 + 2);
});

test("computeLeadHours: scales with explicit leadTimeDays + default buffer", () => {
  assert.equal(computeLeadHours(1), 24 + 2);
  assert.equal(computeLeadHours(3), 72 + 2);
  assert.equal(computeLeadHours(7), 168 + 2);
});

test("computeLeadHours: accepts an explicit buffer override", () => {
  assert.equal(computeLeadHours(2, 0), 48);
  assert.equal(computeLeadHours(2, 12), 60);
});

test("computeHoursSinceSent: null for missing sentAt", () => {
  const now = new Date("2026-04-18T12:00:00.000Z");
  assert.equal(computeHoursSinceSent(null, now), null);
  assert.equal(computeHoursSinceSent(undefined, now), null);
});

test("computeHoursSinceSent: returns fractional hours", () => {
  const sent = new Date("2026-04-18T10:30:00.000Z");
  const now = new Date("2026-04-18T12:00:00.000Z");
  assert.equal(computeHoursSinceSent(sent, now), 1.5);
});

test("computeHoursSinceSent: clock skew (sent in future) clamps to 0", () => {
  const sent = new Date("2026-04-18T13:00:00.000Z");
  const now = new Date("2026-04-18T12:00:00.000Z");
  assert.equal(computeHoursSinceSent(sent, now), 0);
});

test("computeHoursSinceSent: exact same instant returns 0", () => {
  const instant = new Date("2026-04-18T12:00:00.000Z");
  assert.equal(computeHoursSinceSent(instant, instant), 0);
});

// ── isLateDeliveryReady: the core "should we ping?" predicate ───────

test("isLateDeliveryReady: false when sentAt is missing", () => {
  assert.equal(
    isLateDeliveryReady({
      sentAt: null,
      leadTimeDays: 2,
      now: new Date("2026-04-20T00:00:00Z"),
    }),
    false
  );
});

test("isLateDeliveryReady: false when age < leadTime + buffer (still within window)", () => {
  // lead=2d (48h) + buffer=2h = 50h. 49h elapsed → not ready yet.
  assert.equal(
    isLateDeliveryReady({
      sentAt: new Date("2026-04-18T00:00:00.000Z"),
      leadTimeDays: 2,
      now: new Date("2026-04-20T01:00:00.000Z"), // 49h later
    }),
    false
  );
});

test("isLateDeliveryReady: true at exact threshold (leadTime + buffer)", () => {
  assert.equal(
    isLateDeliveryReady({
      sentAt: new Date("2026-04-18T00:00:00.000Z"),
      leadTimeDays: 2,
      now: new Date("2026-04-20T02:00:00.000Z"), // 50h later
    }),
    true
  );
});

test("isLateDeliveryReady: true when age comfortably past the threshold", () => {
  assert.equal(
    isLateDeliveryReady({
      sentAt: new Date("2026-04-18T00:00:00.000Z"),
      leadTimeDays: 2,
      now: new Date("2026-04-22T00:00:00.000Z"), // 96h later
    }),
    true
  );
});

test("isLateDeliveryReady: uses default lead time (2 days) when supplier's is null", () => {
  // Missing lead time → default 2d + 2h = 50h
  assert.equal(
    isLateDeliveryReady({
      sentAt: new Date("2026-04-18T00:00:00.000Z"),
      leadTimeDays: null,
      now: new Date("2026-04-20T03:00:00.000Z"), // 51h
    }),
    true
  );
});

test("isLateDeliveryReady: longer lead time delays the prompt", () => {
  // 7-day supplier → 7d + 2h = 170h threshold.
  // 100h elapsed → not ready.
  assert.equal(
    isLateDeliveryReady({
      sentAt: new Date("2026-04-01T00:00:00.000Z"),
      leadTimeDays: 7,
      now: new Date("2026-04-05T04:00:00.000Z"), // 100h
    }),
    false
  );
  // 200h elapsed → ready.
  assert.equal(
    isLateDeliveryReady({
      sentAt: new Date("2026-04-01T00:00:00.000Z"),
      leadTimeDays: 7,
      now: new Date("2026-04-09T08:00:00.000Z"), // 200h
    }),
    true
  );
});

test("isLateDeliveryReady: respects custom bufferHours override", () => {
  assert.equal(
    isLateDeliveryReady({
      sentAt: new Date("2026-04-18T00:00:00.000Z"),
      leadTimeDays: 2,
      now: new Date("2026-04-20T01:00:00.000Z"), // 49h after send
      bufferHours: 0, // tighter threshold → 48h
    }),
    true
  );
});

test("isLateDeliveryReady: clock skew (sent in future) → false", () => {
  assert.equal(
    isLateDeliveryReady({
      sentAt: new Date("2026-05-01T00:00:00.000Z"),
      leadTimeDays: 2,
      now: new Date("2026-04-20T00:00:00.000Z"),
    }),
    false
  );
});

// ── Copy: subjects ──────────────────────────────────────────────────

test("buildStuckReplySubject: prefixes Re: on the original subject", () => {
  assert.equal(
    buildStuckReplySubject({
      originalSubject: "Purchase Order PO-1001 — Cafe Gold",
      orderNumber: "PO-1001",
    }),
    "Re: Purchase Order PO-1001 — Cafe Gold"
  );
});

test("buildStuckReplySubject: falls back to a synthetic subject when original is null", () => {
  assert.equal(
    buildStuckReplySubject({ originalSubject: null, orderNumber: "PO-42" }),
    "Re: Purchase Order PO-42"
  );
});

test("buildStuckReplySubject: treats whitespace-only subject as missing", () => {
  assert.equal(
    buildStuckReplySubject({ originalSubject: "   ", orderNumber: "PO-7" }),
    "Re: Purchase Order PO-7"
  );
});

test("buildStuckReplySubject: handles undefined subject", () => {
  assert.equal(
    buildStuckReplySubject({ originalSubject: undefined, orderNumber: "PO-9" }),
    "Re: Purchase Order PO-9"
  );
});

// ── Copy: greeting ──────────────────────────────────────────────────

test("buildStuckReplyGreeting: prefers the supplier contact's name", () => {
  assert.equal(
    buildStuckReplyGreeting({ contactName: "Jamie", supplierName: "Sysco" }),
    "Jamie"
  );
});

test("buildStuckReplyGreeting: trims whitespace around the contact name", () => {
  assert.equal(
    buildStuckReplyGreeting({
      contactName: "  Jamie  ",
      supplierName: "Sysco",
    }),
    "Jamie"
  );
});

test("buildStuckReplyGreeting: falls back to supplier name when contact is null", () => {
  assert.equal(
    buildStuckReplyGreeting({ contactName: null, supplierName: "Sysco" }),
    "Sysco"
  );
});

test("buildStuckReplyGreeting: falls back to supplier name when contact is whitespace", () => {
  assert.equal(
    buildStuckReplyGreeting({ contactName: "   ", supplierName: "Sysco" }),
    "Sysco"
  );
});

test("buildStuckReplyGreeting: falls back when contact is empty string", () => {
  assert.equal(
    buildStuckReplyGreeting({ contactName: "", supplierName: "Sysco" }),
    "Sysco"
  );
});

// ── Copy: business-line sign-off ────────────────────────────────────

test("buildStuckReplyBusinessLine: joins business and location with an em-dash", () => {
  assert.equal(
    buildStuckReplyBusinessLine({
      businessName: "Cafe Gold",
      locationName: "Main Street",
    }),
    "Cafe Gold — Main Street"
  );
});

test("buildStuckReplyBusinessLine: drops the empty half when one is missing", () => {
  assert.equal(
    buildStuckReplyBusinessLine({
      businessName: "Cafe Gold",
      locationName: null,
    }),
    "Cafe Gold"
  );
  assert.equal(
    buildStuckReplyBusinessLine({
      businessName: null,
      locationName: "Main Street",
    }),
    "Main Street"
  );
});

test("buildStuckReplyBusinessLine: empty string when both are missing", () => {
  assert.equal(
    buildStuckReplyBusinessLine({ businessName: null, locationName: null }),
    ""
  );
  assert.equal(
    buildStuckReplyBusinessLine({
      businessName: undefined,
      locationName: undefined,
    }),
    ""
  );
});

test("buildStuckReplyBusinessLine: treats whitespace-only halves as missing", () => {
  assert.equal(
    buildStuckReplyBusinessLine({
      businessName: "   ",
      locationName: "  Main Street ",
    }),
    "Main Street"
  );
});

// ── Copy: plain-text body ───────────────────────────────────────────

test("buildStuckReplyTextBody: includes greeting, order number, and business line", () => {
  const body = buildStuckReplyTextBody({
    greeting: "Jamie",
    orderNumber: "PO-1001",
    businessLine: "Cafe Gold — Main Street",
  });
  assert.match(body, /^Hi Jamie,/);
  assert.match(body, /order \*PO-1001\*/);
  assert.match(body, /Thanks,\nCafe Gold — Main Street$/);
});

test("buildStuckReplyTextBody: mentions back-order / substitution (the whole point of the nudge)", () => {
  const body = buildStuckReplyTextBody({
    greeting: "Jamie",
    orderNumber: "PO-1001",
    businessLine: "Cafe Gold",
  });
  assert.match(body, /back-ordered/);
  assert.match(body, /substitute/);
});

test("buildStuckReplyTextBody: falls back to 'the team' when businessLine is empty", () => {
  const body = buildStuckReplyTextBody({
    greeting: "Jamie",
    orderNumber: "PO-1001",
    businessLine: "",
  });
  assert.match(body, /Thanks,\nthe team$/);
});

// ── Copy: HTML body ─────────────────────────────────────────────────

test("buildStuckReplyHtmlBody: wraps content in an HTML email shell", () => {
  const html = buildStuckReplyHtmlBody({
    greeting: "Jamie",
    orderNumber: "PO-1001",
    businessLine: "Cafe Gold",
  });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<\/body><\/html>$/);
});

test("buildStuckReplyHtmlBody: escapes HTML in greeting, order number, and business line", () => {
  const html = buildStuckReplyHtmlBody({
    greeting: "<script>",
    orderNumber: "PO&1",
    businessLine: "A\"B'C",
  });
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes("<script>"));
  assert.match(html, /PO&amp;1/);
  assert.match(html, /A&quot;B&#39;C/);
});

test("buildStuckReplyHtmlBody: falls back to 'the team' when businessLine is empty", () => {
  const html = buildStuckReplyHtmlBody({
    greeting: "Jamie",
    orderNumber: "PO-1",
    businessLine: "",
  });
  assert.match(html, />the team</);
});

test("buildStuckReplyHtmlBody: bolds the order number inline (<b>…</b>)", () => {
  const html = buildStuckReplyHtmlBody({
    greeting: "Jamie",
    orderNumber: "PO-99",
    businessLine: "Cafe Gold",
  });
  assert.match(html, /<b>PO-99<\/b>/);
});

// ── Copy: late-delivery Telegram message + keyboard ─────────────────

test("buildLateDeliveryMessage: Markdown-bolds the order number and supplier", () => {
  const msg = buildLateDeliveryMessage({
    orderNumber: "PO-1001",
    supplierName: "Sysco",
  });
  assert.match(msg, /\*PO-1001\*/);
  assert.match(msg, /\*Sysco\*/);
});

test("buildLateDeliveryMessage: opens with a package emoji and ends with a call to action", () => {
  const msg = buildLateDeliveryMessage({
    orderNumber: "PO-1001",
    supplierName: "Sysco",
  });
  assert.match(msg, /^📦 /);
  assert.match(msg, /Tap below to close the loop\.$/);
});

test("buildLateDeliveryMessage: interpolates supplier and order even with special chars (no escaping on Telegram Markdown path — caller's concern)", () => {
  // We intentionally don't escape here; the late-delivery path uses
  // Telegram's Markdown which tolerates unescaped punctuation in
  // supplier names. Lock in that behaviour so a future refactor
  // doesn't accidentally double-escape.
  const msg = buildLateDeliveryMessage({
    orderNumber: "PO/42",
    supplierName: "Acme & Sons",
  });
  assert.match(msg, /PO\/42/);
  assert.match(msg, /Acme & Sons/);
});

test("buildLateDeliveryKeyboard: 1-row 2-button layout", () => {
  const kb = buildLateDeliveryKeyboard("po-123");
  assert.equal(kb.length, 1);
  assert.equal(kb[0].length, 2);
});

test("buildLateDeliveryKeyboard: delivered button uses the po_delivered callback", () => {
  const kb = buildLateDeliveryKeyboard("po-123");
  const [delivered, snooze] = kb[0];
  assert.equal(delivered.text, "✅ Yes — delivered");
  assert.equal(delivered.callback_data, "po_delivered:po-123");
  assert.equal(snooze.text, "⏰ Still waiting");
  assert.equal(snooze.callback_data, "po_snooze_delivery:po-123");
});

test("buildLateDeliveryKeyboard: callback IDs embed the PO id verbatim (so the handler can route)", () => {
  // This is a contract — the callback handler in
  // operator-bot/telegram-callbacks.ts parses the prefix and id back
  // apart. If we ever change the separator, the handler has to move
  // in lockstep.
  const kb = buildLateDeliveryKeyboard("abcdef-uuid-1234");
  assert.equal(kb[0][0].callback_data, "po_delivered:abcdef-uuid-1234");
  assert.equal(kb[0][1].callback_data, "po_snooze_delivery:abcdef-uuid-1234");
});

// ── escapeHtml ──────────────────────────────────────────────────────

test("escapeHtml: passes through plain ASCII unchanged", () => {
  assert.equal(escapeHtml("Hello world"), "Hello world");
});

test("escapeHtml: escapes the five standard entity chars", () => {
  assert.equal(
    escapeHtml("<script>alert(\"xss\")</script>"),
    "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
  );
  assert.equal(escapeHtml("a&b"), "a&amp;b");
  assert.equal(escapeHtml("it's"), "it&#39;s");
});

test("escapeHtml: escapes ampersand FIRST so other entities don't double-escape", () => {
  // "A<B" → "A&lt;B" not "A&amp;lt;B"
  assert.equal(escapeHtml("A<B"), "A&lt;B");
});

test("escapeHtml: preserves non-dangerous unicode (emoji, accents)", () => {
  assert.equal(escapeHtml("Café — 🍕"), "Café — 🍕");
});

test("escapeHtml: handles empty string", () => {
  assert.equal(escapeHtml(""), "");
});
