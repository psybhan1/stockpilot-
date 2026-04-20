import test from "node:test";
import assert from "node:assert/strict";

import {
  getSuggestedTestRecipient,
  isExpoPushRecipient,
  isWhatsAppRecipient,
  normalizeExpoRecipient,
  normalizeWhatsAppRecipient,
  validateNotificationRecipient,
} from "./channels";

test("notifications: accepts Expo push tokens with optional expo prefix", () => {
  assert.equal(isExpoPushRecipient("ExponentPushToken[demo-token]"), true);
  assert.equal(isExpoPushRecipient("expo:ExpoPushToken[demo-token]"), true);
  assert.equal(normalizeExpoRecipient("expo:ExponentPushToken[demo-token]"), "ExponentPushToken[demo-token]");
});

test("notifications: normalizes and validates WhatsApp recipients", () => {
  assert.equal(normalizeWhatsAppRecipient("+14155550123"), "whatsapp:+14155550123");
  assert.equal(isWhatsAppRecipient("+14155550123"), true);
  assert.equal(isWhatsAppRecipient("555-0123"), false);
});

test("notifications: normalizeWhatsAppRecipient forces prefix lowercase", () => {
  // Twilio rejects "WhatsApp:+..." — must be lowercase. Regression
  // guard for the previous implementation which would emit
  // "whatsapp:WhatsApp:+1…" (double prefix) for mixed-case input.
  assert.equal(
    normalizeWhatsAppRecipient("WhatsApp:+14155550123"),
    "whatsapp:+14155550123"
  );
  assert.equal(
    normalizeWhatsAppRecipient("WHATSAPP:+14155550123"),
    "whatsapp:+14155550123"
  );
});

test("notifications: normalizeWhatsAppRecipient is idempotent", () => {
  const once = normalizeWhatsAppRecipient("WhatsApp:+14155550123");
  const twice = normalizeWhatsAppRecipient(once);
  assert.equal(once, twice);
  assert.equal(once, "whatsapp:+14155550123");
});

test("notifications: isWhatsAppRecipient accepts mixed-case prefix", () => {
  // Once normalization is case-insensitive, validation must be too,
  // otherwise stored values with capitalised prefixes would fail
  // validation even though they're routable.
  assert.equal(isWhatsAppRecipient("WhatsApp:+14155550123"), true);
  assert.equal(isWhatsAppRecipient("WHATSAPP:+14155550123"), true);
  assert.equal(isWhatsAppRecipient("whatsapp:+14155550123"), true);
});

test("notifications: validates test notification recipients by channel", () => {
  assert.equal(
    validateNotificationRecipient("EMAIL", "manager@stockpilot.dev"),
    null
  );
  assert.equal(
    validateNotificationRecipient("PUSH", "ExponentPushToken[device-token]"),
    null
  );
  assert.equal(
    validateNotificationRecipient("WHATSAPP", "+14155550123"),
    null
  );
  assert.match(
    validateNotificationRecipient("PUSH", "device://token") ?? "",
    /Expo push token/i
  );
});

test("notifications: suggests channel-specific test recipients", () => {
  assert.equal(
    getSuggestedTestRecipient({
      channel: "EMAIL",
      sessionEmail: "manager@stockpilot.dev",
      expoTestPushToken: "ExponentPushToken[device-token]",
      twilioTestWhatsappTo: "+14155550123",
    }),
    "manager@stockpilot.dev"
  );
  assert.equal(
    getSuggestedTestRecipient({
      channel: "PUSH",
      sessionEmail: "manager@stockpilot.dev",
      expoTestPushToken: "ExponentPushToken[device-token]",
      twilioTestWhatsappTo: "+14155550123",
    }),
    "ExponentPushToken[device-token]"
  );
});
