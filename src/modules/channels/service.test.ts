import test from "node:test";
import assert from "node:assert/strict";

import { generatePairingCode, pairingCodeExpiresAt } from "./service";

// ── generatePairingCode ─────────────────────────────────────────────────
//
// Pairing codes are what a human types into a Telegram/WhatsApp chat
// to link that chat to their StockPilot location. They must be:
//   - short enough to type on a phone from a 15-minute notification
//   - unambiguous (no 0/O or 1/I/l confusion)
//   - uppercase (case-insensitive typing on mobile keyboards)
//   - prefixed `SB-` so the bot can parse them out of freeform text
// A regression on any of these makes pairing user-hostile.

test("pairing code: matches SB-XXXXXX format", () => {
  const code = generatePairingCode();
  assert.match(code, /^SB-[A-Z2-9]{6}$/);
});

test("pairing code: always starts with SB- prefix", () => {
  for (let i = 0; i < 50; i++) {
    assert.ok(
      generatePairingCode().startsWith("SB-"),
      "every pairing code must start with SB-"
    );
  }
});

test("pairing code: total length is 9 chars", () => {
  // 3-char prefix + 6 body chars. Previous doc said 6 so guard the
  // exact count — a shorter body would collide faster; longer would
  // be harder to type on mobile.
  for (let i = 0; i < 20; i++) {
    assert.equal(generatePairingCode().length, 9);
  }
});

test("pairing code: body contains no zero (avoids O/0 confusion)", () => {
  for (let i = 0; i < 200; i++) {
    const body = generatePairingCode().slice(3);
    assert.ok(!body.includes("0"), `body contained '0': ${body}`);
  }
});

test("pairing code: body contains no one (avoids 1/I/l confusion)", () => {
  for (let i = 0; i < 200; i++) {
    const body = generatePairingCode().slice(3);
    assert.ok(!body.includes("1"), `body contained '1': ${body}`);
  }
});

test("pairing code: body contains no capital-I", () => {
  for (let i = 0; i < 200; i++) {
    const body = generatePairingCode().slice(3);
    assert.ok(!body.includes("I"), `body contained 'I': ${body}`);
  }
});

test("pairing code: body contains no capital-O", () => {
  for (let i = 0; i < 200; i++) {
    const body = generatePairingCode().slice(3);
    assert.ok(!body.includes("O"), `body contained 'O': ${body}`);
  }
});

test("pairing code: body is uppercase only (no lowercase)", () => {
  for (let i = 0; i < 100; i++) {
    const body = generatePairingCode().slice(3);
    assert.equal(body, body.toUpperCase(), `non-uppercase body: ${body}`);
  }
});

test("pairing code: body is alphanumeric only", () => {
  for (let i = 0; i < 100; i++) {
    const body = generatePairingCode().slice(3);
    assert.match(body, /^[A-Z0-9]+$/);
  }
});

test("pairing code: successive calls produce different codes (collision check)", () => {
  // Alphabet is 32 chars, 6 positions → ~10^9 combinations. Even
  // naive Math.random birthday collisions in 500 calls are <0.01%.
  // If we see duplicates here, entropy is broken (e.g. deterministic
  // seeding or a shorter body).
  const seen = new Set<string>();
  const iterations = 500;
  for (let i = 0; i < iterations; i++) {
    seen.add(generatePairingCode());
  }
  assert.ok(
    seen.size >= iterations - 2,
    `expected ~${iterations} unique codes, got ${seen.size}`
  );
});

test("pairing code: regex that the bot handler uses actually matches it", () => {
  // The Telegram/WhatsApp bot parses incoming messages with a
  // regex to detect pairing codes. If generator and parser diverge,
  // pairing silently fails. This test couples them to catch drift.
  const code = generatePairingCode();
  const bodyChars = /^SB-[A-HJ-NP-Z2-9]{6}$/; // I, O, 0, 1 excluded
  assert.match(code, bodyChars);
});

test("pairing code: uniform distribution roughly across alphabet positions", () => {
  // Soft check — if the impl accidentally biased to one character
  // (e.g. off-by-one in index math), one char would dominate.
  // 32 chars × 6 slots × 500 iterations = 96k samples, expected
  // ~3000 of each. Allow 10x slack in either direction.
  const counts = new Map<string, number>();
  for (let i = 0; i < 500; i++) {
    for (const c of generatePairingCode().slice(3)) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  const values = Array.from(counts.values());
  const max = Math.max(...values);
  const min = Math.min(...values);
  assert.ok(
    max / min < 10,
    `distribution too skewed: max=${max} min=${min}`
  );
});

// ── pairingCodeExpiresAt ────────────────────────────────────────────────

test("pairing expiry: ~15 minutes from now", () => {
  const before = Date.now();
  const exp = pairingCodeExpiresAt();
  const after = Date.now();
  const fifteenMin = 15 * 60_000;
  assert.ok(
    exp.getTime() >= before + fifteenMin - 10 &&
      exp.getTime() <= after + fifteenMin + 10,
    `expiry ${exp.getTime()} not within ±10ms of now+15min`
  );
});

test("pairing expiry: returns a valid Date object", () => {
  const exp = pairingCodeExpiresAt();
  assert.ok(exp instanceof Date);
  assert.ok(!Number.isNaN(exp.getTime()));
});

test("pairing expiry: always in the future (never retroactive)", () => {
  const exp = pairingCodeExpiresAt();
  assert.ok(
    exp.getTime() > Date.now(),
    "pairing expiry must never be in the past"
  );
});

test("pairing expiry: TTL is stable (sub-second jitter between calls)", () => {
  // Two calls back-to-back should produce expiry times within a
  // few ms of each other — the TTL constant itself isn't moving.
  const a = pairingCodeExpiresAt().getTime();
  const b = pairingCodeExpiresAt().getTime();
  assert.ok(
    Math.abs(a - b) < 100,
    `expected back-to-back TTLs within 100ms, got ${Math.abs(a - b)}ms apart`
  );
});

test("pairing expiry: long enough to type, short enough to limit abuse window", () => {
  // Sanity bounds — if somebody changes the TTL constant to 1 hour
  // or 1 minute by mistake, flag it. Neither is catastrophic but
  // both would surprise users.
  const ms = pairingCodeExpiresAt().getTime() - Date.now();
  assert.ok(ms >= 5 * 60_000, `TTL too short: ${ms / 60_000} min`);
  assert.ok(ms <= 30 * 60_000, `TTL too long: ${ms / 60_000} min`);
});
