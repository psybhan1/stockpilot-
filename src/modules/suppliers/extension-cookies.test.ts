import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_COOKIES,
  MAX_NAME_LENGTH,
  MAX_VALUE_LENGTH,
  MAX_DOMAIN_LENGTH,
  MAX_PATH_LENGTH,
  normaliseExtensionCookies,
} from "./extension-cookies";

// ── Top-level rejections ────────────────────────────────────────────

test("rejects non-array input (null)", () => {
  const r = normaliseExtensionCookies(null);
  assert.equal(r.ok, false);
  assert.match(r.reason, /must be an array/);
});

test("rejects non-array input (object)", () => {
  const r = normaliseExtensionCookies({ cookies: [] });
  assert.equal(r.ok, false);
});

test("rejects non-array input (string)", () => {
  const r = normaliseExtensionCookies("not-an-array");
  assert.equal(r.ok, false);
});

test("rejects non-array input (undefined)", () => {
  const r = normaliseExtensionCookies(undefined);
  assert.equal(r.ok, false);
});

test("rejects empty array", () => {
  const r = normaliseExtensionCookies([]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /at least one cookie/);
});

test("rejects payload exceeding MAX_COOKIES", () => {
  const payload = Array.from({ length: MAX_COOKIES + 1 }, (_, i) => ({
    name: `n${i}`,
    value: "v",
  }));
  const r = normaliseExtensionCookies(payload);
  assert.equal(r.ok, false);
  assert.match(r.reason, /too many cookies/);
});

test("accepts payload at exactly MAX_COOKIES", () => {
  const payload = Array.from({ length: MAX_COOKIES }, (_, i) => ({
    name: `n${i}`,
    value: "v",
  }));
  const r = normaliseExtensionCookies(payload);
  assert.equal(r.ok, true);
  assert.equal(r.cookies.length, MAX_COOKIES);
});

// ── Per-entry skipping ──────────────────────────────────────────────

test("skips null entries but keeps valid siblings", () => {
  const r = normaliseExtensionCookies([null, { name: "a", value: "b" }]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies.length, 1);
  assert.equal(r.cookies[0].name, "a");
});

test("skips non-object entries (string, number)", () => {
  const r = normaliseExtensionCookies([
    "not-an-object",
    42,
    { name: "a", value: "b" },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies.length, 1);
});

test("skips entries missing name", () => {
  const r = normaliseExtensionCookies([
    { value: "v" },
    { name: "ok", value: "v" },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies.length, 1);
  assert.equal(r.cookies[0].name, "ok");
});

test("skips entries missing value", () => {
  const r = normaliseExtensionCookies([
    { name: "a" },
    { name: "ok", value: "v" },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies.length, 1);
});

test("skips entries with non-string name", () => {
  const r = normaliseExtensionCookies([
    { name: 123, value: "v" },
    { name: "ok", value: "v" },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies.length, 1);
});

test("skips entries with non-string value", () => {
  const r = normaliseExtensionCookies([
    { name: "a", value: 42 },
    { name: "a", value: null },
    { name: "ok", value: "v" },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies.length, 1);
});

test("skips entries with empty-string name", () => {
  const r = normaliseExtensionCookies([
    { name: "", value: "v" },
    { name: "ok", value: "v" },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies.length, 1);
});

test("accepts entry with empty-string value (session cookies often have these)", () => {
  const r = normaliseExtensionCookies([{ name: "sid", value: "" }]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies[0].value, "");
});

test("skips entries whose name exceeds MAX_NAME_LENGTH", () => {
  const r = normaliseExtensionCookies([
    { name: "x".repeat(MAX_NAME_LENGTH + 1), value: "v" },
    { name: "ok", value: "v" },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies.length, 1);
});

test("accepts name exactly at MAX_NAME_LENGTH", () => {
  const r = normaliseExtensionCookies([
    { name: "x".repeat(MAX_NAME_LENGTH), value: "v" },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies[0].name.length, MAX_NAME_LENGTH);
});

test("skips entries whose value exceeds MAX_VALUE_LENGTH", () => {
  const r = normaliseExtensionCookies([
    { name: "a", value: "x".repeat(MAX_VALUE_LENGTH + 1) },
    { name: "ok", value: "v" },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies.length, 1);
});

test("accepts value exactly at MAX_VALUE_LENGTH", () => {
  const r = normaliseExtensionCookies([
    { name: "a", value: "x".repeat(MAX_VALUE_LENGTH) },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies[0].value.length, MAX_VALUE_LENGTH);
});

test("rejects payload when every entry is malformed", () => {
  const r = normaliseExtensionCookies([
    null,
    { name: 42, value: "v" },
    { name: "", value: "v" },
    "garbage",
  ]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no well-formed cookies/);
});

// ── Optional-field preservation ─────────────────────────────────────

test("preserves domain when string and within MAX_DOMAIN_LENGTH", () => {
  const r = normaliseExtensionCookies([
    { name: "a", value: "v", domain: ".amazon.com" },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies[0].domain, ".amazon.com");
});

test("drops domain when oversized but keeps cookie", () => {
  const r = normaliseExtensionCookies([
    {
      name: "a",
      value: "v",
      domain: "x".repeat(MAX_DOMAIN_LENGTH + 1),
    },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies[0].domain, undefined);
  assert.equal(r.cookies[0].name, "a");
});

test("drops non-string domain", () => {
  const r = normaliseExtensionCookies([
    { name: "a", value: "v", domain: 123 },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies[0].domain, undefined);
});

test("preserves path when string and within MAX_PATH_LENGTH", () => {
  const r = normaliseExtensionCookies([
    { name: "a", value: "v", path: "/cart" },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies[0].path, "/cart");
});

test("drops path when oversized but keeps cookie", () => {
  const r = normaliseExtensionCookies([
    { name: "a", value: "v", path: "/" + "x".repeat(MAX_PATH_LENGTH) },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies[0].path, undefined);
});

test("floors fractional expires", () => {
  const r = normaliseExtensionCookies([
    { name: "a", value: "v", expires: 1700000000.9 },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies[0].expires, 1700000000);
});

test("drops NaN expires", () => {
  const r = normaliseExtensionCookies([
    { name: "a", value: "v", expires: Number.NaN },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies[0].expires, undefined);
});

test("drops Infinity expires", () => {
  const r = normaliseExtensionCookies([
    { name: "a", value: "v", expires: Number.POSITIVE_INFINITY },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies[0].expires, undefined);
});

test("drops zero / negative expires (session-cookie semantics — not an absolute timestamp)", () => {
  const r = normaliseExtensionCookies([
    { name: "a", value: "v", expires: 0 },
    { name: "b", value: "v", expires: -1 },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies[0].expires, undefined);
  assert.equal(r.cookies[1].expires, undefined);
});

test("drops non-number expires (string timestamp)", () => {
  const r = normaliseExtensionCookies([
    { name: "a", value: "v", expires: "1700000000" },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies[0].expires, undefined);
});

test("preserves boolean httpOnly and secure", () => {
  const r = normaliseExtensionCookies([
    { name: "a", value: "v", httpOnly: true, secure: false },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies[0].httpOnly, true);
  assert.equal(r.cookies[0].secure, false);
});

test("drops non-boolean httpOnly and secure (truthy string doesn't coerce)", () => {
  const r = normaliseExtensionCookies([
    { name: "a", value: "v", httpOnly: "yes", secure: 1 },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies[0].httpOnly, undefined);
  assert.equal(r.cookies[0].secure, undefined);
});

test("preserves valid sameSite values", () => {
  for (const value of ["Strict", "Lax", "None"] as const) {
    const r = normaliseExtensionCookies([
      { name: "a", value: "v", sameSite: value },
    ]);
    assert.equal(r.ok, true);
    assert.equal(r.cookies[0].sameSite, value);
  }
});

test("drops invalid sameSite values (case-sensitive; lowercase not accepted)", () => {
  const r = normaliseExtensionCookies([
    { name: "a", value: "v", sameSite: "lax" },
    { name: "b", value: "v", sameSite: "strict" },
    { name: "c", value: "v", sameSite: "Unset" },
    { name: "d", value: "v", sameSite: 123 },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cookies.length, 4);
  for (const cookie of r.cookies) {
    assert.equal(cookie.sameSite, undefined);
  }
});

test("only emits optional fields when present (clean shape)", () => {
  const r = normaliseExtensionCookies([{ name: "a", value: "v" }]);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.cookies[0]).sort(), ["name", "value"]);
});

test("preserves all fields together when valid", () => {
  const r = normaliseExtensionCookies([
    {
      name: "session",
      value: "abc123",
      domain: ".amazon.com",
      path: "/",
      expires: 1700000000,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.cookies[0], {
    name: "session",
    value: "abc123",
    domain: ".amazon.com",
    path: "/",
    expires: 1700000000,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });
});

test("does not mutate input", () => {
  const input = [{ name: "a", value: "v", domain: ".amazon.com" }];
  const snapshot = JSON.parse(JSON.stringify(input));
  normaliseExtensionCookies(input);
  assert.deepEqual(input, snapshot);
});

test("realistic Amazon-export payload round-trips cleanly", () => {
  // A trimmed representative of what chrome.cookies.getAll returns.
  const input = [
    {
      name: "session-id",
      value: "131-1234567-8901234",
      domain: ".amazon.com",
      path: "/",
      expires: 1800000000,
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    },
    {
      name: "ubid-main",
      value: "133-9876543-2109876",
      domain: ".amazon.com",
      path: "/",
      httpOnly: true,
      secure: true,
    },
  ];
  const r = normaliseExtensionCookies(input);
  assert.equal(r.ok, true);
  assert.equal(r.cookies.length, 2);
  assert.equal(r.cookies[0].name, "session-id");
  assert.equal(r.cookies[1].httpOnly, true);
});
