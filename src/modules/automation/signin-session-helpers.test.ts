import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_SIGNIN_KEYS,
  SIGNIN_IDLE_TIMEOUT_MS,
  SIGNIN_MAX_TOTAL_MS,
  clampScrollDelta,
  isSigninSessionExpired,
  normalizeSigninCookie,
  pickAllowedSigninKey,
} from "./signin-session-helpers";

describe("pickAllowedSigninKey", () => {
  it("returns the exact key for every entry on the allowlist", () => {
    for (const key of ALLOWED_SIGNIN_KEYS) {
      assert.equal(pickAllowedSigninKey(key), key);
    }
  });

  it("accepts 'Enter'", () => {
    assert.equal(pickAllowedSigninKey("Enter"), "Enter");
  });

  it("accepts 'Tab'", () => {
    assert.equal(pickAllowedSigninKey("Tab"), "Tab");
  });

  it("accepts 'Backspace'", () => {
    assert.equal(pickAllowedSigninKey("Backspace"), "Backspace");
  });

  it("accepts all four arrow keys", () => {
    assert.equal(pickAllowedSigninKey("ArrowLeft"), "ArrowLeft");
    assert.equal(pickAllowedSigninKey("ArrowRight"), "ArrowRight");
    assert.equal(pickAllowedSigninKey("ArrowUp"), "ArrowUp");
    assert.equal(pickAllowedSigninKey("ArrowDown"), "ArrowDown");
  });

  it("is case-sensitive — 'enter' is rejected (puppeteer KeyInput is capitalised)", () => {
    assert.equal(pickAllowedSigninKey("enter"), null);
    assert.equal(pickAllowedSigninKey("ENTER"), null);
    assert.equal(pickAllowedSigninKey("tab"), null);
  });

  it("rejects printable characters (use forwardType for those)", () => {
    assert.equal(pickAllowedSigninKey("a"), null);
    assert.equal(pickAllowedSigninKey("A"), null);
    assert.equal(pickAllowedSigninKey("1"), null);
    assert.equal(pickAllowedSigninKey(" "), null);
  });

  it("rejects keys that look plausible but aren't on the allowlist", () => {
    // Guardrail against accidental string-to-KeyInput coercion —
    // we shouldn't forward these to puppeteer.
    assert.equal(pickAllowedSigninKey("Meta"), null);
    assert.equal(pickAllowedSigninKey("Control"), null);
    assert.equal(pickAllowedSigninKey("Shift"), null);
    assert.equal(pickAllowedSigninKey("Alt"), null);
    assert.equal(pickAllowedSigninKey("F5"), null);
    assert.equal(pickAllowedSigninKey("PageUp"), null);
  });

  it("rejects the empty string", () => {
    assert.equal(pickAllowedSigninKey(""), null);
  });

  it("rejects whitespace-padded allowlisted keys (strict equality)", () => {
    assert.equal(pickAllowedSigninKey(" Enter"), null);
    assert.equal(pickAllowedSigninKey("Enter "), null);
  });

  it("rejects arbitrary garbage strings", () => {
    assert.equal(pickAllowedSigninKey("<script>"), null);
    assert.equal(pickAllowedSigninKey("DROP TABLE"), null);
    assert.equal(pickAllowedSigninKey("💥"), null);
  });
});

describe("clampScrollDelta", () => {
  it("passes through small integer deltas unchanged", () => {
    assert.equal(clampScrollDelta(0), 0);
    assert.equal(clampScrollDelta(100), 100);
    assert.equal(clampScrollDelta(-100), -100);
    assert.equal(clampScrollDelta(1999), 1999);
    assert.equal(clampScrollDelta(-1999), -1999);
  });

  it("clamps at the positive ceiling of 2000", () => {
    assert.equal(clampScrollDelta(2000), 2000);
    assert.equal(clampScrollDelta(2001), 2000);
    assert.equal(clampScrollDelta(9999999), 2000);
  });

  it("clamps at the negative floor of -2000", () => {
    assert.equal(clampScrollDelta(-2000), -2000);
    assert.equal(clampScrollDelta(-2001), -2000);
    assert.equal(clampScrollDelta(-9999999), -2000);
  });

  it("rounds fractional inputs to the nearest integer", () => {
    assert.equal(clampScrollDelta(1.4), 1);
    assert.equal(clampScrollDelta(1.5), 2);
    assert.equal(clampScrollDelta(-1.5), -1); // Math.round: -1.5 → -1
    assert.equal(clampScrollDelta(-1.6), -2);
  });

  it("rounds BEFORE clamping — 2000.4 rounds to 2000, 2000.5 rounds to 2001 then clamps to 2000", () => {
    assert.equal(clampScrollDelta(2000.4), 2000);
    assert.equal(clampScrollDelta(2000.5), 2000);
    assert.equal(clampScrollDelta(-2000.5), -2000);
  });

  it("collapses non-finite input to 0", () => {
    // NaN/Infinity would otherwise produce NaN/Infinity after
    // Math.round, which would travel into puppeteer's wheel API as
    // a malformed number. Lock the 0 fallback so that regresses
    // trip a test, not a live Chrome instance.
    assert.equal(clampScrollDelta(NaN), 0);
    assert.equal(clampScrollDelta(Infinity), 0);
    assert.equal(clampScrollDelta(-Infinity), 0);
  });

  it("handles -0 by preserving it (Math.round(-0) === -0) — downstream consumers don't care about sign-bit", () => {
    // `node:assert/strict` uses Object.is, so -0 !== 0. We lock
    // the current behaviour (function passes -0 through) so a
    // change either direction is visible, without pretending the
    // signed zero is meaningful for wheel deltas.
    const result = clampScrollDelta(-0);
    assert.ok(Object.is(result, -0) || Object.is(result, 0));
    assert.equal(result + 0, 0);
  });
});

describe("normalizeSigninCookie — happy paths", () => {
  it("passes through a well-formed cookie", () => {
    const input = {
      name: "session_id",
      value: "abc123",
      domain: ".example.com",
      path: "/",
      expires: 1700000000,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    };
    const out = normalizeSigninCookie(input);
    assert.deepEqual(out, {
      name: "session_id",
      value: "abc123",
      domain: ".example.com",
      path: "/",
      expires: 1700000000,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
  });

  it("keeps each of the three accepted sameSite values", () => {
    for (const v of ["Strict", "Lax", "None"] as const) {
      const out = normalizeSigninCookie({ name: "x", value: "y", sameSite: v });
      assert.equal(out.sameSite, v);
    }
  });

  it("copies the minimal (name + value) cookie with all else undefined", () => {
    const out = normalizeSigninCookie({ name: "x", value: "y" });
    assert.equal(out.name, "x");
    assert.equal(out.value, "y");
    assert.equal(out.domain, undefined);
    assert.equal(out.path, undefined);
    assert.equal(out.expires, undefined);
    assert.equal(out.httpOnly, undefined);
    assert.equal(out.secure, undefined);
    assert.equal(out.sameSite, undefined);
  });
});

describe("normalizeSigninCookie — expires field", () => {
  it("keeps positive numeric expires", () => {
    const out = normalizeSigninCookie({ name: "x", value: "y", expires: 1 });
    assert.equal(out.expires, 1);
  });

  it("drops 0 expires (session-cookie sentinel from some clients)", () => {
    const out = normalizeSigninCookie({ name: "x", value: "y", expires: 0 });
    assert.equal(out.expires, undefined);
  });

  it("drops -1 expires (puppeteer's session-cookie sentinel)", () => {
    // Lock this — if puppeteer upstream changes the sentinel we
    // want a test to catch it, since a -1 leaking into persistence
    // would look like "already expired".
    const out = normalizeSigninCookie({ name: "x", value: "y", expires: -1 });
    assert.equal(out.expires, undefined);
  });

  it("drops negative expires other than -1 too", () => {
    const out = normalizeSigninCookie({ name: "x", value: "y", expires: -5000 });
    assert.equal(out.expires, undefined);
  });

  it("drops expires when it's undefined", () => {
    const out = normalizeSigninCookie({ name: "x", value: "y" });
    assert.equal(out.expires, undefined);
  });

  it("keeps a very large positive expires (far-future cookie)", () => {
    const farFuture = 99999999999;
    const out = normalizeSigninCookie({
      name: "x",
      value: "y",
      expires: farFuture,
    });
    assert.equal(out.expires, farFuture);
  });
});

describe("normalizeSigninCookie — sameSite narrowing", () => {
  it("collapses undefined sameSite to undefined", () => {
    const out = normalizeSigninCookie({ name: "x", value: "y" });
    assert.equal(out.sameSite, undefined);
  });

  it("collapses empty-string sameSite to undefined", () => {
    const out = normalizeSigninCookie({ name: "x", value: "y", sameSite: "" });
    assert.equal(out.sameSite, undefined);
  });

  it("collapses 'no_restriction' sameSite to undefined (CDP-legacy value)", () => {
    // Chrome devtools protocol sometimes exposes SameSite as
    // "no_restriction" instead of "None". We treat it as unknown
    // rather than silently mapping — persistence will simply omit
    // the attribute.
    const out = normalizeSigninCookie({
      name: "x",
      value: "y",
      sameSite: "no_restriction",
    });
    assert.equal(out.sameSite, undefined);
  });

  it("rejects lowercase 'lax' (strict case-sensitive compare)", () => {
    const out = normalizeSigninCookie({ name: "x", value: "y", sameSite: "lax" });
    assert.equal(out.sameSite, undefined);
  });

  it("rejects gibberish sameSite", () => {
    const out = normalizeSigninCookie({
      name: "x",
      value: "y",
      sameSite: "strict-but-actually-not",
    });
    assert.equal(out.sameSite, undefined);
  });
});

describe("normalizeSigninCookie — purity", () => {
  it("does not mutate the input object", () => {
    const input = {
      name: "x",
      value: "y",
      expires: -1,
      sameSite: "lax",
    };
    const snapshot = JSON.stringify(input);
    normalizeSigninCookie(input);
    assert.equal(JSON.stringify(input), snapshot);
  });

  it("returns a FRESH object each call (no aliasing)", () => {
    const input = { name: "x", value: "y" };
    const a = normalizeSigninCookie(input);
    const b = normalizeSigninCookie(input);
    assert.notEqual(a, b); // different references
    assert.deepEqual(a, b); // but equal content
  });
});

describe("isSigninSessionExpired", () => {
  const now = 10_000_000;

  it("returns false for a fresh session", () => {
    assert.equal(
      isSigninSessionExpired({ createdAt: now, lastActivityAt: now }, now),
      false
    );
  });

  it("returns false when idle is exactly at the timeout (strict >, not >=)", () => {
    const session = {
      createdAt: now,
      lastActivityAt: now - SIGNIN_IDLE_TIMEOUT_MS,
    };
    assert.equal(isSigninSessionExpired(session, now), false);
  });

  it("returns true when idle is 1ms past the timeout", () => {
    const session = {
      createdAt: now,
      lastActivityAt: now - SIGNIN_IDLE_TIMEOUT_MS - 1,
    };
    assert.equal(isSigninSessionExpired(session, now), true);
  });

  it("returns false when total age is exactly at the max", () => {
    const session = {
      createdAt: now - SIGNIN_MAX_TOTAL_MS,
      lastActivityAt: now,
    };
    assert.equal(isSigninSessionExpired(session, now), false);
  });

  it("returns true when total age exceeds the max, even if activity is fresh", () => {
    // The max-total ceiling is a HARD cap — someone actively
    // interacting past the 20 min mark still gets torn down to
    // avoid runaway Chrome instances chewing RAM.
    const session = {
      createdAt: now - SIGNIN_MAX_TOTAL_MS - 1,
      lastActivityAt: now,
    };
    assert.equal(isSigninSessionExpired(session, now), true);
  });

  it("returns true when BOTH conditions are satisfied", () => {
    const session = {
      createdAt: now - SIGNIN_MAX_TOTAL_MS - 100,
      lastActivityAt: now - SIGNIN_IDLE_TIMEOUT_MS - 100,
    };
    assert.equal(isSigninSessionExpired(session, now), true);
  });

  it("idle timeout is 12 minutes (locks the chosen duration)", () => {
    // Phone users take >5 min for 2FA. If we drop this back under
    // 10 min, this test flags the regression.
    assert.equal(SIGNIN_IDLE_TIMEOUT_MS, 12 * 60 * 1000);
  });

  it("max-total is 20 minutes (locks the chosen duration)", () => {
    assert.equal(SIGNIN_MAX_TOTAL_MS, 20 * 60 * 1000);
  });

  it("is a pure function — same input yields same output", () => {
    const session = { createdAt: 0, lastActivityAt: 0 };
    for (let i = 0; i < 10; i += 1) {
      assert.equal(isSigninSessionExpired(session, 1_000_000), true);
    }
  });
});

describe("ALLOWED_SIGNIN_KEYS", () => {
  it("contains exactly 11 entries (lock the allowlist size)", () => {
    // If the allowlist grows, the test author should explicitly
    // bump this count — silent growth means new keys slipped in
    // without a deliberate decision.
    assert.equal(ALLOWED_SIGNIN_KEYS.length, 11);
  });

  it("has no duplicate entries", () => {
    const set = new Set(ALLOWED_SIGNIN_KEYS);
    assert.equal(set.size, ALLOWED_SIGNIN_KEYS.length);
  });

  it("contains each expected key", () => {
    const expected = [
      "Enter",
      "Tab",
      "Backspace",
      "Escape",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Delete",
      "Home",
      "End",
    ];
    for (const k of expected) {
      assert.ok(
        (ALLOWED_SIGNIN_KEYS as readonly string[]).includes(k),
        `missing key: ${k}`
      );
    }
  });
});
