import test from "node:test";
import assert from "node:assert/strict";

// Set the secret BEFORE importing the module — deriveKey throws if
// N8N_WEBHOOK_SECRET is unset.
process.env.N8N_WEBHOOK_SECRET ||= "test-secret-for-credential-encryption";

import {
  decryptCredential,
  encryptCredential,
  isEncrypted,
} from "./credential-encryption";

// ── Round-trip correctness ──────────────────────────────────────────

test("encrypt → decrypt round-trips the original plaintext byte-for-byte", () => {
  const plaintext = "s3cr3t-supplier-password!@#$";
  const enc = encryptCredential(plaintext);
  assert.notEqual(enc, plaintext);
  assert.equal(decryptCredential(enc), plaintext);
});

test("round-trips unicode (utf8 encoding is preserved)", () => {
  // Supplier passwords in reality contain ö, é, emoji, etc.
  const plaintext = "café-münchen-🍕-密码";
  const enc = encryptCredential(plaintext);
  assert.equal(decryptCredential(enc), plaintext);
});

test("round-trips empty string (edge case: permission to save a blank password)", () => {
  // The DB column is nullable but if the user stores "" we shouldn't
  // crash on retrieval. AES-GCM is fine with zero-length plaintext.
  const enc = encryptCredential("");
  assert.equal(decryptCredential(enc), "");
});

test("round-trips long plaintext (1 KB covers any realistic credential)", () => {
  const plaintext = "a".repeat(1024);
  assert.equal(decryptCredential(encryptCredential(plaintext)), plaintext);
});

// ── Non-determinism: fresh IV every call ───────────────────────────

test("two encryptions of the same plaintext produce different ciphertexts (fresh IV)", () => {
  // GCM MUST use a unique IV per message under the same key —
  // reusing one is a catastrophic crypto failure (key recovery).
  // This test catches regressions where someone "optimizes" by
  // caching the IV.
  const plaintext = "same-input";
  const enc1 = encryptCredential(plaintext);
  const enc2 = encryptCredential(plaintext);
  assert.notEqual(enc1, enc2);
  // But both still decrypt to the original.
  assert.equal(decryptCredential(enc1), plaintext);
  assert.equal(decryptCredential(enc2), plaintext);
});

// ── Format / prefix handling ───────────────────────────────────────

test("encryptCredential output starts with the versioned prefix enc:v1:", () => {
  // The prefix is how we distinguish encrypted-at-rest values from
  // legacy plaintext rows. Changing it is a backwards-incompat change.
  const enc = encryptCredential("abc");
  assert.ok(enc.startsWith("enc:v1:"));
});

test("encryptCredential output has the three expected segments after the prefix", () => {
  // Format is enc:v1:<iv>:<tag>:<ciphertext>. 12-byte IV → 24 hex
  // chars; 16-byte GCM tag → 32 hex chars.
  const enc = encryptCredential("abc");
  const parts = enc.slice("enc:v1:".length).split(":");
  assert.equal(parts.length, 3);
  assert.equal(parts[0].length, 24, "IV should be 12 bytes (24 hex chars)");
  assert.equal(parts[1].length, 32, "GCM auth tag should be 16 bytes (32 hex chars)");
  assert.ok(parts[2].length >= 0, "ciphertext segment may be zero-length for empty plaintext");
});

// ── Backwards-compat: plaintext passthrough ─────────────────────────

test("decryptCredential passes unencrypted values through unchanged (legacy rows)", () => {
  // Before encryption shipped, supplier credentials were stored in
  // plaintext. Those rows must continue to work until migrated.
  assert.equal(decryptCredential("plain-password"), "plain-password");
  assert.equal(decryptCredential(""), "");
  assert.equal(decryptCredential("no-prefix-here"), "no-prefix-here");
});

test("isEncrypted: true only for the versioned prefix", () => {
  assert.equal(isEncrypted(encryptCredential("x")), true);
  assert.equal(isEncrypted("plain"), false);
  assert.equal(isEncrypted(""), false);
  assert.equal(isEncrypted("enc:v2:iv:tag:ct"), false, "future prefixes don't match v1");
});

// ── Tamper detection (AES-GCM is authenticated encryption) ─────────

test("decryptCredential throws if the ciphertext has been flipped", () => {
  // Flipping any bit in the ciphertext should cause the GCM tag to
  // fail to verify. If this test ever passes, our "authenticated
  // encryption" claim is false.
  const enc = encryptCredential("important-secret");
  const parts = enc.split(":"); // ["enc","v1",iv,tag,ct]
  const ct = parts[4];
  // Flip the first hex char of the ciphertext deterministically.
  const firstChar = ct[0];
  const swapped = firstChar === "0" ? "1" : "0";
  const tamperedCt = swapped + ct.slice(1);
  const tampered = [parts[0], parts[1], parts[2], parts[3], tamperedCt].join(":");

  assert.throws(() => decryptCredential(tampered));
});

test("decryptCredential throws if the GCM auth tag has been swapped", () => {
  const enc = encryptCredential("important-secret");
  const parts = enc.split(":");
  // Swap tag to all zeros — guaranteed to be wrong.
  parts[3] = "00".repeat(16);
  assert.throws(() => decryptCredential(parts.join(":")));
});

test("decryptCredential throws on malformed prefix (wrong segment count)", () => {
  // enc:v1: with only two colon-separated segments instead of three.
  assert.throws(
    () => decryptCredential("enc:v1:deadbeef:cafebabe"),
    /Malformed encrypted credential/,
  );
  // Too many segments — also rejected (no silent truncation).
  assert.throws(
    () => decryptCredential("enc:v1:a:b:c:d"),
    /Malformed encrypted credential/,
  );
});

test("decryptCredential throws on enc:v1: with empty body", () => {
  // "enc:v1:" with nothing after → split returns [""] → length 1 → throw.
  assert.throws(
    () => decryptCredential("enc:v1:"),
    /Malformed encrypted credential/,
  );
});

// ── Key derivation contract ────────────────────────────────────────
// (A "key rotation fails decryption" test would belong here, but
// env.N8N_WEBHOOK_SECRET is frozen at module import time — changing
// process.env after import has no effect. A key-rotation test would
// need a worker-process harness, which isn't worth the complexity:
// the tamper tests above already verify GCM integrity, which is
// what would fail on a real key mismatch.)
