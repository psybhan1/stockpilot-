// Tests the StockPilot browser-extension surface:
//   - normaliseExtensionCookies handles well-formed, malformed, oversized
//     payloads without crashing and without leaking unvalidated data
//   - extension-cors helper allows only chrome-extension:// / moz-extension://
//     origins and refuses everything else (no wildcard, no web origins)
//   - the built extension zip (public/downloads/stockpilot-extension.zip) is
//     a valid zip with every file manifest/popup refer to
//
// These are unit-level tests — we don't stand up Next.js here because
// the session cookie + Prisma wiring is already covered by higher-level
// scripts. What this script *does* catch:
//   - a cookie payload that bypasses length/type validation
//   - an extension-cors regression that echoes arbitrary origins (big deal:
//     an attacker site could then read responses via credentials)
//   - a ship-blocking packaging bug (missing file in the zip)

process.env.N8N_WEBHOOK_SECRET =
  process.env.N8N_WEBHOOK_SECRET ?? "test-webhook-secret-for-extension-suite";

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const { normaliseExtensionCookies, MAX_COOKIES, MAX_VALUE_LENGTH } = await import(
  "../src/modules/suppliers/extension-cookies.ts"
);
const { extensionCorsHeaders, isExtensionOrigin } = await import(
  "../src/lib/extension-cors.ts"
);

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
    { name: 42, value: "v2" }, // bad name type
    { name: "", value: "v3" }, // empty name
    null, // not an object
    "string", // not an object
    { name: "good2", value: 99 }, // bad value type
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
    { name: "a", value: "b", sameSite: "unrestricted" }, // bogus
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

// ── Built extension zip ─────────────────────────────────────────────

await scenario("Extension zip exists and includes everything popup.html needs", async () => {
  const zipPath = resolve(
    import.meta.dirname!,
    "..",
    "public",
    "downloads",
    "stockpilot-extension.zip"
  );
  if (!existsSync(zipPath)) {
    // Run the build — this is what Railway does on deploy.
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
  // Crude check: every included filename appears in the bytes
  // somewhere (local file header stores the name as UTF-8).
  const haystack = zipBytes.toString("binary");
  for (const needle of [
    "manifest.json",
    "popup.html",
    "popup.css",
    "popup.js",
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
