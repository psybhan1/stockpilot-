import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  buildTwimlEmptyResponse,
  buildTwimlMessageResponse,
  isValidTwilioWebhook,
} from "./twilio-webhook";

// ── Helper: compute what Twilio would sign for a given url+form ────

function twilioSign(authToken: string, url: string, form: Record<string, string>): string {
  const payload = `${url}${Object.keys(form)
    .sort()
    .map((k) => `${k}${form[k]}`)
    .join("")}`;
  return createHmac("sha1", authToken).update(payload).digest("base64");
}

function makeForm(fields: Record<string, string>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) p.append(k, v);
  return p;
}

// ── isValidTwilioWebhook: signature verification ───────────────────

test("no authToken configured → always valid (dev/local fast path)", () => {
  // When TWILIO_AUTH_TOKEN isn't set, webhook endpoints should still
  // function locally without signature gymnastics.
  assert.equal(
    isValidTwilioWebhook({
      signature: null,
      url: "https://stockpilot.app/api/twilio",
      formFields: makeForm({}),
    }),
    true,
  );
  assert.equal(
    isValidTwilioWebhook({
      authToken: "",
      signature: "bogus",
      url: "https://stockpilot.app/api/twilio",
      formFields: makeForm({ a: "1" }),
    }),
    true,
  );
});

test("authToken set + signature missing → reject (can't verify)", () => {
  assert.equal(
    isValidTwilioWebhook({
      authToken: "twilio-secret",
      signature: null,
      url: "https://stockpilot.app/api/twilio",
      formFields: makeForm({}),
    }),
    false,
  );
});

test("valid signature over (url + sorted form) → accept", () => {
  const authToken = "twilio-secret-abc123";
  const url = "https://stockpilot.app/api/twilio/sms";
  const form = { From: "+15551234567", Body: "hello", MessageSid: "SM1" };
  const sig = twilioSign(authToken, url, form);
  assert.equal(
    isValidTwilioWebhook({
      authToken,
      signature: sig,
      url,
      formFields: makeForm(form),
    }),
    true,
  );
});

test("single-bit change to the body rejects the signature (tamper detection)", () => {
  const authToken = "twilio-secret";
  const url = "https://stockpilot.app/api/twilio";
  const form = { From: "+15551234567", Body: "hello" };
  const sig = twilioSign(authToken, url, form);
  const tampered = { ...form, Body: "Hello" }; // case change only
  assert.equal(
    isValidTwilioWebhook({
      authToken,
      signature: sig,
      url,
      formFields: makeForm(tampered),
    }),
    false,
  );
});

test("URL mismatch rejects signature (defends against open relay)", () => {
  // An attacker replaying a Twilio-signed body against a different
  // endpoint (e.g. /admin instead of /webhook) must fail.
  const authToken = "twilio-secret";
  const form = { Body: "ok" };
  const sig = twilioSign(authToken, "https://stockpilot.app/webhook", form);
  assert.equal(
    isValidTwilioWebhook({
      authToken,
      signature: sig,
      url: "https://stockpilot.app/admin",
      formFields: makeForm(form),
    }),
    false,
  );
});

test("signature verification is insensitive to the order fields were appended", () => {
  // Twilio sorts params alphabetically before signing. If our
  // impl used insertion order we'd reject valid requests when
  // the originator appended fields out of order.
  const authToken = "twilio-secret";
  const url = "https://stockpilot.app/api/twilio";
  const form = { From: "A", To: "B", Body: "C" };
  const sig = twilioSign(authToken, url, form);
  // Feed in reverse-insertion order.
  const reverseForm = new URLSearchParams();
  reverseForm.append("To", "B");
  reverseForm.append("Body", "C");
  reverseForm.append("From", "A");
  assert.equal(
    isValidTwilioWebhook({ authToken, signature: sig, url, formFields: reverseForm }),
    true,
  );
});

test("wrong authToken rejects an otherwise-perfect signature", () => {
  const url = "https://stockpilot.app/api/twilio";
  const form = { Body: "hello" };
  const sigOK = twilioSign("real-secret", url, form);
  assert.equal(
    isValidTwilioWebhook({
      authToken: "different-secret",
      signature: sigOK,
      url,
      formFields: makeForm(form),
    }),
    false,
  );
});

test("empty-signature string still rejected (null + empty both treated as absent)", () => {
  assert.equal(
    isValidTwilioWebhook({
      authToken: "secret",
      signature: "",
      url: "https://stockpilot.app",
      formFields: makeForm({}),
    }),
    false,
  );
});

test("signature comparison is length-safe (short random string doesn't throw)", () => {
  // timingSafeEqual requires equal-length buffers — short inputs
  // must be rejected by the length guard, not throw.
  const call = () =>
    isValidTwilioWebhook({
      authToken: "secret",
      signature: "tiny",
      url: "https://stockpilot.app",
      formFields: makeForm({ a: "1" }),
    });
  assert.doesNotThrow(call);
  assert.equal(call(), false);
});

test("empty form body: signs url only (and verifies against it)", () => {
  const authToken = "secret";
  const url = "https://stockpilot.app/webhook";
  const sig = twilioSign(authToken, url, {});
  assert.equal(
    isValidTwilioWebhook({
      authToken,
      signature: sig,
      url,
      formFields: makeForm({}),
    }),
    true,
  );
});

// ── buildTwimlMessageResponse: valid XML + escaped content ─────────

test("TwiML message response wraps text in <Response><Message>...</Message></Response>", () => {
  const xml = buildTwimlMessageResponse("hello world");
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<Response><Message>hello world<\/Message><\/Response>/);
});

test("TwiML message escapes < > & \" ' (XML-unsafe chars)", () => {
  // Any of these unescaped would break the XML parse or allow a
  // malicious sender to inject extra TwiML verbs.
  const xml = buildTwimlMessageResponse(`<b>bold</b> & "quotes" 'apos'`);
  assert.ok(!xml.includes("<b>bold</b>"));
  assert.match(xml, /&lt;b&gt;bold&lt;\/b&gt;/);
  assert.match(xml, /&amp;/);
  assert.match(xml, /&quot;quotes&quot;/);
  assert.match(xml, /&apos;apos&apos;/);
});

test("TwiML message is well-formed XML for common attack payloads", () => {
  // If we missed an escape, an inbound SMS body with a closing
  // </Message> could let the sender inject <Redirect> or <Dial>.
  const xml = buildTwimlMessageResponse("</Message><Dial>+15551234567</Dial><Message>");
  // The dangerous tags must be escaped — only ONE literal <Message>
  // wrapper should remain.
  const messageTagCount = (xml.match(/<Message>/g) ?? []).length;
  assert.equal(messageTagCount, 1, "only one <Message> opening tag should exist");
  assert.ok(!xml.includes("<Dial>"), "injected <Dial> must be escaped");
});

test("TwiML empty response is a bare <Response/> with XML declaration", () => {
  const xml = buildTwimlEmptyResponse();
  assert.equal(
    xml,
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
  );
});

test("TwiML message handles unicode and emoji without mojibake", () => {
  const xml = buildTwimlMessageResponse("café — 🍕 — 密码");
  assert.match(xml, /café — 🍕 — 密码/);
});
