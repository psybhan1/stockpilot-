import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildTelegramConnectUrl,
  buildWhatsAppConnectUrl,
  isPublicAppUrl,
  isTwilioSandboxSender,
  normalizePhoneNumber,
  normalizeTelegramChatId,
  normalizeTelegramUsername,
  readConnectStatus,
  readConnectTokenFromText,
} from "./connect-primitives";

// ── buildTelegramConnectUrl ────────────────────────────────────────────

describe("buildTelegramConnectUrl", () => {
  it("produces the canonical /start connect-<token> deep link", () => {
    assert.equal(
      buildTelegramConnectUrl("stockpilotbot", "abc123"),
      "https://t.me/stockpilotbot?start=connect-abc123"
    );
  });

  it("strips a single leading '@' from bot username", () => {
    assert.equal(
      buildTelegramConnectUrl("@stockpilotbot", "tok"),
      "https://t.me/stockpilotbot?start=connect-tok"
    );
  });

  it("trims surrounding whitespace from bot username", () => {
    assert.equal(
      buildTelegramConnectUrl("  @stockpilotbot  ", "tok"),
      "https://t.me/stockpilotbot?start=connect-tok"
    );
  });

  it("only strips the first '@' — '@@bot' keeps the second", () => {
    // Defensive: users rarely double-@ but behaviour should be deterministic.
    assert.equal(
      buildTelegramConnectUrl("@@bot", "tok"),
      "https://t.me/@bot?start=connect-tok"
    );
  });

  it("includes URL-safe token verbatim", () => {
    assert.equal(
      buildTelegramConnectUrl("bot", "A-Z_0-9"),
      "https://t.me/bot?start=connect-A-Z_0-9"
    );
  });
});

// ── buildWhatsAppConnectUrl ────────────────────────────────────────────

describe("buildWhatsAppConnectUrl", () => {
  it("produces a wa.me URL with encoded Code: line", () => {
    const url = buildWhatsAppConnectUrl("+14155238886", "tok-123");
    assert.match(url, /^https:\/\/wa\.me\/14155238886\?text=/);
    const decoded = decodeURIComponent(url.split("?text=")[1]);
    assert.equal(decoded, "🔗 Link my StockPilot account\nCode: tok-123");
  });

  it("strips 'whatsapp:' prefix from sender", () => {
    const url = buildWhatsAppConnectUrl("whatsapp:+14155238886", "t");
    assert.match(url, /^https:\/\/wa\.me\/14155238886/);
  });

  it("strips non-digit characters from sender (parens, spaces, dashes)", () => {
    const url = buildWhatsAppConnectUrl("+1 (415) 523-8886", "t");
    assert.match(url, /^https:\/\/wa\.me\/14155238886/);
  });

  it("URL-encodes the newline + emoji in message body", () => {
    const url = buildWhatsAppConnectUrl("14155238886", "tok");
    assert.ok(url.includes("%0A"), "newline should be %0A");
    assert.ok(!url.includes("\n"), "raw newline should not appear");
  });
});

// ── readConnectTokenFromText — Telegram ────────────────────────────────

describe("readConnectTokenFromText (TELEGRAM)", () => {
  const parse = (text: string) =>
    readConnectTokenFromText({ channel: "TELEGRAM", text });

  it("extracts token from canonical /start deep-link payload", () => {
    assert.equal(parse("/start connect-abc123"), "abc123");
  });

  it("is case-insensitive on the /start prefix", () => {
    assert.equal(parse("/START connect-abc"), "abc");
    assert.equal(parse("/Start connect-abc"), "abc");
  });

  it("accepts multiple spaces between /start and connect-", () => {
    assert.equal(parse("/start   connect-abc"), "abc");
  });

  it("trims surrounding whitespace from input", () => {
    assert.equal(parse("   /start connect-abc  "), "abc");
  });

  it("accepts tokens containing dashes and underscores", () => {
    assert.equal(parse("/start connect-tok_en-123"), "tok_en-123");
  });

  it("rejects empty token (connect- with nothing after)", () => {
    assert.equal(parse("/start connect-"), null);
  });

  it("rejects trailing payload after token", () => {
    // Telegram /start deep-links don't carry extra payload; reject to avoid
    // accidentally accepting a forged "/start connect-REAL extra-junk".
    assert.equal(parse("/start connect-abc extra"), null);
  });

  it("rejects token containing spaces or special chars", () => {
    assert.equal(parse("/start connect-abc xyz"), null);
    assert.equal(parse("/start connect-abc.def"), null);
    assert.equal(parse("/start connect-abc!"), null);
  });

  it("rejects message without /start prefix", () => {
    assert.equal(parse("connect-abc"), null);
    assert.equal(parse("hello /start connect-abc"), null);
  });

  it("rejects the WhatsApp pretty format on Telegram channel", () => {
    // Channel-specific parsing keeps format confusion from leaking cross-wire.
    assert.equal(parse("Code: abc"), null);
  });

  it("rejects empty / whitespace-only text", () => {
    assert.equal(parse(""), null);
    assert.equal(parse("   "), null);
  });
});

// ── readConnectTokenFromText — WhatsApp ────────────────────────────────

describe("readConnectTokenFromText (WHATSAPP)", () => {
  const parse = (text: string) =>
    readConnectTokenFromText({ channel: "WHATSAPP", text });

  it("extracts token from pretty 'Code: X' format", () => {
    assert.equal(parse("🔗 Link my StockPilot account\nCode: abc123"), "abc123");
  });

  it("is case-insensitive on the 'Code:' label", () => {
    assert.equal(parse("CODE: abc"), "abc");
    assert.equal(parse("code: abc"), "abc");
    assert.equal(parse("Code: abc"), "abc");
  });

  it("accepts no space after colon", () => {
    assert.equal(parse("Code:abc"), "abc");
  });

  it("accepts multiple spaces after colon", () => {
    assert.equal(parse("Code:   abc"), "abc");
  });

  it("accepts legacy 'connect <TOKEN>' format", () => {
    assert.equal(parse("connect abc123"), "abc123");
  });

  it("legacy format is anchored — 'hi connect abc' is rejected", () => {
    // Legacy format was strict; keep it strict to avoid false matches.
    assert.equal(parse("hi connect abc"), null);
  });

  it("pretty format wins when both patterns could match", () => {
    assert.equal(parse("connect XYZ and Code: ABC"), "ABC");
  });

  it("stops token at first non-[A-Za-z0-9_-] character", () => {
    assert.equal(parse("Code: abc.def"), "abc");
    assert.equal(parse("Code: abc@def"), "abc");
    assert.equal(parse("Code: abc def"), "abc");
  });

  it("does NOT false-match 'decode:' (word-boundary fix)", () => {
    // Regression test: the regex uses \bcode:\s*, so the common English word
    // 'decode' can never trigger a connect attempt.
    assert.equal(parse("please decode: ABC"), null);
    assert.equal(parse("decode:XYZ"), null);
  });

  it("does NOT false-match 'barcode:' / 'encode:'", () => {
    assert.equal(parse("barcode: 12345"), null);
    assert.equal(parse("encode: foobar"), null);
  });

  it("matches 'my code: ABC' because word boundary lands on the space", () => {
    assert.equal(parse("my code: ABC"), "ABC");
  });

  it("rejects the Telegram /start format on WhatsApp channel", () => {
    assert.equal(parse("/start connect-abc"), null);
  });

  it("returns null on empty / whitespace-only text", () => {
    assert.equal(parse(""), null);
    assert.equal(parse("   "), null);
  });

  it("returns null on plain greeting messages", () => {
    assert.equal(parse("hi"), null);
    assert.equal(parse("hello how are you"), null);
  });
});

// ── isPublicAppUrl ─────────────────────────────────────────────────────

describe("isPublicAppUrl", () => {
  it("accepts a normal https URL", () => {
    assert.equal(isPublicAppUrl("https://stockpilot.app"), true);
    assert.equal(isPublicAppUrl("https://example.com/path?q=1"), true);
  });

  it("accepts https URL with port", () => {
    assert.equal(isPublicAppUrl("https://example.com:8443"), true);
  });

  it("rejects http on a non-loopback host", () => {
    assert.equal(isPublicAppUrl("http://example.com"), false);
  });

  it("rejects https on localhost / 127.0.0.1 / 0.0.0.0", () => {
    assert.equal(isPublicAppUrl("https://localhost"), false);
    assert.equal(isPublicAppUrl("https://127.0.0.1"), false);
    assert.equal(isPublicAppUrl("https://0.0.0.0"), false);
  });

  it("rejects http://localhost (valid dev URL, but not a public webhook target)", () => {
    assert.equal(isPublicAppUrl("http://localhost:3000"), false);
    assert.equal(isPublicAppUrl("http://127.0.0.1:5678"), false);
  });

  it("rejects malformed URLs without throwing", () => {
    assert.equal(isPublicAppUrl("not a url"), false);
    assert.equal(isPublicAppUrl(""), false);
    assert.equal(isPublicAppUrl("://"), false);
  });

  it("is case-insensitive on hostname", () => {
    assert.equal(isPublicAppUrl("https://LOCALHOST"), false);
    assert.equal(isPublicAppUrl("https://Example.Com"), true);
  });

  it("rejects non-http schemes (ftp, javascript, data)", () => {
    assert.equal(isPublicAppUrl("ftp://example.com"), false);
    assert.equal(isPublicAppUrl("javascript:alert(1)"), false);
    assert.equal(isPublicAppUrl("data:text/html,foo"), false);
  });
});

// ── isTwilioSandboxSender ──────────────────────────────────────────────

describe("isTwilioSandboxSender", () => {
  it("detects the shared sandbox number", () => {
    assert.equal(isTwilioSandboxSender("+14155238886"), true);
  });

  it("detects the sandbox number with whatsapp: prefix", () => {
    assert.equal(isTwilioSandboxSender("whatsapp:+14155238886"), true);
  });

  it("detects prefix case-insensitively", () => {
    assert.equal(isTwilioSandboxSender("WHATSAPP:+14155238886"), true);
  });

  it("rejects other phone numbers", () => {
    assert.equal(isTwilioSandboxSender("+14155230000"), false);
    assert.equal(isTwilioSandboxSender("whatsapp:+14155230000"), false);
  });

  it("returns false for null / undefined / empty", () => {
    assert.equal(isTwilioSandboxSender(null), false);
    assert.equal(isTwilioSandboxSender(undefined), false);
    assert.equal(isTwilioSandboxSender(""), false);
  });
});

// ── normalizePhoneNumber ───────────────────────────────────────────────

describe("normalizePhoneNumber", () => {
  it("preserves an already-normalized E.164 number", () => {
    assert.equal(normalizePhoneNumber("+14155238886"), "+14155238886");
  });

  it("strips whatsapp: prefix", () => {
    assert.equal(normalizePhoneNumber("whatsapp:+14155238886"), "+14155238886");
  });

  it("strips common formatting (parens, spaces, dashes)", () => {
    assert.equal(normalizePhoneNumber("+1 (415) 523-8886"), "+14155238886");
  });

  it("prepends '+' when missing", () => {
    assert.equal(normalizePhoneNumber("14155238886"), "+14155238886");
  });

  it("returns null for empty / whitespace / non-numeric input", () => {
    assert.equal(normalizePhoneNumber(""), null);
    assert.equal(normalizePhoneNumber("   "), null);
    assert.equal(normalizePhoneNumber("abc"), null);
  });

  it("strips the whatsapp: prefix case-insensitively", () => {
    assert.equal(normalizePhoneNumber("WhatsApp:+14155238886"), "+14155238886");
  });
});

// ── normalizeTelegramChatId ────────────────────────────────────────────

describe("normalizeTelegramChatId", () => {
  it("returns trimmed ID for valid input", () => {
    assert.equal(normalizeTelegramChatId("123456789"), "123456789");
    assert.equal(normalizeTelegramChatId("  -1001234567890  "), "-1001234567890");
  });

  it("preserves negative chat IDs (groups/channels)", () => {
    assert.equal(normalizeTelegramChatId("-1001234567890"), "-1001234567890");
  });

  it("returns null for empty / whitespace-only input", () => {
    assert.equal(normalizeTelegramChatId(""), null);
    assert.equal(normalizeTelegramChatId("   "), null);
    assert.equal(normalizeTelegramChatId("\t\n"), null);
  });

  it("stays a string — does not cast to number (Telegram IDs exceed JS safe int)", () => {
    const big = "9999999999999999";
    assert.equal(typeof normalizeTelegramChatId(big), "string");
  });
});

// ── normalizeTelegramUsername ──────────────────────────────────────────

describe("normalizeTelegramUsername", () => {
  it("prepends '@' when missing", () => {
    assert.equal(normalizeTelegramUsername("stockpilotbot"), "@stockpilotbot");
  });

  it("keeps existing '@' prefix", () => {
    assert.equal(normalizeTelegramUsername("@stockpilotbot"), "@stockpilotbot");
  });

  it("returns null for null input", () => {
    assert.equal(normalizeTelegramUsername(null), null);
  });

  it("returns null for empty string (falsy)", () => {
    assert.equal(normalizeTelegramUsername(""), null);
  });
});

// ── readConnectStatus ──────────────────────────────────────────────────

describe("readConnectStatus", () => {
  it("returns 'connected' when metadata is null / undefined", () => {
    assert.equal(readConnectStatus(null), "connected");
    assert.equal(readConnectStatus(undefined), "connected");
  });

  it("returns 'connected' when metadata is not an object", () => {
    assert.equal(readConnectStatus("expired"), "connected");
    assert.equal(readConnectStatus(42), "connected");
    assert.equal(readConnectStatus(true), "connected");
  });

  it("returns 'connected' when metadata is an array", () => {
    // Arrays are typeof 'object' — the Array.isArray guard is load-bearing.
    assert.equal(readConnectStatus(["expired"]), "connected");
  });

  it("extracts valid status strings from object metadata", () => {
    assert.equal(readConnectStatus({ connectStatus: "connected" }), "connected");
    assert.equal(readConnectStatus({ connectStatus: "expired" }), "expired");
    assert.equal(readConnectStatus({ connectStatus: "invalid" }), "invalid");
    assert.equal(readConnectStatus({ connectStatus: "conflict" }), "conflict");
  });

  it("narrows unknown status values to 'connected' (no arbitrary strings leak through)", () => {
    assert.equal(readConnectStatus({ connectStatus: "pending" }), "connected");
    assert.equal(readConnectStatus({ connectStatus: "" }), "connected");
    assert.equal(readConnectStatus({ connectStatus: 42 }), "connected");
    assert.equal(readConnectStatus({ connectStatus: null }), "connected");
  });

  it("handles missing connectStatus field", () => {
    assert.equal(readConnectStatus({}), "connected");
    assert.equal(readConnectStatus({ otherField: "x" }), "connected");
  });

  it("ignores other fields alongside connectStatus", () => {
    assert.equal(
      readConnectStatus({ connectStatus: "expired", foo: "bar", nested: { x: 1 } }),
      "expired"
    );
  });
});
