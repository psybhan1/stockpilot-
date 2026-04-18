import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { verifyN8nAuthHeaders } from "./n8n-auth-core";

const SECRET = "super-secret-shared-key";

function hmac(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

// ── Unconfigured (dev-mode) ───────────────────────────────────────────

test("verifyN8nAuthHeaders: no secret configured → ok unconfigured", () => {
  const result = verifyN8nAuthHeaders({
    secret: null,
    signature: null,
    headerSecret: null,
  });
  assert.deepEqual(result, { ok: true, mode: "unconfigured" });
});

test("verifyN8nAuthHeaders: empty secret → ok unconfigured", () => {
  const result = verifyN8nAuthHeaders({
    secret: "",
    signature: null,
    headerSecret: null,
  });
  assert.deepEqual(result, { ok: true, mode: "unconfigured" });
});

test("verifyN8nAuthHeaders: whitespace-only secret → ok unconfigured", () => {
  // .trim() collapses whitespace to empty → unconfigured.
  const result = verifyN8nAuthHeaders({
    secret: "   \t\n  ",
    signature: null,
    headerSecret: null,
  });
  assert.deepEqual(result, { ok: true, mode: "unconfigured" });
});

test("verifyN8nAuthHeaders: undefined secret → ok unconfigured", () => {
  const result = verifyN8nAuthHeaders({
    secret: undefined,
    signature: null,
    headerSecret: null,
  });
  assert.deepEqual(result, { ok: true, mode: "unconfigured" });
});

test("verifyN8nAuthHeaders: unconfigured ignores even bogus signatures", () => {
  // Dev mode = trust everything. A garbage signature shouldn't reject.
  const result = verifyN8nAuthHeaders({
    secret: null,
    signature: "garbage",
    headerSecret: "wrong",
    body: "{}",
  });
  assert.equal(result.ok, true);
});

// ── HMAC signature path ──────────────────────────────────────────────

test("verifyN8nAuthHeaders: valid HMAC → ok hmac", () => {
  const body = '{"event":"low_stock","items":[]}';
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: hmac(body),
    headerSecret: null,
    body,
  });
  assert.deepEqual(result, { ok: true, mode: "hmac" });
});

test("verifyN8nAuthHeaders: HMAC over empty body works", () => {
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: hmac(""),
    headerSecret: null,
    body: "",
  });
  assert.deepEqual(result, { ok: true, mode: "hmac" });
});

test("verifyN8nAuthHeaders: HMAC where body omitted → defaults to empty", () => {
  // verifyN8nAuthHeaders default body is "" — so a signature for ""
  // works without explicitly passing a body.
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: hmac(""),
    headerSecret: null,
  });
  assert.deepEqual(result, { ok: true, mode: "hmac" });
});

test("verifyN8nAuthHeaders: HMAC mismatch → reject (not fall through)", () => {
  // Critical: a wrong signature must be a HARD REJECT, not silently
  // fall through to the shared-secret path. Otherwise an attacker
  // who guesses one mode could probe the other.
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: "deadbeef" + "0".repeat(56), // 64 hex chars but wrong
    headerSecret: SECRET, // would pass shared-secret if it fell through
    body: "{}",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "HMAC signature mismatch.");
  }
});

test("verifyN8nAuthHeaders: HMAC computed over WRONG body → reject", () => {
  const realBody = '{"event":"x"}';
  const tamperedBody = '{"event":"y"}';
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: hmac(realBody),
    headerSecret: null,
    body: tamperedBody,
  });
  assert.equal(result.ok, false);
});

test("verifyN8nAuthHeaders: HMAC with WRONG SECRET → reject", () => {
  const body = "{}";
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: hmac(body, "different-secret"),
    headerSecret: null,
    body,
  });
  assert.equal(result.ok, false);
});

test("verifyN8nAuthHeaders: HMAC with non-hex signature → reject (no crash)", () => {
  // Buffer.from("...", "hex") silently drops invalid chars rather
  // than throwing. The constantTimeEqualHex try/catch covers any
  // weirdness that does throw. Either way: mismatch.
  const body = "{}";
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: "this is not hex at all !!!",
    headerSecret: null,
    body,
  });
  assert.equal(result.ok, false);
});

test("verifyN8nAuthHeaders: HMAC with empty signature string → reject", () => {
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: "",
    headerSecret: SECRET,
    body: "{}",
  });
  // Empty string is falsy → falls through to shared-secret check.
  assert.deepEqual(result, { ok: true, mode: "shared-secret" });
});

test("verifyN8nAuthHeaders: HMAC of different-length signature → reject", () => {
  const body = "{}";
  const correct = hmac(body);
  // Truncate the signature so length differs from computed.
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: correct.slice(0, 30),
    headerSecret: null,
    body,
  });
  assert.equal(result.ok, false);
});

test("verifyN8nAuthHeaders: HMAC case-sensitive on hex digits", () => {
  // createHmac returns lowercase hex. An UPPERCASE signature is the
  // same bytes — Buffer.from(..., "hex") is case-insensitive, so
  // this should still verify.
  const body = "{}";
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: hmac(body).toUpperCase(),
    headerSecret: null,
    body,
  });
  assert.deepEqual(result, { ok: true, mode: "hmac" });
});

// ── Shared-secret path ────────────────────────────────────────────────

test("verifyN8nAuthHeaders: matching shared-secret → ok shared-secret", () => {
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: null,
    headerSecret: SECRET,
  });
  assert.deepEqual(result, { ok: true, mode: "shared-secret" });
});

test("verifyN8nAuthHeaders: mismatched shared-secret → reject", () => {
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: null,
    headerSecret: "wrong-secret",
  });
  assert.equal(result.ok, false);
});

test("verifyN8nAuthHeaders: shared-secret of different length → reject", () => {
  // Length-prefix check guards constantTimeEqual from throwing.
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: null,
    headerSecret: SECRET + "x",
  });
  assert.equal(result.ok, false);
});

test("verifyN8nAuthHeaders: empty shared-secret header → reject", () => {
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: null,
    headerSecret: "",
  });
  assert.equal(result.ok, false);
});

test("verifyN8nAuthHeaders: missing both headers → reject", () => {
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: null,
    headerSecret: null,
  });
  assert.equal(result.ok, false);
});

test("verifyN8nAuthHeaders: rejection reason names BOTH header options", () => {
  // The error string is shown in API responses — should hint at
  // both auth styles so an integrator knows what to add.
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: null,
    headerSecret: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /signature/i);
    assert.match(result.reason, /webhook-secret/i);
  }
});

// ── Header precedence / interaction ───────────────────────────────────

test("verifyN8nAuthHeaders: signature present but invalid does NOT fall through to shared-secret", () => {
  // Defense-in-depth: an invalid HMAC must be a hard reject even if
  // the shared-secret header is correct. Otherwise an attacker who
  // sends a bogus signature gets to retry via the simpler path.
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: "00".repeat(32),
    headerSecret: SECRET, // would otherwise pass
    body: "{}",
  });
  assert.equal(result.ok, false);
});

test("verifyN8nAuthHeaders: valid HMAC ignores any shared-secret header", () => {
  // When HMAC verifies, mode is "hmac" — even if the shared-secret
  // header is wrong, the request is ok via the stronger path.
  const body = "{}";
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: hmac(body),
    headerSecret: "this-is-wrong-but-hmac-already-passed",
    body,
  });
  assert.deepEqual(result, { ok: true, mode: "hmac" });
});

// ── Body sensitivity ─────────────────────────────────────────────────

test("verifyN8nAuthHeaders: HMAC over JSON with whitespace differences mismatches", () => {
  // Critical: HMAC is over the EXACT bytes. Re-serialising JSON
  // changes whitespace and breaks the signature. Caller must use
  // the raw body, never JSON.parse → JSON.stringify.
  const original = '{"a":1}';
  const reserialised = '{ "a": 1 }';
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: hmac(original),
    headerSecret: null,
    body: reserialised,
  });
  assert.equal(result.ok, false);
});

test("verifyN8nAuthHeaders: HMAC over UTF-8 body with multibyte chars", () => {
  // Make sure the byte-level HMAC works with non-ASCII bodies.
  const body = '{"name":"café 日本"}';
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: hmac(body),
    headerSecret: null,
    body,
  });
  assert.deepEqual(result, { ok: true, mode: "hmac" });
});

test("verifyN8nAuthHeaders: HMAC over large body (1KB)", () => {
  const body = "x".repeat(1024);
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: hmac(body),
    headerSecret: null,
    body,
  });
  assert.deepEqual(result, { ok: true, mode: "hmac" });
});

// ── Secret normalisation ─────────────────────────────────────────────

test("verifyN8nAuthHeaders: secret with leading/trailing whitespace is trimmed", () => {
  // A copy/paste secret with trailing newline should still work.
  const result = verifyN8nAuthHeaders({
    secret: `  ${SECRET}\n`,
    signature: null,
    headerSecret: SECRET,
  });
  assert.deepEqual(result, { ok: true, mode: "shared-secret" });
});

test("verifyN8nAuthHeaders: secret trim affects HMAC computation too", () => {
  // The trimmed secret is used for HMAC — so the signature must be
  // computed over the trimmed value, not the padded one.
  const body = "{}";
  const result = verifyN8nAuthHeaders({
    secret: `  ${SECRET}\n`,
    signature: hmac(body, SECRET), // signed with the trimmed secret
    headerSecret: null,
    body,
  });
  assert.deepEqual(result, { ok: true, mode: "hmac" });
});

test("verifyN8nAuthHeaders: shared-secret header is NOT trimmed (exact match required)", () => {
  // Only the configured secret is normalised. The header value is
  // compared verbatim — pasting "secret " (with trailing space)
  // into the n8n config should not silently work.
  const result = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: null,
    headerSecret: `${SECRET} `, // trailing space
  });
  assert.equal(result.ok, false);
});

// ── Type / discriminated-union shape ─────────────────────────────────

test("verifyN8nAuthHeaders: ok results carry a mode field", () => {
  const r1 = verifyN8nAuthHeaders({
    secret: null,
    signature: null,
    headerSecret: null,
  });
  assert.equal(r1.ok, true);
  if (r1.ok) assert.ok(r1.mode);

  const r2 = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: null,
    headerSecret: SECRET,
  });
  assert.equal(r2.ok, true);
  if (r2.ok) assert.equal(r2.mode, "shared-secret");
});

test("verifyN8nAuthHeaders: rejection results carry a non-empty reason", () => {
  const r = verifyN8nAuthHeaders({
    secret: SECRET,
    signature: null,
    headerSecret: "wrong",
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.reason.length > 0);
  }
});
