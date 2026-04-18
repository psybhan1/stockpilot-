import test from "node:test";
import assert from "node:assert/strict";

import {
  pairingReplyText,
  readLocationPairingCode,
} from "./channel-auth";

// ─── readLocationPairingCode ───────────────────────────────────────────────

test("readLocationPairingCode: valid code → upper-case", () => {
  assert.equal(readLocationPairingCode("SB-AB1234"), "SB-AB1234");
  assert.equal(readLocationPairingCode("sb-ab1234"), "SB-AB1234");
  assert.equal(readLocationPairingCode("  SB-AB1234  "), "SB-AB1234");
});

test("readLocationPairingCode: bad shape → null", () => {
  assert.equal(readLocationPairingCode("SB-12345"), null); // 5 chars instead of 6
  assert.equal(readLocationPairingCode("SBAB1234"), null); // missing hyphen
  assert.equal(readLocationPairingCode("SB-AB12#4"), null); // invalid character
  assert.equal(readLocationPairingCode(""), null);
  assert.equal(readLocationPairingCode("hello"), null);
  // A whole-message match — "SB-AB1234 please" won't match because the
  // regex is anchored, which is what we want (the code is the only thing
  // in the message, by convention).
  assert.equal(readLocationPairingCode("SB-AB1234 please"), null);
});

// ─── pairingReplyText ──────────────────────────────────────────────────────

test("pairingReplyText: success mentions channel + location", () => {
  const reply = pairingReplyText(
    { ok: true, locationName: "Dreamy Cafe" },
    "Telegram",
  );
  assert.match(reply, /Dreamy Cafe/);
  assert.match(reply, /Telegram/);
  assert.match(reply, /✅/);
});

test("pairingReplyText: expired reason → ⏱ prompt", () => {
  const reply = pairingReplyText(
    { ok: false, reason: "Code expired" },
    "WhatsApp",
  );
  assert.match(reply, /⏱/);
  assert.match(reply, /WhatsApp/);
  assert.match(reply, /expired/i);
});

test("pairingReplyText: other failure → ❌ prompt", () => {
  const reply = pairingReplyText(
    { ok: false, reason: "Code not found" },
    "WhatsApp",
  );
  assert.match(reply, /❌/);
  assert.match(reply, /WhatsApp/);
});
