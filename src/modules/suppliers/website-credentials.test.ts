import test from "node:test";
import assert from "node:assert/strict";

// Required before importing the module — credential-encryption's
// deriveKey() throws without this.
process.env.N8N_WEBHOOK_SECRET ||= "test-secret-for-website-credentials";

import {
  decryptSupplierCredentials,
  encryptSupplierCredentials,
  parseCookieJson,
  summariseStoredCredentials,
  type SupplierWebsiteCookie,
} from "./website-credentials";
import { encryptCredential } from "../../lib/credential-encryption";

// ── encryptSupplierCredentials — password kind ──────────────────────

test("password: round-trips username + password exactly", () => {
  const enc = encryptSupplierCredentials({
    kind: "password",
    username: "buyer@cafe.com",
    password: "hunter2!",
  });
  const decoded = decryptSupplierCredentials(enc);
  assert.equal(decoded?.kind, "password");
  assert.equal(decoded?.kind === "password" && decoded.username, "buyer@cafe.com");
  assert.equal(decoded?.kind === "password" && decoded.password, "hunter2!");
});

test("password: trims surrounding whitespace from username", () => {
  const enc = encryptSupplierCredentials({
    kind: "password",
    username: "   buyer@cafe.com   ",
    password: "hunter2!",
  });
  const decoded = decryptSupplierCredentials(enc);
  assert.equal(decoded?.kind === "password" && decoded.username, "buyer@cafe.com");
});

test("password: does NOT trim password (spaces may be intentional)", () => {
  const enc = encryptSupplierCredentials({
    kind: "password",
    username: "u",
    password: "  has spaces  ",
  });
  const decoded = decryptSupplierCredentials(enc);
  assert.equal(decoded?.kind === "password" && decoded.password, "  has spaces  ");
});

test("password: throws on empty username (after trim)", () => {
  assert.throws(
    () =>
      encryptSupplierCredentials({
        kind: "password",
        username: "   ",
        password: "x",
      }),
    /Username is required/
  );
});

test("password: throws on empty password", () => {
  assert.throws(
    () =>
      encryptSupplierCredentials({
        kind: "password",
        username: "u",
        password: "",
      }),
    /Password is required/
  );
});

test("password: preserves loginUrl when provided (trimmed)", () => {
  const enc = encryptSupplierCredentials({
    kind: "password",
    username: "u",
    password: "p",
    loginUrl: "  https://supplier.example/login  ",
  });
  const decoded = decryptSupplierCredentials(enc);
  assert.equal(
    decoded?.kind === "password" && decoded.loginUrl,
    "https://supplier.example/login"
  );
});

test("password: drops loginUrl when empty/whitespace-only", () => {
  const enc = encryptSupplierCredentials({
    kind: "password",
    username: "u",
    password: "p",
    loginUrl: "   ",
  });
  const decoded = decryptSupplierCredentials(enc);
  assert.equal(
    decoded?.kind === "password" && "loginUrl" in decoded,
    false
  );
});

// ── encryptSupplierCredentials — cookies kind ───────────────────────

test("cookies: throws on non-array cookies", () => {
  assert.throws(
    () =>
      encryptSupplierCredentials({
        kind: "cookies",
        cookies: "not-an-array" as unknown as SupplierWebsiteCookie[],
      }),
    /At least one cookie is required/
  );
});

test("cookies: throws on empty cookies array", () => {
  assert.throws(
    () => encryptSupplierCredentials({ kind: "cookies", cookies: [] }),
    /At least one cookie is required/
  );
});

test("cookies: throws on cookie missing name", () => {
  assert.throws(
    () =>
      encryptSupplierCredentials({
        kind: "cookies",
        cookies: [{ name: "", value: "v" } as SupplierWebsiteCookie],
      }),
    /name and a string value/
  );
});

test("cookies: throws on cookie missing value", () => {
  assert.throws(
    () =>
      encryptSupplierCredentials({
        kind: "cookies",
        cookies: [{ name: "a" } as SupplierWebsiteCookie],
      }),
    /name and a string value/
  );
});

test("cookies: round-trips a minimal cookie (name + value only)", () => {
  const enc = encryptSupplierCredentials({
    kind: "cookies",
    cookies: [{ name: "sid", value: "abc" }],
  });
  const decoded = decryptSupplierCredentials(enc);
  assert.equal(decoded?.kind, "cookies");
  if (decoded?.kind !== "cookies") throw new Error();
  assert.equal(decoded.cookies.length, 1);
  assert.equal(decoded.cookies[0].name, "sid");
  assert.equal(decoded.cookies[0].value, "abc");
  // Optional fields should NOT materialise as undefined keys.
  assert.equal("domain" in decoded.cookies[0], false);
});

test("cookies: round-trips all optional fields", () => {
  const full: SupplierWebsiteCookie = {
    name: "session",
    value: "xyz",
    domain: ".amazon.com",
    path: "/",
    expires: 1800000000,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  };
  const enc = encryptSupplierCredentials({ kind: "cookies", cookies: [full] });
  const decoded = decryptSupplierCredentials(enc);
  if (decoded?.kind !== "cookies") throw new Error();
  assert.deepEqual(decoded.cookies[0], full);
});

test("cookies: encryption is non-deterministic (new IV each call)", () => {
  const input = {
    kind: "cookies" as const,
    cookies: [{ name: "a", value: "b" }],
  };
  const enc1 = encryptSupplierCredentials(input);
  const enc2 = encryptSupplierCredentials(input);
  assert.notEqual(enc1, enc2);
  // But both decode to the same plaintext.
  assert.deepEqual(
    decryptSupplierCredentials(enc1),
    decryptSupplierCredentials(enc2)
  );
});

test("unknown kind throws with the kind echoed in the error", () => {
  assert.throws(
    () =>
      encryptSupplierCredentials({
        kind: "magic",
      } as unknown as Parameters<typeof encryptSupplierCredentials>[0]),
    /Unknown credential kind: magic/
  );
});

// ── decryptSupplierCredentials ─────────────────────────────────────

test("decrypt: returns null for null / undefined / empty string", () => {
  assert.equal(decryptSupplierCredentials(null), null);
  assert.equal(decryptSupplierCredentials(undefined), null);
  assert.equal(decryptSupplierCredentials(""), null);
});

test("decrypt: returns null for undecryptable garbage", () => {
  assert.equal(decryptSupplierCredentials("enc:v1:bad:bad:bad"), null);
});

test("decrypt: returns null for non-JSON plaintext", () => {
  const enc = encryptCredential("not-json-at-all");
  assert.equal(decryptSupplierCredentials(enc), null);
});

test("decrypt: returns null for password blob missing username", () => {
  const enc = encryptCredential(JSON.stringify({ kind: "password", password: "p" }));
  assert.equal(decryptSupplierCredentials(enc), null);
});

test("decrypt: returns null for password blob missing password", () => {
  const enc = encryptCredential(JSON.stringify({ kind: "password", username: "u" }));
  assert.equal(decryptSupplierCredentials(enc), null);
});

test("decrypt: returns null for cookies blob with empty array", () => {
  const enc = encryptCredential(JSON.stringify({ kind: "cookies", cookies: [] }));
  assert.equal(decryptSupplierCredentials(enc), null);
});

test("decrypt: returns null for cookies blob where cookies is not an array", () => {
  const enc = encryptCredential(JSON.stringify({ kind: "cookies", cookies: "oops" }));
  assert.equal(decryptSupplierCredentials(enc), null);
});

test("decrypt: returns null for unknown kind", () => {
  const enc = encryptCredential(JSON.stringify({ kind: "totally-new-thing" }));
  assert.equal(decryptSupplierCredentials(enc), null);
});

// ── summariseStoredCredentials ──────────────────────────────────────

test("summary: null/undefined/empty → kind none", () => {
  assert.deepEqual(summariseStoredCredentials(null), { kind: "none" });
  assert.deepEqual(summariseStoredCredentials(undefined), { kind: "none" });
  assert.deepEqual(summariseStoredCredentials(""), { kind: "none" });
});

test("summary: unencrypted plain JSON → kind none (never expose plaintext)", () => {
  // A pre-encryption blob sitting in the DB column must NOT leak.
  const plain = JSON.stringify({ kind: "password", username: "u", password: "p" });
  assert.deepEqual(summariseStoredCredentials(plain), { kind: "none" });
});

test("summary: encrypted password → returns username only", () => {
  const enc = encryptSupplierCredentials({
    kind: "password",
    username: "buyer@cafe.com",
    password: "hunter2!",
  });
  const summary = summariseStoredCredentials(enc);
  assert.equal(summary.kind, "password");
  assert.equal(summary.kind === "password" && summary.username, "buyer@cafe.com");
  // Password must never appear in the summary shape.
  assert.equal("password" in summary, false);
});

test("summary: encrypted cookies → count + primary domain (leading dot stripped)", () => {
  const enc = encryptSupplierCredentials({
    kind: "cookies",
    cookies: [
      { name: "a", value: "1", domain: ".amazon.com" },
      { name: "b", value: "2", domain: ".amazon.com" },
    ],
  });
  const summary = summariseStoredCredentials(enc);
  assert.equal(summary.kind, "cookies");
  if (summary.kind !== "cookies") throw new Error();
  assert.equal(summary.cookieCount, 2);
  assert.equal(summary.primaryDomain, "amazon.com");
});

test("summary: cookies without any domain → primaryDomain is null", () => {
  const enc = encryptSupplierCredentials({
    kind: "cookies",
    cookies: [{ name: "a", value: "1" }],
  });
  const summary = summariseStoredCredentials(enc);
  assert.equal(summary.kind, "cookies");
  if (summary.kind !== "cookies") throw new Error();
  assert.equal(summary.cookieCount, 1);
  assert.equal(summary.primaryDomain, null);
});

test("summary: picks the first cookie that has a domain", () => {
  const enc = encryptSupplierCredentials({
    kind: "cookies",
    cookies: [
      { name: "a", value: "1" },
      { name: "b", value: "2", domain: "costco.ca" },
      { name: "c", value: "3", domain: "other.example" },
    ],
  });
  const summary = summariseStoredCredentials(enc);
  if (summary.kind !== "cookies") throw new Error();
  assert.equal(summary.primaryDomain, "costco.ca");
});

test("summary: undecryptable blob → kind none", () => {
  assert.deepEqual(
    summariseStoredCredentials("enc:v1:deadbeef:deadbeef:deadbeef"),
    { kind: "none" }
  );
});

// ── parseCookieJson ────────────────────────────────────────────────

test("parseCookieJson: throws on empty string", () => {
  assert.throws(() => parseCookieJson(""), /Paste a cookie JSON export/);
  assert.throws(() => parseCookieJson("   "), /Paste a cookie JSON export/);
});

test("parseCookieJson: throws on non-JSON input", () => {
  assert.throws(() => parseCookieJson("not json at all"), /doesn't look like JSON/);
});

test("parseCookieJson: throws when nothing array-shaped found", () => {
  assert.throws(() => parseCookieJson("42"), /No cookies found/);
  assert.throws(() => parseCookieJson('"a string"'), /No cookies found/);
  assert.throws(() => parseCookieJson("null"), /No cookies found/);
  assert.throws(() => parseCookieJson("[]"), /No cookies found/);
});

test("parseCookieJson: throws when array entries are all malformed", () => {
  assert.throws(
    () => parseCookieJson(JSON.stringify([{ not: "a cookie" }, null, 42])),
    /missing name or value/
  );
});

test("parseCookieJson: accepts a plain array", () => {
  const parsed = parseCookieJson(
    JSON.stringify([{ name: "a", value: "1" }, { name: "b", value: "2" }])
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, "a");
});

test("parseCookieJson: accepts {cookies: [...]} wrapper (Chrome DevTools shape)", () => {
  const parsed = parseCookieJson(
    JSON.stringify({ cookies: [{ name: "a", value: "1" }] })
  );
  assert.equal(parsed.length, 1);
});

test("parseCookieJson: skips entries without name or value, keeps siblings", () => {
  const parsed = parseCookieJson(
    JSON.stringify([
      { name: "ok", value: "1" },
      { value: "no-name" },
      { name: "no-value" },
    ])
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "ok");
});

test("parseCookieJson: aliases expirationDate → expires with Math.floor", () => {
  const parsed = parseCookieJson(
    JSON.stringify([{ name: "a", value: "v", expirationDate: 1700000000.8 }])
  );
  assert.equal(parsed[0].expires, 1700000000);
});

test("parseCookieJson: preserves explicit expires when present without expirationDate", () => {
  const parsed = parseCookieJson(
    JSON.stringify([{ name: "a", value: "v", expires: 1700000000 }])
  );
  assert.equal(parsed[0].expires, 1700000000);
});

test("parseCookieJson: only keeps valid sameSite values", () => {
  const parsed = parseCookieJson(
    JSON.stringify([
      { name: "a", value: "v", sameSite: "Lax" },
      { name: "b", value: "v", sameSite: "lax" },
      { name: "c", value: "v", sameSite: "unset" },
    ])
  );
  assert.equal(parsed[0].sameSite, "Lax");
  assert.equal(parsed[1].sameSite, undefined);
  assert.equal(parsed[2].sameSite, undefined);
});

test("parseCookieJson: preserves boolean httpOnly and secure; drops non-booleans", () => {
  const parsed = parseCookieJson(
    JSON.stringify([
      { name: "a", value: "v", httpOnly: true, secure: false },
      { name: "b", value: "v", httpOnly: "yes", secure: 1 },
    ])
  );
  assert.equal(parsed[0].httpOnly, true);
  assert.equal(parsed[0].secure, false);
  assert.equal(parsed[1].httpOnly, undefined);
  assert.equal(parsed[1].secure, undefined);
});

test("parseCookieJson: preserves domain and path when string", () => {
  const parsed = parseCookieJson(
    JSON.stringify([
      { name: "a", value: "v", domain: ".amazon.com", path: "/cart" },
    ])
  );
  assert.equal(parsed[0].domain, ".amazon.com");
  assert.equal(parsed[0].path, "/cart");
});

test("parseCookieJson output feeds encryptSupplierCredentials cleanly (integration)", () => {
  // The realistic flow: user pastes JSON → parsed → encrypted → stored.
  const parsed = parseCookieJson(
    JSON.stringify({
      cookies: [
        {
          name: "session-id",
          value: "131-1234567",
          domain: ".amazon.com",
          path: "/",
          expirationDate: 1800000000.4,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ],
    })
  );
  const enc = encryptSupplierCredentials({ kind: "cookies", cookies: parsed });
  const decoded = decryptSupplierCredentials(enc);
  if (decoded?.kind !== "cookies") throw new Error();
  assert.equal(decoded.cookies[0].name, "session-id");
  assert.equal(decoded.cookies[0].expires, 1800000000);
  assert.equal(decoded.cookies[0].sameSite, "Lax");
});
