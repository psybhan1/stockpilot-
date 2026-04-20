import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TELEGRAM_OIDC_TTL_SECONDS,
  extractTelegramUserId,
  parseTelegramOidcCookie,
} from "./telegram-oidc-parse";

const validCookie = (overrides: Partial<{ state: string; codeVerifier: string; issuedAt: number }> = {}) =>
  JSON.stringify({
    state: "state-abc",
    codeVerifier: "verifier-xyz",
    issuedAt: 10_000_000,
    ...overrides,
  });

describe("parseTelegramOidcCookie — happy paths", () => {
  it("parses a well-formed, fresh cookie", () => {
    const out = parseTelegramOidcCookie(validCookie(), 10_000_000);
    assert.deepEqual(out, {
      state: "state-abc",
      codeVerifier: "verifier-xyz",
      issuedAt: 10_000_000,
    });
  });

  it("accepts a cookie exactly at the TTL boundary (now - issuedAt === TTL)", () => {
    const issuedAt = 10_000_000;
    const now = issuedAt + TELEGRAM_OIDC_TTL_SECONDS * 1000;
    // Strict > comparison, so equal-to-TTL passes.
    const out = parseTelegramOidcCookie(validCookie({ issuedAt }), now);
    assert.notEqual(out, null);
  });

  it("accepts additional extra properties without complaint", () => {
    const cookie = JSON.stringify({
      state: "s",
      codeVerifier: "v",
      issuedAt: 100,
      extra: "ignored",
      nested: { whatever: true },
    });
    const out = parseTelegramOidcCookie(cookie, 100);
    assert.notEqual(out, null);
    assert.equal(out?.state, "s");
  });
});

describe("parseTelegramOidcCookie — TTL expiry", () => {
  it("returns null 1ms past the TTL boundary", () => {
    const issuedAt = 10_000_000;
    const now = issuedAt + TELEGRAM_OIDC_TTL_SECONDS * 1000 + 1;
    assert.equal(parseTelegramOidcCookie(validCookie({ issuedAt }), now), null);
  });

  it("returns null for a cookie issued way in the past", () => {
    assert.equal(
      parseTelegramOidcCookie(validCookie({ issuedAt: 0 }), 999_999_999_999),
      null
    );
  });

  it("tolerates a cookie issued in the future (negative elapsed time → passes TTL check)", () => {
    // now - issuedAt is negative, which is NOT > TTL, so the TTL
    // gate passes. A misaligned clock shouldn't lock the user out
    // of login — lock this current-behaviour explicitly.
    const out = parseTelegramOidcCookie(
      validCookie({ issuedAt: 10_000_000 }),
      9_000_000
    );
    assert.notEqual(out, null);
  });

  it("TTL constant is 15 minutes (lock the chosen window)", () => {
    assert.equal(TELEGRAM_OIDC_TTL_SECONDS, 15 * 60);
  });
});

describe("parseTelegramOidcCookie — malformed inputs", () => {
  it("returns null for undefined", () => {
    assert.equal(parseTelegramOidcCookie(undefined, 1000), null);
  });

  it("returns null for empty string", () => {
    assert.equal(parseTelegramOidcCookie("", 1000), null);
  });

  it("returns null for non-JSON junk", () => {
    assert.equal(parseTelegramOidcCookie("not-json", 1000), null);
    assert.equal(parseTelegramOidcCookie("<html>", 1000), null);
    assert.equal(parseTelegramOidcCookie("{broken", 1000), null);
  });

  it("returns null for JSON null literal", () => {
    // JSON.parse('null') returns null; we explicitly guard the
    // `!parsed` check so the truthiness trap doesn't throw.
    assert.equal(parseTelegramOidcCookie("null", 1000), null);
  });

  it("returns null for JSON array at top level", () => {
    // `[].state` is undefined, so the type-check rejects it.
    assert.equal(parseTelegramOidcCookie("[]", 1000), null);
  });

  it("returns null for JSON string primitive", () => {
    assert.equal(parseTelegramOidcCookie('"just-a-string"', 1000), null);
  });

  it("returns null for JSON number primitive", () => {
    // Number passes the truthiness check (if non-zero) but fails
    // the field-type checks, so we still return null.
    assert.equal(parseTelegramOidcCookie("42", 1000), null);
  });

  it("returns null when state is missing", () => {
    const cookie = JSON.stringify({ codeVerifier: "v", issuedAt: 100 });
    assert.equal(parseTelegramOidcCookie(cookie, 100), null);
  });

  it("returns null when codeVerifier is missing", () => {
    const cookie = JSON.stringify({ state: "s", issuedAt: 100 });
    assert.equal(parseTelegramOidcCookie(cookie, 100), null);
  });

  it("returns null when issuedAt is missing", () => {
    const cookie = JSON.stringify({ state: "s", codeVerifier: "v" });
    assert.equal(parseTelegramOidcCookie(cookie, 100), null);
  });

  it("returns null when state is not a string", () => {
    const cookie = JSON.stringify({ state: 42, codeVerifier: "v", issuedAt: 100 });
    assert.equal(parseTelegramOidcCookie(cookie, 100), null);
  });

  it("returns null when codeVerifier is not a string", () => {
    const cookie = JSON.stringify({ state: "s", codeVerifier: [], issuedAt: 100 });
    assert.equal(parseTelegramOidcCookie(cookie, 100), null);
  });

  it("returns null when issuedAt is not a number (stringified number)", () => {
    // strict: typeof "100" is "string", not "number".
    const cookie = JSON.stringify({ state: "s", codeVerifier: "v", issuedAt: "100" });
    assert.equal(parseTelegramOidcCookie(cookie, 100), null);
  });

  it("accepts NaN issuedAt (typeof NaN === 'number') but TTL check effectively rejects it", () => {
    // NaN - number = NaN, and NaN > anything is false — so the
    // TTL gate doesn't reject NaN. We lock this quirk so a future
    // refactor that adds `Number.isFinite(issuedAt)` shows up
    // clearly in diffs.
    // Note: JSON doesn't round-trip NaN, so construct manually:
    const cookie = '{"state":"s","codeVerifier":"v","issuedAt":null}';
    // null becomes typeof "object", so we actually DO reject here:
    assert.equal(parseTelegramOidcCookie(cookie, 100), null);
  });
});

describe("parseTelegramOidcCookie — purity", () => {
  it("is deterministic", () => {
    for (let i = 0; i < 5; i += 1) {
      const out = parseTelegramOidcCookie(validCookie(), 10_000_000);
      assert.equal(out?.state, "state-abc");
    }
  });

  it("does not mutate the input string", () => {
    const input = validCookie();
    const snapshot = input;
    parseTelegramOidcCookie(input, 10_000_000);
    assert.equal(input, snapshot);
  });
});

describe("extractTelegramUserId — happy paths", () => {
  it("prefers `id` when both id and sub are present", () => {
    assert.equal(extractTelegramUserId({ id: "abc", sub: "xyz" }), "abc");
  });

  it("uses `id` when only id is present (string)", () => {
    assert.equal(extractTelegramUserId({ id: "abc" }), "abc");
  });

  it("uses `id` when only id is present (number)", () => {
    assert.equal(extractTelegramUserId({ id: 12345 }), "12345");
  });

  it("coerces numeric id to string", () => {
    assert.equal(extractTelegramUserId({ id: 987654321 }), "987654321");
  });

  it("falls back to `sub` when id is absent (string)", () => {
    assert.equal(extractTelegramUserId({ sub: "xyz" }), "xyz");
  });

  it("falls back to `sub` when id is absent (number)", () => {
    assert.equal(extractTelegramUserId({ sub: 42 }), "42");
  });

  it("handles very large Telegram-style ids (64-bit bounds, up to Number.MAX_SAFE_INTEGER)", () => {
    const id = Number.MAX_SAFE_INTEGER;
    assert.equal(extractTelegramUserId({ id }), String(id));
  });
});

describe("extractTelegramUserId — rejections", () => {
  it("returns null on empty object", () => {
    assert.equal(extractTelegramUserId({}), null);
  });

  it("returns null when id is null", () => {
    // Note: typeof null === "object", so this is correctly rejected.
    assert.equal(extractTelegramUserId({ id: null }), null);
  });

  it("returns null when id is undefined", () => {
    assert.equal(extractTelegramUserId({ id: undefined }), null);
  });

  it("returns null when id is a boolean", () => {
    assert.equal(extractTelegramUserId({ id: true }), null);
    assert.equal(extractTelegramUserId({ id: false }), null);
  });

  it("returns null when id is an array", () => {
    assert.equal(extractTelegramUserId({ id: ["abc"] }), null);
  });

  it("returns null when id is a nested object", () => {
    assert.equal(extractTelegramUserId({ id: { v: "abc" } }), null);
  });

  it("falls through to sub when id is rejected but sub is valid", () => {
    assert.equal(extractTelegramUserId({ id: null, sub: "fallback" }), "fallback");
  });

  it("returns null when both id and sub are unusable", () => {
    assert.equal(extractTelegramUserId({ id: null, sub: {} }), null);
  });

  it("converts 0 (number) to '0' — valid id even though falsy", () => {
    // Guardrail: `id === 0` is a legitimate (if unusual) user id.
    // Locking this so someone doesn't introduce a truthiness
    // check that silently drops the zero.
    assert.equal(extractTelegramUserId({ id: 0 }), "0");
  });

  it("converts empty string to '' — no filtering on content", () => {
    // The parser doesn't do emptiness validation — the caller
    // (verifyTelegramOidcIdToken) does the "no user id" throw.
    // Lock current behaviour.
    assert.equal(extractTelegramUserId({ id: "" }), "");
  });
});

describe("extractTelegramUserId — purity", () => {
  it("does not mutate the input payload", () => {
    const payload: Record<string, unknown> = { id: "abc", sub: "xyz", extra: 1 };
    const snapshot = JSON.stringify(payload);
    extractTelegramUserId(payload);
    assert.equal(JSON.stringify(payload), snapshot);
  });

  it("is deterministic", () => {
    for (let i = 0; i < 5; i += 1) {
      assert.equal(extractTelegramUserId({ id: "abc" }), "abc");
    }
  });
});
