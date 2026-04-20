import test from "node:test";
import assert from "node:assert/strict";

import { rateLimit, _resetRateLimitForTests } from "./rate-limit";

function freshKey(label: string) {
  // Each test gets a unique key namespace so global state doesn't leak.
  return `test:${label}:${Math.random().toString(36).slice(2)}`;
}

test("allows the first request under the cap", () => {
  _resetRateLimitForTests();
  const key = freshKey("first");
  const res = rateLimit({ key, windowMs: 60_000, max: 5 });
  assert.equal(res.allowed, true);
  assert.equal(res.count, 1);
  assert.equal(res.retryAfterSec, 0);
});

test("tracks count up to the max", () => {
  _resetRateLimitForTests();
  const key = freshKey("count");
  for (let i = 1; i <= 5; i++) {
    const res = rateLimit({ key, windowMs: 60_000, max: 5 });
    assert.equal(res.allowed, true, `request ${i} should be allowed`);
    assert.equal(res.count, i);
  }
});

test("rejects the request that exceeds the cap (max+1)", () => {
  _resetRateLimitForTests();
  const key = freshKey("exceed");
  for (let i = 0; i < 3; i++) rateLimit({ key, windowMs: 60_000, max: 3 });
  const res = rateLimit({ key, windowMs: 60_000, max: 3 });
  assert.equal(res.allowed, false);
  assert.equal(res.count, 3, "count clamped to max when rejected");
  assert.ok(res.retryAfterSec >= 1, "retry-after at least 1s");
  assert.ok(res.retryAfterSec <= 60, "retry-after capped at the window length");
});

test("retryAfterSec is at least 1 even if window has nearly expired (no zero-second retry)", () => {
  _resetRateLimitForTests();
  const key = freshKey("retry-floor");
  // Use a tiny window — but not so tiny that timing flakiness skips it.
  // We just want to assert the floor.
  for (let i = 0; i < 2; i++) rateLimit({ key, windowMs: 100, max: 2 });
  const res = rateLimit({ key, windowMs: 100, max: 2 });
  assert.equal(res.allowed, false);
  assert.ok(res.retryAfterSec >= 1, `retry-after must be >= 1, got ${res.retryAfterSec}`);
});

test("different keys are tracked independently", () => {
  _resetRateLimitForTests();
  const a = freshKey("a");
  const b = freshKey("b");
  for (let i = 0; i < 5; i++) rateLimit({ key: a, windowMs: 60_000, max: 5 });
  // a is now exhausted — but b should be untouched
  assert.equal(rateLimit({ key: a, windowMs: 60_000, max: 5 }).allowed, false);
  assert.equal(rateLimit({ key: b, windowMs: 60_000, max: 5 }).allowed, true);
});

test("max=1 only ever allows a single request inside the window", () => {
  _resetRateLimitForTests();
  const key = freshKey("singleton");
  assert.equal(rateLimit({ key, windowMs: 60_000, max: 1 }).allowed, true);
  assert.equal(rateLimit({ key, windowMs: 60_000, max: 1 }).allowed, false);
  assert.equal(rateLimit({ key, windowMs: 60_000, max: 1 }).allowed, false);
});

test("max=0 rejects every request (defensive — no allow-list of zero)", () => {
  _resetRateLimitForTests();
  const key = freshKey("zero");
  const res = rateLimit({ key, windowMs: 60_000, max: 0 });
  assert.equal(res.allowed, false);
});

test("after window expires, requests are allowed again", async () => {
  _resetRateLimitForTests();
  const key = freshKey("rollover");
  for (let i = 0; i < 2; i++) {
    assert.equal(rateLimit({ key, windowMs: 50, max: 2 }).allowed, true);
  }
  assert.equal(rateLimit({ key, windowMs: 50, max: 2 }).allowed, false);

  // Wait long enough that all entries fall outside the window.
  await new Promise((r) => setTimeout(r, 80));

  const res = rateLimit({ key, windowMs: 50, max: 2 });
  assert.equal(res.allowed, true, "should be allowed once window slides past old entries");
  assert.equal(res.count, 1, "count should reset to 1 after window expiry");
});

test("_resetRateLimitForTests fully clears state", () => {
  const key = freshKey("reset");
  for (let i = 0; i < 5; i++) rateLimit({ key, windowMs: 60_000, max: 5 });
  assert.equal(rateLimit({ key, windowMs: 60_000, max: 5 }).allowed, false);

  _resetRateLimitForTests();

  const res = rateLimit({ key, windowMs: 60_000, max: 5 });
  assert.equal(res.allowed, true);
  assert.equal(res.count, 1, "count restarts at 1 after reset");
});

test("count reflects actual requests in window after partial expiry", async () => {
  _resetRateLimitForTests();
  const key = freshKey("partial");
  // Two requests at t=0
  rateLimit({ key, windowMs: 100, max: 5 });
  rateLimit({ key, windowMs: 100, max: 5 });

  // Wait past the window
  await new Promise((r) => setTimeout(r, 120));

  // Two more requests at t=120 — old ones should be evicted
  const res1 = rateLimit({ key, windowMs: 100, max: 5 });
  assert.equal(res1.count, 1, "old timestamps evicted, count restarts");

  const res2 = rateLimit({ key, windowMs: 100, max: 5 });
  assert.equal(res2.count, 2);
});
