import test from "node:test";
import assert from "node:assert/strict";

import { extensionCorsHeaders, isExtensionOrigin } from "./extension-cors";

// ── isExtensionOrigin: allow-list gate ─────────────────────────────

test("accepts chrome-extension:// origins", () => {
  assert.equal(
    isExtensionOrigin("chrome-extension://abcdef1234567890"),
    true,
  );
});

test("accepts moz-extension:// origins (Firefox)", () => {
  assert.equal(
    isExtensionOrigin("moz-extension://01234567-89ab-cdef-0123-456789abcdef"),
    true,
  );
});

test("rejects http/https web origins (extension-only helper)", () => {
  // The whole point of this helper is to NOT open our cookie'd
  // endpoints to arbitrary websites. Any http:// or https:// origin
  // must fail closed.
  assert.equal(isExtensionOrigin("https://evil.com"), false);
  assert.equal(isExtensionOrigin("http://localhost:3000"), false);
  assert.equal(isExtensionOrigin("https://stockpilot.app"), false);
});

test("rejects null / undefined / empty origin (Origin header absent)", () => {
  assert.equal(isExtensionOrigin(null), false);
  assert.equal(isExtensionOrigin(undefined), false);
  assert.equal(isExtensionOrigin(""), false);
});

test("rejects file:// and data: origins (not extension schemes)", () => {
  assert.equal(isExtensionOrigin("file:///home/user/index.html"), false);
  assert.equal(isExtensionOrigin("data:text/html,<script>"), false);
});

test("accepts mixed-case scheme (browsers always lowercase but be defensive)", () => {
  // Comment in the source says this is intentional — a
  // case-mismatched origin shouldn't silently 401 the extension.
  assert.equal(
    isExtensionOrigin("Chrome-Extension://abcdef1234567890"),
    true,
  );
  assert.equal(
    isExtensionOrigin("MOZ-EXTENSION://plugin-id"),
    true,
  );
});

test("rejects a near-miss scheme (safari-web-extension://)", () => {
  // We only allow chrome + moz today. If Safari support gets added
  // this test should flip — keeps the allow-list honest.
  assert.equal(
    isExtensionOrigin("safari-web-extension://abcdef"),
    false,
  );
});

test("rejects origin where the scheme is a prefix of a non-extension scheme", () => {
  // A pathological origin like "chrome-extension-evil://..." starts
  // with "chrome-extension" but NOT with "chrome-extension://", so it
  // must be rejected. Guards against lazy startsWith checks missing
  // the colon-slash-slash.
  assert.equal(
    isExtensionOrigin("chrome-extension-evil://xyz"),
    false,
  );
});

// ── extensionCorsHeaders: build the CORS response headers ──────────

test("returns empty object for non-extension origin (no headers leak to web)", () => {
  // Calling this from a handler that serves both extension + browser
  // clients should produce zero CORS headers when the caller isn't
  // the extension — the browser's same-origin rules take over.
  assert.deepEqual(extensionCorsHeaders("https://evil.com"), {});
  assert.deepEqual(extensionCorsHeaders(null), {});
  assert.deepEqual(extensionCorsHeaders(undefined), {});
  assert.deepEqual(extensionCorsHeaders(""), {});
});

test("echoes the extension origin byte-for-byte in Allow-Origin", () => {
  // The RFC says Allow-Origin is compared byte-by-byte to Origin —
  // lowercasing or trimming would break credentials-bearing preflights.
  const origin = "chrome-extension://AbCdEf0123";
  const headers = extensionCorsHeaders(origin);
  assert.equal(headers["Access-Control-Allow-Origin"], origin);
});

test("sets Allow-Credentials: true (session cookie flows with requests)", () => {
  const headers = extensionCorsHeaders("chrome-extension://abc");
  assert.equal(headers["Access-Control-Allow-Credentials"], "true");
});

test("Allow-Origin is never '*' — wildcards are incompatible with credentials", () => {
  // A common CORS mistake: setting Allow-Origin: * AND
  // Allow-Credentials: true. Browsers reject that combo, so the
  // extension's fetch would fail. Verify we never emit "*".
  const headers = extensionCorsHeaders("chrome-extension://abc");
  assert.notEqual(headers["Access-Control-Allow-Origin"], "*");
});

test("advertises the HTTP methods the extension actually uses (GET, POST, OPTIONS)", () => {
  const headers = extensionCorsHeaders("chrome-extension://abc");
  const methods = headers["Access-Control-Allow-Methods"].split(/\s*,\s*/);
  for (const m of ["GET", "POST", "OPTIONS"]) {
    assert.ok(
      methods.includes(m),
      `expected ${m} in Allow-Methods, got ${headers["Access-Control-Allow-Methods"]}`,
    );
  }
});

test("advertises the headers the extension sends (content-type, accept)", () => {
  const headers = extensionCorsHeaders("chrome-extension://abc");
  const hdrs = headers["Access-Control-Allow-Headers"]
    .toLowerCase()
    .split(/\s*,\s*/);
  assert.ok(hdrs.includes("content-type"));
  assert.ok(hdrs.includes("accept"));
});

test("sets Vary: Origin so caches don't serve the wrong Allow-Origin", () => {
  // Without Vary:Origin a proxy cache could serve an extension's
  // headers back to a web origin request — that's exactly the
  // scenario extension-only CORS is trying to prevent.
  const headers = extensionCorsHeaders("chrome-extension://abc");
  assert.equal(headers["Vary"], "Origin");
});

test("non-extension origin gets NONE of the CORS headers (no partial leak)", () => {
  // Defense in depth: if the allow-list gate trips, the entire
  // header bundle should be empty — not just Allow-Origin.
  const headers = extensionCorsHeaders("https://evil.com");
  for (const h of [
    "Access-Control-Allow-Origin",
    "Access-Control-Allow-Credentials",
    "Access-Control-Allow-Methods",
    "Access-Control-Allow-Headers",
    "Vary",
  ]) {
    assert.equal(headers[h], undefined, `${h} should not be present`);
  }
});
