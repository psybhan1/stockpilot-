// Tests the website-credential storage flow end-to-end:
//   - encrypt → decrypt roundtrip preserves both kinds (password / cookies)
//   - parser handles the two common cookie-export formats
//   - bad input throws friendly errors
//   - DB roundtrip (write encrypted ciphertext → read → decrypt → matches)
//   - browser agent receives decrypted credentials
//   - safe summary never leaks secret material
//
// Encryption key is derived from N8N_WEBHOOK_SECRET so we set a stub
// before importing the credential module.

process.env.N8N_WEBHOOK_SECRET =
  process.env.N8N_WEBHOOK_SECRET ?? "test-webhook-secret-for-credential-suite";

import { PrismaClient } from "../src/generated/prisma-postgres/client.js";

// Dynamic imports — tsx handles `@/...` aliases inside .ts files but
// the static-import-with-.ts-extension form trips its ESM resolver
// when the loaded file imports more aliased modules.
const { encryptSupplierCredentials, decryptSupplierCredentials, parseCookieJson, summariseStoredCredentials } =
  await import("../src/modules/suppliers/website-credentials.ts");
const { isEncrypted } = await import("../src/lib/credential-encryption.ts");

const db = new PrismaClient();

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

async function runScenario(name: string, fn: () => Promise<void> | void) {
  console.log(`\n━━ ${name}`);
  try {
    await fn();
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`    ❌ THREW: ${msg}`);
  }
}

async function findOrCreateLocation() {
  const loc = await db.location.findFirst({ select: { id: true } });
  if (loc) return loc;
  const business = await db.business.create({
    data: { name: "Cred Test Cafe", slug: `cred-${Date.now()}` },
  });
  return db.location.create({
    data: { businessId: business.id, name: "Cred Test", timezone: "America/Toronto" },
    select: { id: true },
  });
}

const stamp = Date.now().toString(36);
const loc = await findOrCreateLocation();
const cleanup = async () => {
  await db.supplier.deleteMany({
    where: { locationId: loc.id, name: { contains: stamp } },
  });
};
await cleanup();

// ── Pure-function tests ─────────────────────────────────────────────
await runScenario("Password creds: encrypt → decrypt roundtrip", () => {
  const enc = encryptSupplierCredentials({
    kind: "password",
    username: "ops@cafe.example",
    password: "s3cret!shop",
    loginUrl: "https://amazon.com/ap/signin",
  });
  assert(isEncrypted(enc), "ciphertext is in our encrypted format");
  assert(!enc.includes("s3cret!shop"), "plaintext password not in ciphertext");
  assert(!enc.includes("ops@cafe.example"), "plaintext username not in ciphertext");

  const dec = decryptSupplierCredentials(enc);
  if (!dec || dec.kind !== "password") throw new Error("expected password kind");
  assert(dec.username === "ops@cafe.example", "username preserved");
  assert(dec.password === "s3cret!shop", "password preserved");
  assert(dec.loginUrl === "https://amazon.com/ap/signin", "loginUrl preserved");
});

await runScenario("Cookie creds: encrypt → decrypt roundtrip preserves all fields", () => {
  const enc = encryptSupplierCredentials({
    kind: "cookies",
    cookies: [
      {
        name: "session-token",
        value: "abc-123-DEF",
        domain: ".amazon.com",
        path: "/",
        expires: 1234567890,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
      { name: "ubid-main", value: "111-222-333" },
    ],
  });
  assert(isEncrypted(enc), "ciphertext is in encrypted format");
  assert(!enc.includes("abc-123-DEF"), "cookie value not in ciphertext");

  const dec = decryptSupplierCredentials(enc);
  if (!dec || dec.kind !== "cookies") throw new Error("expected cookies kind");
  assert(dec.cookies.length === 2, `2 cookies preserved (got ${dec.cookies.length})`);
  assert(dec.cookies[0].name === "session-token", "first cookie name");
  assert(dec.cookies[0].domain === ".amazon.com", "first cookie domain");
  assert(dec.cookies[0].sameSite === "Lax", "first cookie sameSite");
  assert(dec.cookies[1].name === "ubid-main", "second cookie name");
});

await runScenario("Encrypt rejects empty username / password / cookies", () => {
  let threw = false;
  try {
    encryptSupplierCredentials({ kind: "password", username: "", password: "x" });
  } catch {
    threw = true;
  }
  assert(threw, "empty username throws");

  threw = false;
  try {
    encryptSupplierCredentials({ kind: "password", username: "x", password: "" });
  } catch {
    threw = true;
  }
  assert(threw, "empty password throws");

  threw = false;
  try {
    encryptSupplierCredentials({ kind: "cookies", cookies: [] });
  } catch {
    threw = true;
  }
  assert(threw, "empty cookies array throws");
});

await runScenario("Decrypt returns null for unreadable / null inputs", () => {
  assert(decryptSupplierCredentials(null) === null, "null → null");
  assert(decryptSupplierCredentials("") === null, "empty → null");
  assert(decryptSupplierCredentials("garbage") === null, "garbage → null (not throw)");
  assert(
    decryptSupplierCredentials("enc:v1:xx:yy:zz") === null,
    "malformed ciphertext → null"
  );
});

await runScenario("parseCookieJson handles plain array format", () => {
  const json = JSON.stringify([
    { name: "a", value: "1", domain: ".example.com" },
    { name: "b", value: "2" },
  ]);
  const cookies = parseCookieJson(json);
  assert(cookies.length === 2, "got 2 cookies");
  assert(cookies[0].name === "a" && cookies[0].value === "1", "first cookie shape");
});

await runScenario("parseCookieJson handles { cookies: [...] } format", () => {
  const json = JSON.stringify({
    cookies: [{ name: "x", value: "y", domain: ".example.com" }],
  });
  const cookies = parseCookieJson(json);
  assert(cookies.length === 1, "got 1 cookie from object form");
});

await runScenario("parseCookieJson normalises Cookie-Editor expirationDate → expires", () => {
  // Cookie-Editor extension exports use `expirationDate` (Chrome
  // DevTools format) instead of `expires`. The parser should map it.
  const json = JSON.stringify([
    { name: "session", value: "x", domain: ".amazon.com", expirationDate: 1735689600.5 },
  ]);
  const cookies = parseCookieJson(json);
  assert(cookies[0].expires === 1735689600, "expirationDate floored to expires");
});

await runScenario("parseCookieJson rejects bad input with friendly errors", () => {
  let threw = false;
  try {
    parseCookieJson("");
  } catch (err) {
    threw = err instanceof Error && /paste/i.test(err.message);
  }
  assert(threw, "empty input → 'paste' error message");

  threw = false;
  try {
    parseCookieJson("not json");
  } catch (err) {
    threw = err instanceof Error && /JSON/i.test(err.message);
  }
  assert(threw, "non-JSON → friendly JSON error");

  threw = false;
  try {
    parseCookieJson("[]");
  } catch (err) {
    threw = err instanceof Error && /no cookies/i.test(err.message);
  }
  assert(threw, "empty array → 'no cookies' error");

  threw = false;
  try {
    parseCookieJson(JSON.stringify([{ wrong: "shape" }]));
  } catch (err) {
    threw = err instanceof Error && /name|value/i.test(err.message);
  }
  assert(threw, "missing name/value → friendly error");
});

await runScenario("summariseStoredCredentials never leaks secrets", () => {
  const passwordEnc = encryptSupplierCredentials({
    kind: "password",
    username: "shopper@cafe.example",
    password: "topsecret",
  });
  const summary = summariseStoredCredentials(passwordEnc);
  assert(summary.kind === "password", "password kind reported");
  if (summary.kind === "password") {
    assert(summary.username === "shopper@cafe.example", "username surfaced (UI display)");
    assert(
      !JSON.stringify(summary).includes("topsecret"),
      "password NOT in summary"
    );
  }

  const cookieEnc = encryptSupplierCredentials({
    kind: "cookies",
    cookies: [
      { name: "tok", value: "supersecretvalue", domain: ".costco.com" },
      { name: "csrf", value: "alsosecret" },
    ],
  });
  const cSummary = summariseStoredCredentials(cookieEnc);
  if (cSummary.kind !== "cookies") throw new Error("expected cookies summary");
  assert(cSummary.cookieCount === 2, "cookie count surfaced");
  assert(cSummary.primaryDomain === "costco.com", "primary domain surfaced");
  assert(
    !JSON.stringify(cSummary).includes("supersecretvalue"),
    "cookie value NOT in summary"
  );

  assert(summariseStoredCredentials(null).kind === "none", "null → kind=none");
  assert(summariseStoredCredentials("").kind === "none", "empty → kind=none");
  assert(
    summariseStoredCredentials("not encrypted").kind === "none",
    "unencrypted → kind=none (UI shows reconnect)"
  );
});

// ── DB integration ──────────────────────────────────────────────────
await runScenario("DB roundtrip: write encrypted, read, decrypt, matches", async () => {
  const supplier = await db.supplier.create({
    data: {
      locationId: loc.id,
      name: `Cred-Test-Supplier ${stamp}`,
      orderingMode: "WEBSITE",
      website: "https://www.amazon.com",
      leadTimeDays: 2,
      websiteCredentials: encryptSupplierCredentials({
        kind: "cookies",
        cookies: [
          { name: "session-token", value: "abc123", domain: ".amazon.com", secure: true },
        ],
      }),
      credentialsConfigured: true,
    },
  });

  const fetched = await db.supplier.findUnique({
    where: { id: supplier.id },
    select: { websiteCredentials: true, credentialsConfigured: true },
  });
  assert(fetched?.credentialsConfigured === true, "credentialsConfigured flag set");
  assert(isEncrypted(fetched?.websiteCredentials ?? ""), "stored value is encrypted");

  const decoded = decryptSupplierCredentials(fetched?.websiteCredentials);
  if (!decoded || decoded.kind !== "cookies") throw new Error("expected cookies after DB read");
  assert(decoded.cookies[0].value === "abc123", "cookie value preserved through DB");
});

await runScenario("DB roundtrip with password creds + supplier lookup pattern from agent", async () => {
  const supplier = await db.supplier.create({
    data: {
      locationId: loc.id,
      name: `Cred-Pwd-Supplier ${stamp}`,
      orderingMode: "WEBSITE",
      website: "https://www.costco.com",
      leadTimeDays: 3,
      websiteCredentials: encryptSupplierCredentials({
        kind: "password",
        username: "ops@cafe.example",
        password: "Pa55w0rd!",
      }),
      credentialsConfigured: true,
    },
  });

  // Replicate the exact SELECT shape browser-agent uses
  // (findUniqueOrThrow with full include).
  const fetched = await db.supplier.findUniqueOrThrow({
    where: { id: supplier.id },
  });
  const decoded = decryptSupplierCredentials(fetched.websiteCredentials);
  if (!decoded || decoded.kind !== "password") throw new Error("expected password kind");
  assert(decoded.username === "ops@cafe.example", "username preserved");
  assert(decoded.password === "Pa55w0rd!", "password preserved");
});

// ── Cleanup ─────────────────────────────────────────────────────────
await cleanup();

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  await db.$disconnect();
  process.exit(1);
}
console.log("\n🎉 ALL CREDENTIAL TESTS PASSED");
await db.$disconnect();
