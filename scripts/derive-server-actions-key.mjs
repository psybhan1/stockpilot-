#!/usr/bin/env node
// Derives a stable NEXT_SERVER_ACTIONS_ENCRYPTION_KEY for the build.
//
// Why: Next.js 16 encrypts server-action closure vars. Each `next
// build` generates a fresh key by default, which means action IDs
// embedded in already-rendered HTML become invalid after a deploy
// (and logged-in users see "Server action not found" / 503 on form
// submit until they hard-reload). The docs recommend setting
// NEXT_SERVER_ACTIONS_ENCRYPTION_KEY explicitly so it's stable
// across builds and multi-instance deploys.
//
// This script writes the key to .env.production.local right before
// `next build` runs. Next.js auto-loads that file at build time, so
// the key ends up baked into the build output.
//
// Precedence:
//   1. If NEXT_SERVER_ACTIONS_ENCRYPTION_KEY is already set
//      (explicitly configured on Railway/Vercel), we use that.
//   2. Otherwise we derive one deterministically from SESSION_SECRET
//      so the key is stable as long as SESSION_SECRET is stable.
//
// The key is a 32-byte (256-bit) AES key, base64 encoded.

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

function deriveKey() {
  const fromEnv = process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY;
  if (fromEnv && fromEnv.trim().length > 0) {
    return { key: fromEnv.trim(), source: "env-var" };
  }

  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 8) {
    // Domain-tag the derivation so it can't be accidentally reused
    // for another purpose — SESSION_SECRET itself never becomes the
    // encryption key verbatim.
    const hash = createHash("sha256");
    hash.update("stockpilot/next-server-actions-key/v1");
    hash.update(secret);
    return { key: hash.digest("base64"), source: "derived-from-SESSION_SECRET" };
  }

  // Last resort: random key. Warns the user because this is the
  // unstable case that causes the 503s in the first place. Builds
  // still work, but stale HTML will break on the next deploy.
  console.warn(
    "[derive-server-actions-key] SESSION_SECRET not set; falling back to a random key. Set SESSION_SECRET (or NEXT_SERVER_ACTIONS_ENCRYPTION_KEY) for stable action IDs across deploys."
  );
  return { key: randomBytes(32).toString("base64"), source: "random-fallback" };
}

const { key, source } = deriveKey();
const envPath = ".env.production.local";
const marker = "# Managed by scripts/derive-server-actions-key.mjs — do not edit by hand.";
const line = `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=${key}`;

let existing = "";
if (existsSync(envPath)) {
  existing = readFileSync(envPath, "utf8");
}

// Replace any existing NEXT_SERVER_ACTIONS_ENCRYPTION_KEY line, keep
// everything else the user / platform may have put in the file.
const stripped = existing
  .split(/\r?\n/)
  .filter(
    (l) =>
      !l.startsWith("NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=") && l.trim() !== marker
  )
  .join("\n")
  .replace(/\n+$/, "");

const body =
  (stripped ? `${stripped}\n` : "") + `${marker}\n${line}\n`;

writeFileSync(envPath, body, "utf8");
console.log(`[derive-server-actions-key] wrote ${envPath} (source: ${source})`);
