// Tests the StockPilot browser-extension surface:
//
//   - normaliseExtensionCookies handles well-formed, malformed, and
//     oversized payloads without crashing and without leaking data
//   - extension-cors helper allows only chrome-extension:// and
//     moz-extension:// origins — refuses every web origin / wildcard
//   - extension session token hashes round-trip (the "ext_" prefix
//     is mixed into the Session.tokenHash so the extension cookie
//     can't impersonate the main session cookie or vice versa)
//   - popup helpers parse every flavor of supplier.website, match
//     the active tab to the right supplier, ignore chrome:// tabs,
//     and normalise Chrome-shape cookies into our wire shape
//   - the built extension zip is a valid zip with every file the
//     manifest + popup refer to
//
// These are unit-level. Full wizard auto-link + extension POST is
// exercised by the existing restaurant-day test harness and by
// manual smoke testing on the deployed Railway app.

process.env.N8N_WEBHOOK_SECRET =
  process.env.N8N_WEBHOOK_SECRET ?? "test-webhook-secret-for-extension-suite";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-for-extension-suite";

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { normaliseExtensionCookies, MAX_COOKIES, MAX_VALUE_LENGTH } = await import(
  "../src/modules/suppliers/extension-cookies.ts"
);
const { extensionCorsHeaders, isExtensionOrigin } = await import(
  "../src/lib/extension-cors.ts"
);
const { _hashExtensionTokenForTests, EXTENSION_COOKIE_NAME } = await import(
  "../src/modules/auth/extension-session.ts"
);

// popup-helpers.js is an ES module — import via file URL so node
// treats it as an ESM.
const helpersUrl = pathToFileURL(
  resolve(import.meta.dirname!, "..", "browser-extension", "popup-helpers.js")
).href;
const {
  normaliseUrl,
  hostFromSupplierWebsite,
  etld1FromHost,
  isUsableTabUrl,
  originPatternForUrl,
  hostFromUrl,
  chromeToSerializable,
  pickMatchingSupplier,
} = (await import(helpersUrl)) as typeof import("../browser-extension/popup-helpers.js");

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: unknown, label: string) {
  if (cond) {
    passed += 1;
    console.log(`    ✅ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`    ❌ ${label}`);
  }
}

function scenario(name: string, fn: () => void | Promise<void>) {
  console.log(`\n━━ ${name}`);
  try {
    const out = fn();
    if (out instanceof Promise) return out;
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`    ❌ THREW: ${msg}`);
  }
}

// ── Cookie normalisation ────────────────────────────────────────────

scenario("Well-formed Chrome cookie payload passes through intact", () => {
  const res = normaliseExtensionCookies([
    {
      name: "session-token",
      value: "abc123",
      domain: ".amazon.com",
      path: "/",
      expires: 1750000000,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  if (!res.ok) throw new Error(res.reason);
  assert(res.cookies.length === 1, "exactly one cookie returned");
  const c = res.cookies[0];
  assert(c.name === "session-token", "name preserved");
  assert(c.value === "abc123", "value preserved");
  assert(c.domain === ".amazon.com", "domain preserved");
  assert(c.httpOnly === true, "httpOnly preserved");
  assert(c.sameSite === "Lax", "sameSite preserved");
});

scenario("Floating-point expires is floored (Chrome sends floats)", () => {
  const res = normaliseExtensionCookies([
    { name: "x", value: "y", expires: 1700000000.7 },
  ]);
  if (!res.ok) throw new Error(res.reason);
  assert(res.cookies[0].expires === 1700000000, "expires floored to int");
});

scenario("Non-array input rejected", () => {
  const res = normaliseExtensionCookies({ cookies: [] });
  assert(!res.ok, "object instead of array is rejected");
});

scenario("Empty array rejected", () => {
  const res = normaliseExtensionCookies([]);
  assert(!res.ok, "empty array is rejected");
});

scenario(`More than ${MAX_COOKIES} cookies rejected`, () => {
  const big: Array<{ name: string; value: string }> = [];
  for (let i = 0; i < MAX_COOKIES + 1; i++) {
    big.push({ name: `c${i}`, value: "v" });
  }
  const res = normaliseExtensionCookies(big);
  assert(!res.ok, `${MAX_COOKIES + 1} cookies rejected`);
});

scenario("Malformed entries silently dropped but well-formed ones kept", () => {
  const res = normaliseExtensionCookies([
    { name: "good", value: "v1" },
    { name: 42, value: "v2" },
    { name: "", value: "v3" },
    null,
    "string",
    { name: "good2", value: 99 },
    { name: "good3", value: "v4" },
  ]);
  if (!res.ok) throw new Error(res.reason);
  assert(res.cookies.length === 2, "two valid cookies survive");
  assert(res.cookies.map((c) => c.name).sort().join(",") === "good,good3", "good cookies kept by name");
});

scenario("Enormous cookie value is dropped but payload doesn't crash", () => {
  const res = normaliseExtensionCookies([
    { name: "fat", value: "x".repeat(MAX_VALUE_LENGTH + 1) },
    { name: "ok", value: "short" },
  ]);
  if (!res.ok) throw new Error(res.reason);
  assert(res.cookies.length === 1, "fat cookie dropped, short cookie kept");
  assert(res.cookies[0].name === "ok", "the right one survived");
});

scenario("Unknown sameSite value ignored (not coerced)", () => {
  const res = normaliseExtensionCookies([
    { name: "a", value: "b", sameSite: "unrestricted" },
  ]);
  if (!res.ok) throw new Error(res.reason);
  assert(res.cookies[0].sameSite === undefined, "unknown sameSite dropped");
});

scenario("No-well-formed-entries payload returns a reason, not an empty array", () => {
  const res = normaliseExtensionCookies([{ nope: 1 }, null, "hi"]);
  assert(!res.ok, "unparseable payload rejected");
});

// ── CORS allowlist ──────────────────────────────────────────────────

scenario("chrome-extension:// origin echoed back with credentials", () => {
  const origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert(isExtensionOrigin(origin), "origin recognised as extension");
  const headers = extensionCorsHeaders(origin);
  assert(headers["Access-Control-Allow-Origin"] === origin, "exact origin echoed");
  assert(headers["Access-Control-Allow-Credentials"] === "true", "credentials allowed");
  assert(headers["Vary"] === "Origin", "Vary: Origin set so CDN doesn't cross-pollinate");
});

scenario("moz-extension:// origin also works (Firefox sideload)", () => {
  const origin = "moz-extension://deadbeef-1234";
  assert(isExtensionOrigin(origin), "moz-extension recognised");
  const headers = extensionCorsHeaders(origin);
  assert(headers["Access-Control-Allow-Origin"] === origin, "moz origin echoed");
});

scenario("Random web origin NOT allowed (would be a credential leak)", () => {
  const bad = "https://evil.example.com";
  assert(!isExtensionOrigin(bad), "web origin refused");
  const headers = extensionCorsHeaders(bad);
  assert(Object.keys(headers).length === 0, "no CORS headers written for web origin");
});

scenario("Wildcard-like origin refused", () => {
  for (const bad of ["*", "null", "file://", "https://chrome-extension.evil.com"]) {
    assert(!isExtensionOrigin(bad), `refused origin "${bad}"`);
    assert(Object.keys(extensionCorsHeaders(bad)).length === 0, `no headers for "${bad}"`);
  }
});

scenario("Missing/undefined origin refused", () => {
  assert(!isExtensionOrigin(null), "null refused");
  assert(!isExtensionOrigin(undefined), "undefined refused");
  assert(!isExtensionOrigin(""), "empty string refused");
});

// ── Extension session hashing: token namespaces don't collide ──────

scenario("Extension and main session token hashes are different", async () => {
  const { createHash } = await import("node:crypto");
  const secret = process.env.SESSION_SECRET!;
  // Same token value, hashed as main-session vs extension-session.
  const tokenValue = "deadbeef";
  const mainHash = createHash("sha256").update(tokenValue + secret).digest("hex");
  const extHash = _hashExtensionTokenForTests(tokenValue);
  assert(mainHash !== extHash, "hashes differ — extension cookie can't masquerade as main");
  assert(EXTENSION_COOKIE_NAME === "stockpilot_extension_session", "dedicated cookie name");
});

scenario("Extension hash deterministic (round-trip)", () => {
  const a = _hashExtensionTokenForTests("some-token");
  const b = _hashExtensionTokenForTests("some-token");
  assert(a === b, "same token → same hash");
  assert(a !== _hashExtensionTokenForTests("other-token"), "different token → different hash");
});

// ── Popup helpers (popup-helpers.js) ────────────────────────────────

scenario("normaliseUrl strips path, trailing slash, adds scheme", () => {
  assert(normaliseUrl("example.com") === "https://example.com", "bare host → https");
  assert(normaliseUrl("https://x.com/foo/bar") === "https://x.com", "path dropped");
  assert(normaliseUrl("https://x.com/") === "https://x.com", "trailing / dropped");
  assert(normaliseUrl("http://localhost:3000") === "http://localhost:3000", "http preserved");
  assert(normaliseUrl("  HTTPS://CAPS.COM  ") === "https://caps.com", "trim + lowercase host");
  assert(normaliseUrl("") === null, "empty → null");
  assert(normaliseUrl("https://") === null, "hostless → null");
  assert(normaliseUrl("not a url at all") === null, "gibberish → null (URL parses to weird hostname)" );
});

scenario("hostFromSupplierWebsite handles every shape users enter", () => {
  assert(hostFromSupplierWebsite("amazon.com") === "amazon.com", "bare domain");
  assert(hostFromSupplierWebsite("www.amazon.com") === "amazon.com", "www stripped");
  assert(
    hostFromSupplierWebsite("https://www.amazon.com/ref=nav") === "amazon.com",
    "full URL with path → bare host (BUG FIX from v0.1)"
  );
  assert(hostFromSupplierWebsite("HTTPS://AMAZON.CA/") === "amazon.ca", "uppercase → lowercase");
  assert(hostFromSupplierWebsite("") === null, "empty → null");
  assert(hostFromSupplierWebsite(null as unknown as string) === null, "null → null");
  assert(
    hostFromSupplierWebsite("just words with / slashes") === "just words with",
    "gibberish falls through to string munge"
  );
});

scenario("etld1FromHost yields last two labels", () => {
  assert(etld1FromHost("www.amazon.com") === "amazon.com", "3 labels → 2");
  assert(etld1FromHost("a.b.c.d.co") === "d.co", "deep subdomain → last two");
  assert(etld1FromHost("amazon.com") === "amazon.com", "2 labels unchanged");
  assert(etld1FromHost("localhost") === "localhost", "single label unchanged");
  assert(etld1FromHost("") === "", "empty stays empty");
});

scenario("isUsableTabUrl filters out non-web tabs", () => {
  assert(isUsableTabUrl("https://amazon.com") === true, "https allowed");
  assert(isUsableTabUrl("http://localhost") === true, "http allowed");
  assert(isUsableTabUrl("chrome://extensions") === false, "chrome:// refused");
  assert(isUsableTabUrl("chrome-extension://abc") === false, "extension origin refused");
  assert(isUsableTabUrl("about:blank") === false, "about: refused");
  assert(isUsableTabUrl("file:///c/foo") === false, "file:// refused");
  assert(isUsableTabUrl("") === false, "empty refused");
});

scenario("originPatternForUrl produces a manifest-style pattern", () => {
  assert(
    originPatternForUrl("https://www.amazon.com/foo") === "https://*.amazon.com/*",
    "www-stripped host, subdomain wildcard"
  );
  assert(
    originPatternForUrl("https://costco.ca/path") === "https://*.costco.ca/*",
    "bare hostname"
  );
  assert(
    originPatternForUrl("not a url") === "*://*/*",
    "fallback to widest pattern on parse failure (safe: the manifest itself is the real gate)"
  );
});

scenario("hostFromUrl lowercases hostname", () => {
  assert(hostFromUrl("https://AMAZON.COM/x") === "amazon.com", "uppercase input");
  assert(hostFromUrl("") === "", "empty → empty string, not null");
  assert(hostFromUrl("garbage") === "", "unparseable → empty string");
});

scenario("chromeToSerializable normalises Chrome cookie shape", () => {
  const out = chromeToSerializable({
    name: "session",
    value: "abc",
    domain: ".amazon.com",
    path: "/",
    expirationDate: 1234567890.5,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
  });
  assert(out.name === "session", "name preserved");
  assert(out.expires === 1234567890, "expirationDate → expires, floored");
  assert(out.sameSite === "Lax", "lax → Lax");
  assert(out.httpOnly === true, "httpOnly preserved");
});

scenario("chromeToSerializable drops unknown sameSite values", () => {
  const out = chromeToSerializable({
    name: "x",
    value: "y",
    sameSite: "no_restriction",
  });
  assert(out.sameSite === undefined, "no_restriction → undefined (server will set SameSite=None appropriately)");
});

scenario("pickMatchingSupplier auto-selects the right supplier", () => {
  const suppliers = [
    { id: "s1", name: "Amazon", website: "https://www.amazon.com/store" },
    { id: "s2", name: "Costco", website: "costco.ca" },
    { id: "s3", name: "No site", website: null },
  ];
  assert(pickMatchingSupplier(suppliers, "www.amazon.com") === "s1", "www host matches bare");
  assert(pickMatchingSupplier(suppliers, "smile.amazon.com") === "s1", "subdomain matches");
  assert(pickMatchingSupplier(suppliers, "costco.ca") === "s2", "bare domain matches");
  assert(pickMatchingSupplier(suppliers, "shop.costco.ca") === "s2", "subdomain of bare matches");
  assert(pickMatchingSupplier(suppliers, "walmart.com") === null, "non-match → null");
  assert(pickMatchingSupplier(suppliers, "") === null, "empty host → null");
  assert(pickMatchingSupplier([], "amazon.com") === null, "no suppliers → null");
});

scenario("pickMatchingSupplier BUG FIX: full URL as supplier.website still matches", () => {
  // This is the v0.1 bug: the popup did stripWww on the raw string,
  // so "https://www.amazon.com/path" became "https://amazon.com/path"
  // and never matched a tab on amazon.com.
  const suppliers = [{ id: "s1", name: "Amazon", website: "https://www.amazon.com/ref=nav_bb" }];
  assert(pickMatchingSupplier(suppliers, "amazon.com") === "s1", "full-URL supplier matches bare host");
  assert(
    pickMatchingSupplier(suppliers, "www.amazon.com") === "s1",
    "full-URL supplier matches www host"
  );
});

// ── Built extension zip ─────────────────────────────────────────────

await scenario("Extension zip exists and includes every file popup.html needs", async () => {
  const zipPath = resolve(
    import.meta.dirname!,
    "..",
    "public",
    "downloads",
    "stockpilot-extension.zip"
  );
  if (!existsSync(zipPath)) {
    console.log("    (zip not present, running build:extension to produce it)");
    const { execSync } = await import("node:child_process");
    execSync("node browser-extension/scripts/build-zip.mjs", {
      cwd: resolve(import.meta.dirname!, ".."),
      stdio: "inherit",
    });
  }
  assert(existsSync(zipPath), "zip file present");
  const zipBytes = readFileSync(zipPath);
  assert(zipBytes.length > 1000, "zip is non-trivial size");
  assert(
    zipBytes[0] === 0x50 && zipBytes[1] === 0x4b && zipBytes[2] === 0x03 && zipBytes[3] === 0x04,
    "starts with PK zip signature"
  );
  const haystack = zipBytes.toString("binary");
  for (const needle of [
    "manifest.json",
    "popup.html",
    "popup.css",
    "popup.js",
    "popup-helpers.js",
    "icons/icon16.png",
    "icons/icon48.png",
    "icons/icon128.png",
    "README.md",
  ]) {
    assert(haystack.includes(needle), `zip contains ${needle}`);
  }
});

// ── Report ──────────────────────────────────────────────────────────

console.log(
  `\n━━ Done. Passed: ${passed}, failed: ${failed}${failed > 0 ? "\nFailures:\n  - " + failures.join("\n  - ") : ""}`
);
if (failed > 0) process.exit(1);
