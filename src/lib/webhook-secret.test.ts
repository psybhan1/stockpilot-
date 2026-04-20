import test from "node:test";
import assert from "node:assert/strict";

import { isWebhookSecretValid } from "./webhook-secret";

function makeHeaders(init: Record<string, string> = {}): Headers {
  return new Headers(init);
}

test("returns true when no expected secret is configured (open by design for unset env)", () => {
  const headers = makeHeaders();
  assert.equal(isWebhookSecretValid(headers, undefined), true);
  assert.equal(isWebhookSecretValid(headers, null), true);
  assert.equal(isWebhookSecretValid(headers, ""), true);
  // whitespace-only secret is normalized to empty → also "no secret"
  assert.equal(isWebhookSecretValid(headers, "   "), true);
});

test("rejects request that omits the secret header when one is required", () => {
  const headers = makeHeaders();
  assert.equal(isWebhookSecretValid(headers, "expected-secret"), false);
});

test("rejects request that sends an empty / whitespace-only secret header", () => {
  const headers = makeHeaders({ "x-stockpilot-webhook-secret": "" });
  assert.equal(isWebhookSecretValid(headers, "expected-secret"), false);

  const headers2 = makeHeaders({ "x-stockpilot-webhook-secret": "   " });
  assert.equal(isWebhookSecretValid(headers2, "expected-secret"), false);
});

test("accepts request with the exact matching secret", () => {
  const headers = makeHeaders({
    "x-stockpilot-webhook-secret": "supersecret-token-abc123",
  });
  assert.equal(isWebhookSecretValid(headers, "supersecret-token-abc123"), true);
});

test("trims leading + trailing whitespace before comparing (env vars often picked up with newlines)", () => {
  const headers = makeHeaders({ "x-stockpilot-webhook-secret": "  abc  " });
  assert.equal(isWebhookSecretValid(headers, "abc"), true);
  assert.equal(isWebhookSecretValid(headers, "\nabc\n"), true);
});

test("rejects when secret of wrong length is provided (no truncation, no padding)", () => {
  const headers = makeHeaders({ "x-stockpilot-webhook-secret": "abc" });
  assert.equal(isWebhookSecretValid(headers, "abcd"), false);

  const headers2 = makeHeaders({ "x-stockpilot-webhook-secret": "abcdef" });
  assert.equal(isWebhookSecretValid(headers2, "abcd"), false);
});

test("rejects on case-mismatch — secrets are byte-exact", () => {
  const headers = makeHeaders({ "x-stockpilot-webhook-secret": "ABCDEF" });
  assert.equal(isWebhookSecretValid(headers, "abcdef"), false);
});

test("rejects on single-character difference (defends against guess-by-prefix)", () => {
  const headers = makeHeaders({
    "x-stockpilot-webhook-secret": "supersecret-token-abc124",
  });
  assert.equal(isWebhookSecretValid(headers, "supersecret-token-abc123"), false);
});

test("works with long base64-style secrets (the realistic case)", () => {
  // Real webhook secrets in production look like a 32+ byte random base64 token.
  const secret = "Zk7yQp9XfL2vMr8nAa1Bb3CcDdEeFf4Gg5HhJjKkLlMm6Nn7Oo8Pp9QqRrSs0Tt=";
  const headers = makeHeaders({ "x-stockpilot-webhook-secret": secret });
  assert.equal(isWebhookSecretValid(headers, secret), true);

  // Single-character mutation at the tail should still reject (defends
  // against guess-by-suffix in addition to guess-by-prefix).
  const tampered = secret.slice(0, -2) + "ZZ";
  const headers2 = makeHeaders({ "x-stockpilot-webhook-secret": tampered });
  assert.equal(isWebhookSecretValid(headers2, secret), false);
});

test("header name is matched case-insensitively (Headers spec normalizes)", () => {
  // Standard Headers normalizes lookup key to lowercase, so any case works on the wire.
  const headers = new Headers();
  headers.set("X-StockPilot-Webhook-Secret", "abc");
  assert.equal(isWebhookSecretValid(headers, "abc"), true);
});

test("does not consult any other header — only x-stockpilot-webhook-secret", () => {
  const headers = makeHeaders({
    authorization: "Bearer abc",
    "x-secret": "abc",
    "x-webhook-secret": "abc",
  });
  // Right value, wrong header → still rejected
  assert.equal(isWebhookSecretValid(headers, "abc"), false);
});
