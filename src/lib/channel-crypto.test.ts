import test from "node:test";
import assert from "node:assert/strict";

import {
  encryptCredentials,
  decryptCredentials,
  encryptJson,
  decryptJson,
} from "./channel-crypto";

// All tests use a deterministic master key so results don't depend on
// the host's env. We set it before importing — but channel-crypto reads
// process.env at call time (not at import time), so we just set it here.
const ORIGINAL_KEY = process.env.CHANNEL_ENCRYPTION_KEY;
const ORIGINAL_SESSION = process.env.SESSION_SECRET;

function withKey(key: string, fn: () => void) {
  const prev = process.env.CHANNEL_ENCRYPTION_KEY;
  process.env.CHANNEL_ENCRYPTION_KEY = key;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.CHANNEL_ENCRYPTION_KEY;
    else process.env.CHANNEL_ENCRYPTION_KEY = prev;
  }
}

test("setup: pin a known key for the suite", () => {
  process.env.CHANNEL_ENCRYPTION_KEY = "test-master-key-do-not-use-in-prod";
  // Restore after suite (best-effort — node:test doesn't have global teardown).
  process.on("beforeExit", () => {
    if (ORIGINAL_KEY === undefined) delete process.env.CHANNEL_ENCRYPTION_KEY;
    else process.env.CHANNEL_ENCRYPTION_KEY = ORIGINAL_KEY;
    if (ORIGINAL_SESSION === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = ORIGINAL_SESSION;
  });
});

test("encrypt → decrypt round-trips a simple string", () => {
  const ct = encryptCredentials("hello world");
  assert.equal(decryptCredentials(ct), "hello world");
});

test("encrypt produces base64-encoded output (no slashes/plus stripped — standard base64)", () => {
  const ct = encryptCredentials("hello");
  // base64 chars only.
  assert.match(ct, /^[A-Za-z0-9+/=]+$/);
});

test("encrypt is non-deterministic (random IV every call)", () => {
  const a = encryptCredentials("same input");
  const b = encryptCredentials("same input");
  assert.notEqual(a, b, "two encryptions of same plaintext must differ (IV)");
  assert.equal(decryptCredentials(a), "same input");
  assert.equal(decryptCredentials(b), "same input");
});

test("ciphertext length grows with plaintext (no fixed-size leak)", () => {
  const short = encryptCredentials("a");
  const long = encryptCredentials("a".repeat(1000));
  assert.ok(long.length > short.length);
});

test("decrypt fails on tampered ciphertext (auth tag check)", () => {
  const ct = encryptCredentials("trusted payload");
  const buf = Buffer.from(ct, "base64");
  // Flip a byte in the ciphertext region (after iv[12] + tag[16] = 28).
  buf[30] = buf[30] ^ 0xff;
  const tampered = buf.toString("base64");
  assert.throws(() => decryptCredentials(tampered));
});

test("decrypt fails on tampered auth tag", () => {
  const ct = encryptCredentials("trusted payload");
  const buf = Buffer.from(ct, "base64");
  // Flip a byte in the auth-tag region (bytes 12..27).
  buf[15] = buf[15] ^ 0xff;
  const tampered = buf.toString("base64");
  assert.throws(() => decryptCredentials(tampered));
});

test("decrypt fails when wrong key is used", () => {
  const ct = encryptCredentials("secret");
  withKey("a-completely-different-master-key", () => {
    assert.throws(() => decryptCredentials(ct));
  });
});

test("round-trips empty string", () => {
  const ct = encryptCredentials("");
  assert.equal(decryptCredentials(ct), "");
});

test("round-trips unicode + emoji", () => {
  const message = "✓ café — naïve résumé 🔒 名前";
  const ct = encryptCredentials(message);
  assert.equal(decryptCredentials(ct), message);
});

test("round-trips large payloads (32 KB)", () => {
  const big = "x".repeat(32 * 1024);
  const ct = encryptCredentials(big);
  assert.equal(decryptCredentials(ct), big);
});

test("encryptJson / decryptJson round-trip an object", () => {
  const data = { username: "barista@cafe.com", password: "p@ss w/ symbols", scopes: ["read", "write"] };
  const ct = encryptJson(data);
  assert.deepEqual(decryptJson(ct), data);
});

test("encryptJson handles nested objects + arrays", () => {
  const data = {
    a: 1,
    b: { c: [1, 2, { d: "deep" }] },
    e: null,
  };
  const ct = encryptJson(data);
  assert.deepEqual(decryptJson(ct), data);
});

test("decryptJson throws on garbage base64", () => {
  assert.throws(() => decryptJson("not-base64!!!"));
});

test("falls back to SESSION_SECRET when CHANNEL_ENCRYPTION_KEY is unset", () => {
  const origChannel = process.env.CHANNEL_ENCRYPTION_KEY;
  const origSession = process.env.SESSION_SECRET;
  try {
    delete process.env.CHANNEL_ENCRYPTION_KEY;
    process.env.SESSION_SECRET = "fallback-session-secret-for-test";
    const ct = encryptCredentials("hello");
    assert.equal(decryptCredentials(ct), "hello");
  } finally {
    if (origChannel === undefined) delete process.env.CHANNEL_ENCRYPTION_KEY;
    else process.env.CHANNEL_ENCRYPTION_KEY = origChannel;
    if (origSession === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = origSession;
  }
});

test("ciphertext from one key cannot be decrypted with another", () => {
  let ct: string;
  withKey("key-A", () => {
    ct = encryptCredentials("k-a-secret");
  });
  withKey("key-B", () => {
    assert.throws(() => decryptCredentials(ct!));
  });
});

test("two different keys produce different ciphertext for the same plaintext", () => {
  let ctA: string;
  let ctB: string;
  withKey("key-one", () => {
    ctA = encryptCredentials("same");
  });
  withKey("key-two", () => {
    ctB = encryptCredentials("same");
  });
  // Even if IVs were equal, the underlying key change would produce different ciphertext.
  assert.notEqual(ctA!, ctB!);
});
