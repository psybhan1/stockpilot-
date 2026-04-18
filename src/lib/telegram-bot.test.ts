import test from "node:test";
import assert from "node:assert/strict";

import { env } from "./env";
import {
  approvalKeyboard,
  getTelegramWebhookSecret,
  getTelegramWebhookUrl,
  isValidTelegramWebhook,
} from "./telegram-bot";

// Like reply-address.test: env.* is read at CALL time, not module
// load time. env is a plain (mutable) object — snapshot + restore
// around each test to keep tests independent.
type TeleEnv = {
  TELEGRAM_WEBHOOK_SECRET: string | undefined;
  SESSION_SECRET: string;
  APP_URL: string;
};

function snapshot(): TeleEnv {
  return {
    TELEGRAM_WEBHOOK_SECRET: env.TELEGRAM_WEBHOOK_SECRET,
    SESSION_SECRET: env.SESSION_SECRET,
    APP_URL: env.APP_URL,
  };
}

function restore(s: TeleEnv) {
  (env as { TELEGRAM_WEBHOOK_SECRET: string | undefined }).TELEGRAM_WEBHOOK_SECRET =
    s.TELEGRAM_WEBHOOK_SECRET;
  (env as { SESSION_SECRET: string }).SESSION_SECRET = s.SESSION_SECRET;
  (env as { APP_URL: string }).APP_URL = s.APP_URL;
}

// ── approvalKeyboard ────────────────────────────────────────────────

test("approvalKeyboard: single row with two buttons (Approve + Cancel)", () => {
  const kb = approvalKeyboard("clx1abc2def3ghi4");
  assert.equal(kb.length, 1);
  assert.equal(kb[0].length, 2);
});

test("approvalKeyboard: Approve button carries po_approve:<id> callback", () => {
  const kb = approvalKeyboard("clx1abc2def3ghi4");
  const approve = kb[0][0];
  assert.ok("callback_data" in approve);
  assert.equal(approve.callback_data, "po_approve:clx1abc2def3ghi4");
});

test("approvalKeyboard: Cancel button carries po_cancel:<id> callback", () => {
  const kb = approvalKeyboard("clx1abc2def3ghi4");
  const cancel = kb[0][1];
  assert.ok("callback_data" in cancel);
  assert.equal(cancel.callback_data, "po_cancel:clx1abc2def3ghi4");
});

test("approvalKeyboard: embeds the PO id verbatim (not URL-encoded)", () => {
  // PO ids are cuids (alphanumeric only) so they survive verbatim.
  // A regression that urlEncoded them would break the callback
  // parser in /api/bot/telegram which splits on ':' and expects
  // the raw id.
  const kb = approvalKeyboard("cuid-with-hyphens-not-really");
  const approve = kb[0][0] as { callback_data: string };
  assert.equal(approve.callback_data, "po_approve:cuid-with-hyphens-not-really");
});

test("approvalKeyboard: callback payload fits Telegram's 64-byte limit", () => {
  // Telegram hard-caps callback_data to 64 bytes UTF-8. A 25-char
  // cuid + "po_approve:" (11) = 36 bytes, well under. Regression
  // guard so we catch it if we ever switch to UUIDs (37 chars +
  // hyphens = 48 + prefix = 59) or add richer payloads.
  const kb = approvalKeyboard("a".repeat(25));
  for (const row of kb) {
    for (const btn of row) {
      if ("callback_data" in btn) {
        assert.ok(
          Buffer.byteLength(btn.callback_data, "utf8") <= 64,
          `callback_data too long: ${btn.callback_data.length}`,
        );
      }
    }
  }
});

test("approvalKeyboard: button text is human-readable (non-empty)", () => {
  const kb = approvalKeyboard("x123456789");
  for (const row of kb) {
    for (const btn of row) {
      assert.ok(btn.text.length > 0, "button text must not be empty");
    }
  }
});

// ── getTelegramWebhookSecret ────────────────────────────────────────

test("webhook secret: explicit TELEGRAM_WEBHOOK_SECRET wins over SESSION_SECRET", () => {
  const saved = snapshot();
  try {
    (env as { TELEGRAM_WEBHOOK_SECRET: string | undefined }).TELEGRAM_WEBHOOK_SECRET =
      "my-explicit-webhook-secret";
    (env as { SESSION_SECRET: string }).SESSION_SECRET = "session-key-xyz";
    assert.equal(getTelegramWebhookSecret(), "my-explicit-webhook-secret");
  } finally {
    restore(saved);
  }
});

test("webhook secret: trims surrounding whitespace on explicit secret", () => {
  const saved = snapshot();
  try {
    (env as { TELEGRAM_WEBHOOK_SECRET: string | undefined }).TELEGRAM_WEBHOOK_SECRET =
      "  padded-secret  ";
    assert.equal(getTelegramWebhookSecret(), "padded-secret");
  } finally {
    restore(saved);
  }
});

test("webhook secret: whitespace-only explicit secret falls through to SESSION_SECRET derivation", () => {
  const saved = snapshot();
  try {
    (env as { TELEGRAM_WEBHOOK_SECRET: string | undefined }).TELEGRAM_WEBHOOK_SECRET = "   ";
    (env as { SESSION_SECRET: string }).SESSION_SECRET = "session-key-xyz";
    const derived = getTelegramWebhookSecret();
    assert.ok(derived, "should derive from SESSION_SECRET");
    // Derivation is HMAC-ish; length is 48 (see impl).
    // base64url of sha256(32 bytes) is 43 chars (44 w/ padding, base64url strips it).
    // The slice(0, 48) in the impl is defensive — actual length < 48.
    assert.equal(derived?.length, 43);
    assert.notEqual(derived, "   ");
  } finally {
    restore(saved);
  }
});

test("webhook secret: derivation from SESSION_SECRET is stable (same input → same output)", () => {
  const saved = snapshot();
  try {
    (env as { TELEGRAM_WEBHOOK_SECRET: string | undefined }).TELEGRAM_WEBHOOK_SECRET = undefined;
    (env as { SESSION_SECRET: string }).SESSION_SECRET = "stable-session-secret";
    const a = getTelegramWebhookSecret();
    const b = getTelegramWebhookSecret();
    assert.equal(a, b);
    assert.ok(a && a.length === 43);
  } finally {
    restore(saved);
  }
});

test("webhook secret: different SESSION_SECRETs derive different webhook secrets", () => {
  // If two deployments share SESSION_SECRET they'd share webhook
  // secret too — but across envs the derivation must diverge, else
  // staging and prod collide.
  const saved = snapshot();
  try {
    (env as { TELEGRAM_WEBHOOK_SECRET: string | undefined }).TELEGRAM_WEBHOOK_SECRET = undefined;
    (env as { SESSION_SECRET: string }).SESSION_SECRET = "session-a";
    const a = getTelegramWebhookSecret();
    (env as { SESSION_SECRET: string }).SESSION_SECRET = "session-b";
    const b = getTelegramWebhookSecret();
    assert.notEqual(a, b);
  } finally {
    restore(saved);
  }
});

test("webhook secret: base64url output (no '+' '/' '=' chars)", () => {
  // URL-safe base64 is required — Telegram passes the secret
  // verbatim in an HTTP header; '+' gets form-encoded to ' ' by
  // some middleware and breaks equality check.
  const saved = snapshot();
  try {
    (env as { TELEGRAM_WEBHOOK_SECRET: string | undefined }).TELEGRAM_WEBHOOK_SECRET = undefined;
    (env as { SESSION_SECRET: string }).SESSION_SECRET = "any";
    const s = getTelegramWebhookSecret();
    assert.ok(s);
    assert.ok(!s.includes("+"), `secret leaked + char: ${s}`);
    assert.ok(!s.includes("/"), `secret leaked / char: ${s}`);
    assert.ok(!s.includes("="), `secret leaked = char: ${s}`);
  } finally {
    restore(saved);
  }
});

test("webhook secret: null when SESSION_SECRET is empty AND no explicit secret", () => {
  // Returning null tells ensureTelegramWebhook to refuse setup.
  const saved = snapshot();
  try {
    (env as { TELEGRAM_WEBHOOK_SECRET: string | undefined }).TELEGRAM_WEBHOOK_SECRET = undefined;
    (env as { SESSION_SECRET: string }).SESSION_SECRET = "";
    assert.equal(getTelegramWebhookSecret(), null);
  } finally {
    restore(saved);
  }
});

// ── isValidTelegramWebhook ──────────────────────────────────────────

function req(token: string | null): Request {
  const headers = new Headers();
  if (token !== null) headers.set("x-telegram-bot-api-secret-token", token);
  return new Request("https://example.com/", { headers });
}

test("isValidTelegramWebhook: rejects mismatched secret header", () => {
  const saved = snapshot();
  try {
    (env as { TELEGRAM_WEBHOOK_SECRET: string | undefined }).TELEGRAM_WEBHOOK_SECRET =
      "expected-secret";
    assert.equal(isValidTelegramWebhook(req("wrong-secret")), false);
  } finally {
    restore(saved);
  }
});

test("isValidTelegramWebhook: accepts matching secret header", () => {
  const saved = snapshot();
  try {
    (env as { TELEGRAM_WEBHOOK_SECRET: string | undefined }).TELEGRAM_WEBHOOK_SECRET =
      "expected-secret";
    assert.equal(isValidTelegramWebhook(req("expected-secret")), true);
  } finally {
    restore(saved);
  }
});

test("isValidTelegramWebhook: rejects missing header when secret is configured", () => {
  const saved = snapshot();
  try {
    (env as { TELEGRAM_WEBHOOK_SECRET: string | undefined }).TELEGRAM_WEBHOOK_SECRET =
      "expected-secret";
    assert.equal(isValidTelegramWebhook(req(null)), false);
  } finally {
    restore(saved);
  }
});

test("isValidTelegramWebhook: fails closed against a DERIVED secret too", () => {
  // When no explicit TELEGRAM_WEBHOOK_SECRET but SESSION_SECRET
  // present, the handler must still reject wrong headers —
  // otherwise a missing env var silently disables all webhook auth.
  const saved = snapshot();
  try {
    (env as { TELEGRAM_WEBHOOK_SECRET: string | undefined }).TELEGRAM_WEBHOOK_SECRET = undefined;
    (env as { SESSION_SECRET: string }).SESSION_SECRET = "prod-session-secret";
    assert.equal(isValidTelegramWebhook(req("guess")), false);
    const derived = getTelegramWebhookSecret();
    assert.ok(derived);
    assert.equal(isValidTelegramWebhook(req(derived)), true);
  } finally {
    restore(saved);
  }
});

test("isValidTelegramWebhook: returns TRUE when NO secret is configured (dev escape hatch)", () => {
  // Documented dev behaviour: if the operator removes
  // TELEGRAM_WEBHOOK_SECRET and SESSION_SECRET (unrealistic but
  // possible in local dev), auth is skipped. Pin that so a future
  // "fail closed everywhere" refactor doesn't silently break local
  // tunnel setups — should be an explicit decision.
  const saved = snapshot();
  try {
    (env as { TELEGRAM_WEBHOOK_SECRET: string | undefined }).TELEGRAM_WEBHOOK_SECRET = undefined;
    (env as { SESSION_SECRET: string }).SESSION_SECRET = "";
    assert.equal(isValidTelegramWebhook(req(null)), true);
    assert.equal(isValidTelegramWebhook(req("anything")), true);
  } finally {
    restore(saved);
  }
});

test("isValidTelegramWebhook: case-sensitive match (Telegram headers compared byte-for-byte)", () => {
  // Telegram's `secret_token` is returned verbatim; a case-munging
  // proxy would break our check. This test pins byte-exact compare
  // so future "case-insensitive for convenience" refactors fail
  // loudly.
  const saved = snapshot();
  try {
    (env as { TELEGRAM_WEBHOOK_SECRET: string | undefined }).TELEGRAM_WEBHOOK_SECRET = "AbC123";
    assert.equal(isValidTelegramWebhook(req("abc123")), false);
    assert.equal(isValidTelegramWebhook(req("AbC123")), true);
  } finally {
    restore(saved);
  }
});

// ── getTelegramWebhookUrl ───────────────────────────────────────────

test("webhook url: builds https URL from APP_URL", () => {
  const saved = snapshot();
  try {
    (env as { APP_URL: string }).APP_URL = "https://stockpilot.example.com";
    assert.equal(
      getTelegramWebhookUrl(),
      "https://stockpilot.example.com/api/bot/telegram",
    );
  } finally {
    restore(saved);
  }
});

test("webhook url: strips trailing slash on APP_URL before appending path", () => {
  const saved = snapshot();
  try {
    (env as { APP_URL: string }).APP_URL = "https://stockpilot.example.com/";
    assert.equal(
      getTelegramWebhookUrl(),
      "https://stockpilot.example.com/api/bot/telegram",
    );
  } finally {
    restore(saved);
  }
});

test("webhook url: rejects http:// (Telegram requires TLS)", () => {
  // Telegram's setWebhook rejects non-https URLs; fail in our
  // validation before we call out, otherwise the API call will
  // fail with a confusing error at deploy-time.
  const saved = snapshot();
  try {
    (env as { APP_URL: string }).APP_URL = "http://insecure.example.com";
    assert.equal(getTelegramWebhookUrl(), null);
  } finally {
    restore(saved);
  }
});

test("webhook url: rejects empty APP_URL", () => {
  const saved = snapshot();
  try {
    (env as { APP_URL: string }).APP_URL = "";
    assert.equal(getTelegramWebhookUrl(), null);
  } finally {
    restore(saved);
  }
});

test("webhook url: rejects un-parseable APP_URL (returns null, does not throw)", () => {
  const saved = snapshot();
  try {
    (env as { APP_URL: string }).APP_URL = "not a url at all !!";
    assert.doesNotThrow(() => getTelegramWebhookUrl());
    assert.equal(getTelegramWebhookUrl(), null);
  } finally {
    restore(saved);
  }
});

test("webhook url: preserves port in APP_URL", () => {
  // Some tunnels (ngrok paid tier, cloudflared) return URLs with
  // non-443 ports. Make sure they survive.
  const saved = snapshot();
  try {
    (env as { APP_URL: string }).APP_URL = "https://tunnel.example.com:8443";
    assert.equal(
      getTelegramWebhookUrl(),
      "https://tunnel.example.com:8443/api/bot/telegram",
    );
  } finally {
    restore(saved);
  }
});

test("webhook url: works with localhost.https even in dev (edge: self-signed)", () => {
  // Rare but supported — dev operator with a mkcert setup might
  // use https://localhost:3000. We don't care about cert validity
  // here, only URL shape.
  const saved = snapshot();
  try {
    (env as { APP_URL: string }).APP_URL = "https://localhost:3000";
    assert.equal(
      getTelegramWebhookUrl(),
      "https://localhost:3000/api/bot/telegram",
    );
  } finally {
    restore(saved);
  }
});
