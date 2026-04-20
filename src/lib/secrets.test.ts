import test from "node:test";
import assert from "node:assert/strict";

import { decryptSecret, encryptSecret } from "./secrets";

// ── Round-trip correctness ──────────────────────────────────────────

test("encrypt → decrypt round-trips the original plaintext", () => {
  const plaintext = "square-access-token-EABClongrandomstring";
  const enc = encryptSecret(plaintext);
  assert.notEqual(enc, plaintext);
  assert.equal(decryptSecret(enc), plaintext);
});

test("round-trips empty string (edge: clearing a token)", () => {
  const enc = encryptSecret("");
  assert.equal(decryptSecret(enc), "");
});

test("round-trips 4KB payload (realistic refresh-token upper bound)", () => {
  const plaintext = "x".repeat(4096);
  assert.equal(decryptSecret(encryptSecret(plaintext)), plaintext);
});

test("round-trips utf8 (multi-byte characters decrypted to the same string)", () => {
  const plaintext = "café-密码-🔑-Ω";
  assert.equal(decryptSecret(encryptSecret(plaintext)), plaintext);
});

// ── Format: base64 with 12-byte IV + 16-byte auth tag prefix ───────

test("encrypt output is base64 and starts with IV + auth tag bytes", () => {
  const enc = encryptSecret("abc");
  // Base64 decode should succeed with no errors.
  const bytes = Buffer.from(enc, "base64");
  // 12 bytes IV + 16 bytes auth tag + N bytes ciphertext (>=1 for "abc").
  assert.ok(
    bytes.length >= 12 + 16 + 1,
    `expected at least 29 bytes, got ${bytes.length}`,
  );
});

test("empty-plaintext ciphertext still has the IV + tag prefix (28 bytes)", () => {
  const enc = encryptSecret("");
  const bytes = Buffer.from(enc, "base64");
  // Even with empty plaintext, GCM emits the full IV + tag.
  assert.equal(bytes.length, 12 + 16);
});

// ── Non-determinism: fresh IV on every call ────────────────────────

test("two encryptions of the same plaintext produce different ciphertexts (fresh IV)", () => {
  // As with credential-encryption: catastrophic if we ever reuse an
  // IV under the same key.
  const a = encryptSecret("same-input");
  const b = encryptSecret("same-input");
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a), "same-input");
  assert.equal(decryptSecret(b), "same-input");
});

// ── Tamper detection (authenticated encryption) ────────────────────

test("decryptSecret throws when any byte of the ciphertext is flipped", () => {
  const enc = encryptSecret("important-token");
  const bytes = Buffer.from(enc, "base64");
  // Flip the last byte (in the ciphertext region, safely past IV+tag).
  bytes[bytes.length - 1] ^= 0xff;
  const tampered = bytes.toString("base64");
  assert.throws(() => decryptSecret(tampered));
});

test("decryptSecret throws when the auth tag is zeroed out", () => {
  const enc = encryptSecret("important-token");
  const bytes = Buffer.from(enc, "base64");
  // Zero the auth tag (bytes 12..27) — guaranteed invalid.
  for (let i = 12; i < 28; i += 1) bytes[i] = 0;
  assert.throws(() => decryptSecret(bytes.toString("base64")));
});

test("decryptSecret throws when the IV is swapped for zeros (wrong nonce)", () => {
  const enc = encryptSecret("important-token");
  const bytes = Buffer.from(enc, "base64");
  for (let i = 0; i < 12; i += 1) bytes[i] = 0;
  assert.throws(() => decryptSecret(bytes.toString("base64")));
});

// ── Isolation: two encryptions can each be independently decrypted ─

test("decryption of ciphertext A is unaffected by ciphertext B", () => {
  const a = encryptSecret("alpha");
  const b = encryptSecret("beta");
  // Decrypt in reverse order — each must still round-trip.
  assert.equal(decryptSecret(b), "beta");
  assert.equal(decryptSecret(a), "alpha");
});

// ── Cross-module isolation from credential-encryption ──────────────

test("secrets.encryptSecret and credential-encryption.encryptCredential produce incompatible outputs", async () => {
  // They use different derivation secrets (SESSION_SECRET vs
  // N8N_WEBHOOK_SECRET) and different wire formats. Mixing them
  // up in a migration would silently break — this test is a
  // tripwire.
  // env.N8N_WEBHOOK_SECRET was captured from process.env at
  // env.ts load time. If this test file runs first in the suite,
  // process.env.N8N_WEBHOOK_SECRET is unset and deriveKey throws.
  // Mutate the exported env object directly (it's a plain, non-
  // frozen object) so the next deriveKey() call succeeds.
  const { env } = await import("./env");
  (env as { N8N_WEBHOOK_SECRET: string | undefined }).N8N_WEBHOOK_SECRET =
    env.N8N_WEBHOOK_SECRET ?? "test-secret-for-secret-isolation";
  const { decryptCredential } = await import("./credential-encryption");
  const secretsOutput = encryptSecret("hello");
  // credential-encryption reads the prefix first; secrets output
  // is raw base64 without "enc:v1:" so decryptCredential treats
  // it as legacy plaintext and returns it unchanged.
  assert.equal(decryptCredential(secretsOutput), secretsOutput);
  // And decryptSecret on a credential-encryption output throws
  // because the base64 decode of "enc:v1:..." produces garbage
  // bytes that won't GCM-verify.
  const { encryptCredential } = await import("./credential-encryption");
  const credOutput = encryptCredential("hello");
  assert.throws(() => decryptSecret(credOutput));
});
