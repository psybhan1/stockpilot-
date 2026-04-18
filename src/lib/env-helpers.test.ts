import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildN8nWebhookUrl, parsePositiveNumber } from "./env-helpers";

describe("parsePositiveNumber — valid inputs", () => {
  it("parses a plain positive integer", () => {
    assert.equal(parsePositiveNumber("30000", 999), 30000);
  });

  it("parses a positive float", () => {
    assert.equal(parsePositiveNumber("1.5", 999), 1.5);
  });

  it("parses with leading/trailing whitespace (Number() tolerates)", () => {
    assert.equal(parsePositiveNumber(" 42 ", 999), 42);
    assert.equal(parsePositiveNumber("\t42\n", 999), 42);
  });

  it("parses scientific notation", () => {
    assert.equal(parsePositiveNumber("1e3", 999), 1000);
  });

  it("parses very small positive numbers (> 0)", () => {
    assert.equal(parsePositiveNumber("0.0001", 999), 0.0001);
  });

  it("parses very large finite numbers", () => {
    assert.equal(parsePositiveNumber("9999999999", 0), 9999999999);
  });
});

describe("parsePositiveNumber — falls back", () => {
  it("falls back on undefined", () => {
    assert.equal(parsePositiveNumber(undefined, 15000), 15000);
  });

  it("falls back on empty string", () => {
    // Number('') is 0, which fails > 0, so we fall back.
    assert.equal(parsePositiveNumber("", 15000), 15000);
  });

  it("falls back on whitespace-only string", () => {
    assert.equal(parsePositiveNumber("   ", 15000), 15000);
  });

  it("falls back on non-numeric string", () => {
    assert.equal(parsePositiveNumber("abc", 15000), 15000);
    assert.equal(parsePositiveNumber("1abc", 15000), 15000);
  });

  it("falls back on 0 (not positive)", () => {
    assert.equal(parsePositiveNumber("0", 15000), 15000);
  });

  it("falls back on negative numbers", () => {
    assert.equal(parsePositiveNumber("-5", 15000), 15000);
    assert.equal(parsePositiveNumber("-0.01", 15000), 15000);
  });

  it("falls back on 'NaN'", () => {
    assert.equal(parsePositiveNumber("NaN", 15000), 15000);
  });

  it("falls back on 'Infinity' (not finite, even though Number('Infinity') is Infinity)", () => {
    // Locking this — a config like WORKER_POLL_MS=Infinity would
    // otherwise starve the event loop with a never-firing setTimeout.
    assert.equal(parsePositiveNumber("Infinity", 15000), 15000);
  });

  it("falls back on '-Infinity'", () => {
    assert.equal(parsePositiveNumber("-Infinity", 15000), 15000);
  });

  it("falls back on hex-looking string '0x10' (Number() parses but 16 > 0, so this should PASS)", () => {
    // Note: Number('0x10') === 16, so this actually passes the > 0 check.
    // Lock the current behaviour — don't silently start rejecting
    // hex if someone uses that as a config shortcut.
    assert.equal(parsePositiveNumber("0x10", 999), 16);
  });

  it("falls back when the fallback itself is 0 (returned as-is)", () => {
    assert.equal(parsePositiveNumber(undefined, 0), 0);
  });

  it("falls back when value is a comma-separated number (locale format unsupported)", () => {
    assert.equal(parsePositiveNumber("1,000", 999), 999);
  });
});

describe("parsePositiveNumber — purity", () => {
  it("is deterministic", () => {
    for (let i = 0; i < 5; i += 1) {
      assert.equal(parsePositiveNumber("30000", 999), 30000);
      assert.equal(parsePositiveNumber(undefined, 999), 999);
    }
  });
});

describe("buildN8nWebhookUrl — successful join", () => {
  it("joins base URL + path without trailing slash", () => {
    assert.equal(
      buildN8nWebhookUrl("https://n8n.example.com", "order-approval"),
      "https://n8n.example.com/webhook/order-approval"
    );
  });

  it("strips ONE trailing slash from the base URL before joining", () => {
    assert.equal(
      buildN8nWebhookUrl("https://n8n.example.com/", "order-approval"),
      "https://n8n.example.com/webhook/order-approval"
    );
  });

  it("strips only ONE trailing slash (double slash leaves one behind)", () => {
    // Lock the current behaviour — the regex /\/$/ removes exactly
    // one char. A malformed base URL like ".../" is cleaned up but
    // ".../ /" wouldn't be. This is intentional — users should fix
    // their config, not have us silently scrub it.
    assert.equal(
      buildN8nWebhookUrl("https://n8n.example.com//", "x"),
      "https://n8n.example.com//webhook/x"
    );
  });

  it("handles localhost + custom port", () => {
    assert.equal(
      buildN8nWebhookUrl("http://localhost:5678", "pos-sale"),
      "http://localhost:5678/webhook/pos-sale"
    );
  });

  it("handles a base URL with a subpath prefix", () => {
    // e.g. when n8n lives behind a reverse proxy at /automation.
    assert.equal(
      buildN8nWebhookUrl("https://host.test/automation", "abc"),
      "https://host.test/automation/webhook/abc"
    );
  });

  it("preserves path segments with dashes + underscores", () => {
    assert.equal(
      buildN8nWebhookUrl("https://x.y", "stockpilot-bot-interpret"),
      "https://x.y/webhook/stockpilot-bot-interpret"
    );
  });

  it("does NOT URL-encode the path (caller's responsibility)", () => {
    // The helper is a plain string concatenation — we don't want
    // it silently encoding a slash the caller put there on purpose.
    assert.equal(
      buildN8nWebhookUrl("https://x.y", "a/b"),
      "https://x.y/webhook/a/b"
    );
  });
});

describe("buildN8nWebhookUrl — returns undefined when base URL is missing", () => {
  it("undefined base → undefined", () => {
    assert.equal(buildN8nWebhookUrl(undefined, "x"), undefined);
  });

  it("empty-string base → undefined", () => {
    assert.equal(buildN8nWebhookUrl("", "x"), undefined);
  });

  it("whitespace-only base → undefined", () => {
    assert.equal(buildN8nWebhookUrl("   ", "x"), undefined);
    assert.equal(buildN8nWebhookUrl("\t\n", "x"), undefined);
  });

  it("does NOT return an empty-string — callers treat undefined as 'not configured'", () => {
    const result = buildN8nWebhookUrl("", "x");
    assert.equal(result, undefined);
    assert.notEqual(result, "");
  });
});

describe("buildN8nWebhookUrl — purity", () => {
  it("is deterministic", () => {
    for (let i = 0; i < 5; i += 1) {
      assert.equal(
        buildN8nWebhookUrl("https://n8n.example.com", "order-approval"),
        "https://n8n.example.com/webhook/order-approval"
      );
    }
  });

  it("does not mutate inputs", () => {
    const base = "https://n8n.example.com/";
    const path = "x";
    buildN8nWebhookUrl(base, path);
    assert.equal(base, "https://n8n.example.com/");
    assert.equal(path, "x");
  });

  it("handles an empty path (produces a '/webhook/' suffix verbatim)", () => {
    // Locking current behaviour — a caller passing "" shouldn't
    // silently break. The output has a trailing slash, which most
    // webhook endpoints accept.
    assert.equal(
      buildN8nWebhookUrl("https://x.y", ""),
      "https://x.y/webhook/"
    );
  });
});
