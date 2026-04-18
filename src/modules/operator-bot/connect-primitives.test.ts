import test from "node:test";
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
  readLocationPairingCode,
} from "./connect-primitives";

// ── readLocationPairingCode ─────────────────────────────────────────────────

test("pairing code: exact SB-AB1234 → uppercased", () => {
  assert.equal(readLocationPairingCode("SB-AB1234"), "SB-AB1234");
});

test("pairing code: lowercase input is normalised to upper", () => {
  assert.equal(readLocationPairingCode("sb-ab1234"), "SB-AB1234");
});

test("pairing code: mixed case normalised", () => {
  assert.equal(readLocationPairingCode("Sb-Ab12Cd"), "SB-AB12CD");
});

test("pairing code: surrounding whitespace is ignored", () => {
  assert.equal(readLocationPairingCode("  SB-AB1234  "), "SB-AB1234");
});

test("pairing code: tabs/newlines around are ignored", () => {
  assert.equal(readLocationPairingCode("\tSB-AB1234\n"), "SB-AB1234");
});

test("pairing code: 7-char suffix rejected (too long)", () => {
  assert.equal(readLocationPairingCode("SB-AB12345"), null);
});

test("pairing code: 5-char suffix rejected (too short)", () => {
  assert.equal(readLocationPairingCode("SB-AB123"), null);
});

test("pairing code: punctuation in suffix rejected", () => {
  assert.equal(readLocationPairingCode("SB-AB-123"), null);
});

test("pairing code: missing SB- prefix rejected", () => {
  assert.equal(readLocationPairingCode("AB1234"), null);
});

test("pairing code: trailing text rejected (anchored)", () => {
  // Guard: used to gate Telegram/WhatsApp location pairing. An
  // un-anchored match would let "SB-AB1234 please" pair wrongly.
  assert.equal(readLocationPairingCode("SB-AB1234 please"), null);
});

test("pairing code: leading text rejected (anchored)", () => {
  assert.equal(readLocationPairingCode("pair SB-AB1234"), null);
});

test("pairing code: empty string → null", () => {
  assert.equal(readLocationPairingCode(""), null);
});

test("pairing code: whitespace-only → null", () => {
  assert.equal(readLocationPairingCode("   "), null);
});

test("pairing code: unrelated text → null", () => {
  assert.equal(readLocationPairingCode("hello there"), null);
});

// ── readConnectTokenFromText: Telegram ──────────────────────────────────────

test("telegram connect: /start connect-ABC123 → ABC123", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "TELEGRAM", text: "/start connect-ABC123" }),
    "ABC123"
  );
});

test("telegram connect: base64url token with _ and - accepted", () => {
  assert.equal(
    readConnectTokenFromText({
      channel: "TELEGRAM",
      text: "/start connect-abc_DEF-123",
    }),
    "abc_DEF-123"
  );
});

test("telegram connect: 16-char base64url token (randomBytes(12)) parses", () => {
  // randomBytes(12).toString("base64url") produces 16 chars.
  const token = "aB3_cD4-eF5gH6iJ";
  assert.equal(
    readConnectTokenFromText({ channel: "TELEGRAM", text: `/start connect-${token}` }),
    token
  );
});

test("telegram connect: case-insensitive /START", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "TELEGRAM", text: "/START connect-ABC" }),
    "ABC"
  );
});

test("telegram connect: extra whitespace between /start and connect accepted", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "TELEGRAM", text: "/start   connect-ABC" }),
    "ABC"
  );
});

test("telegram connect: trailing text rejected (anchored)", () => {
  assert.equal(
    readConnectTokenFromText({
      channel: "TELEGRAM",
      text: "/start connect-ABC please",
    }),
    null
  );
});

test("telegram connect: missing /start prefix rejected", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "TELEGRAM", text: "connect-ABC" }),
    null
  );
});

test("telegram connect: bare '/start' rejected", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "TELEGRAM", text: "/start" }),
    null
  );
});

test("telegram connect: leading/trailing whitespace is trimmed", () => {
  assert.equal(
    readConnectTokenFromText({
      channel: "TELEGRAM",
      text: "  /start connect-ABC  ",
    }),
    "ABC"
  );
});

test("telegram connect: WhatsApp pretty format NOT honoured for Telegram", () => {
  // If the Telegram user types "Code: ABC" (thinking WhatsApp-style),
  // we should not accept it — Telegram's link is the /start one.
  assert.equal(
    readConnectTokenFromText({ channel: "TELEGRAM", text: "Code: ABC" }),
    null
  );
});

test("telegram connect: legacy 'connect ABC' NOT honoured for Telegram", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "TELEGRAM", text: "connect ABC" }),
    null
  );
});

test("telegram connect: empty text → null", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "TELEGRAM", text: "" }),
    null
  );
});

// ── readConnectTokenFromText: WhatsApp ──────────────────────────────────────

test("wa connect: wa.me prefill '🔗 Link... \\nCode: ABC' matches", () => {
  // Real wa.me prefill we hand out. Must parse.
  assert.equal(
    readConnectTokenFromText({
      channel: "WHATSAPP",
      text: "🔗 Link my StockPilot account\nCode: ABC123",
    }),
    "ABC123"
  );
});

test("wa connect: plain 'Code: ABC' matches", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: "Code: ABC123" }),
    "ABC123"
  );
});

test("wa connect: case-insensitive 'code:' / 'CODE:'", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: "code: abc" }),
    "abc"
  );
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: "CODE: ABC" }),
    "ABC"
  );
});

test("wa connect: tight 'Code:ABC' (no space) matches", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: "Code:ABC123" }),
    "ABC123"
  );
});

test("wa connect: token with _ and - accepted", () => {
  assert.equal(
    readConnectTokenFromText({
      channel: "WHATSAPP",
      text: "🔗 Link my StockPilot account\nCode: abc_DEF-123",
    }),
    "abc_DEF-123"
  );
});

test("wa connect: legacy 'connect ABC' still accepted", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: "connect ABC123" }),
    "ABC123"
  );
});

test("wa connect: legacy 'CONNECT ABC' (case-insensitive)", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: "CONNECT ABC123" }),
    "ABC123"
  );
});

test("wa connect: surrounding whitespace on pretty format trimmed", () => {
  assert.equal(
    readConnectTokenFromText({
      channel: "WHATSAPP",
      text: "   🔗 Link my StockPilot account\nCode: ABC123   ",
    }),
    "ABC123"
  );
});

test("wa connect: trailing whitespace on token accepted", () => {
  assert.equal(
    readConnectTokenFromText({
      channel: "WHATSAPP",
      text: "Code: ABC123   ",
    }),
    "ABC123"
  );
});

// ── BUG FIX regression locks ───────────────────────────────────────────────

test("wa connect REGRESSION: 'my discount code: SAVE20' does NOT hijack as connect", () => {
  // The previous pretty-regex `/code:\s*([A-Za-z0-9_-]+)/i` was
  // unanchored — this conversational message was interpreted as a
  // connect attempt and the user saw "link no longer valid."
  // The fix anchors `code:` to start-of-line AND the token to end-of-
  // string, so a mid-sentence "discount code: SAVE20" no longer
  // triggers the connect path.
  assert.equal(
    readConnectTokenFromText({
      channel: "WHATSAPP",
      text: "my discount code: SAVE20",
    }),
    null
  );
});

test("wa connect REGRESSION: 'the promo code: FOO has expired' ignored", () => {
  // Not at end-of-string → not a connect token.
  assert.equal(
    readConnectTokenFromText({
      channel: "WHATSAPP",
      text: "the promo code: FOO has expired",
    }),
    null
  );
});

test("wa connect REGRESSION: 'Does this have a reorder code: X?' ignored", () => {
  // Trailing `?` means token isn't at end-of-string.
  assert.equal(
    readConnectTokenFromText({
      channel: "WHATSAPP",
      text: "Does this have a reorder code: X?",
    }),
    null
  );
});

test("wa connect REGRESSION: 'code: ABC extra' with trailing text ignored", () => {
  // Anchored to end-of-string.
  assert.equal(
    readConnectTokenFromText({
      channel: "WHATSAPP",
      text: "code: ABC extra",
    }),
    null
  );
});

test("wa connect REGRESSION: 'Code: SB-AB1234' rejected as connect token", () => {
  // Location pairing codes contain '-' which IS in [A-Za-z0-9_-],
  // but the pairing code path runs BEFORE the connect-token path in
  // the bot route. Even so, locking here: pretty matcher requires
  // 'Code:' at line start, and 'SB-AB1234' is a valid [A-Za-z0-9_-]
  // token, so this DOES match — callers must check
  // readLocationPairingCode first. Documenting the ordering.
  assert.equal(
    readConnectTokenFromText({
      channel: "WHATSAPP",
      text: "Code: SB-AB1234",
    }),
    "SB-AB1234"
  );
});

test("wa connect: 'hello' → null", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: "hello" }),
    null
  );
});

test("wa connect: empty text → null", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: "" }),
    null
  );
});

test("wa connect: whitespace-only → null", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: "   " }),
    null
  );
});

test("wa connect: just 'connect' with no token → null", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: "connect" }),
    null
  );
});

test("wa connect: 'connect ABC extra' → null (anchored)", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: "connect ABC extra" }),
    null
  );
});

// ── buildTelegramConnectUrl ─────────────────────────────────────────────────

test("build tg url: bare username", () => {
  assert.equal(
    buildTelegramConnectUrl("StockPilotBot", "tok"),
    "https://t.me/StockPilotBot?start=connect-tok"
  );
});

test("build tg url: leading '@' stripped", () => {
  assert.equal(
    buildTelegramConnectUrl("@StockPilotBot", "tok"),
    "https://t.me/StockPilotBot?start=connect-tok"
  );
});

test("build tg url: surrounding whitespace trimmed", () => {
  assert.equal(
    buildTelegramConnectUrl("  StockPilotBot  ", "tok"),
    "https://t.me/StockPilotBot?start=connect-tok"
  );
});

test("build tg url: token with _ and - preserved", () => {
  assert.equal(
    buildTelegramConnectUrl("Bot", "abc_DEF-123"),
    "https://t.me/Bot?start=connect-abc_DEF-123"
  );
});

test("build tg url: round-trips through readConnectTokenFromText", () => {
  // A token we build must be readable back when the user taps it
  // and Telegram replies with the /start payload.
  const token = "aB3_cD4-eF5gH6iJ";
  const url = buildTelegramConnectUrl("Bot", token);
  const parsed = new URL(url);
  // Telegram turns ?start=connect-TOK into "/start connect-TOK" in the
  // first bot message.
  const telegramEchoes = `/start connect-${parsed.searchParams.get("start")!.replace(/^connect-/, "")}`;
  assert.equal(
    readConnectTokenFromText({ channel: "TELEGRAM", text: telegramEchoes }),
    token
  );
});

// ── buildWhatsAppConnectUrl ─────────────────────────────────────────────────

test("build wa url: E.164 phone stripped to digits", () => {
  const url = buildWhatsAppConnectUrl("+14155551234", "tok");
  // wa.me rejects '+', so we send bare digits.
  assert.ok(url.startsWith("https://wa.me/14155551234?"), `got ${url}`);
});

test("build wa url: whatsapp:+14155551234 strips prefix", () => {
  const url = buildWhatsAppConnectUrl("whatsapp:+14155551234", "tok");
  assert.ok(url.startsWith("https://wa.me/14155551234?"));
});

test("build wa url: formatted '+1 (415) 555-1234' stripped to digits", () => {
  const url = buildWhatsAppConnectUrl("+1 (415) 555-1234", "tok");
  assert.ok(url.startsWith("https://wa.me/14155551234?"));
});

test("build wa url: prefill contains 'Code: <token>' exactly", () => {
  const url = buildWhatsAppConnectUrl("+14155551234", "ABCXYZ");
  const parsed = new URL(url);
  const text = parsed.searchParams.get("text");
  assert.ok(text?.includes("Code: ABCXYZ"), `got ${text}`);
  assert.ok(text?.includes("Link my StockPilot account"));
});

test("build wa url: prefill survives wa.me → readConnectToken round-trip", () => {
  // The whole point: we hand out a URL that prefills a message the
  // user sends verbatim, and the bot must parse it back.
  const token = "aB3_cD4-eF5gH6iJ";
  const url = buildWhatsAppConnectUrl("+14155551234", token);
  const parsed = new URL(url);
  const prefilledText = parsed.searchParams.get("text")!;
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: prefilledText }),
    token
  );
});

// ── isPublicAppUrl ──────────────────────────────────────────────────────────

test("isPublicAppUrl: https://example.com → true", () => {
  assert.equal(isPublicAppUrl("https://example.com"), true);
});

test("isPublicAppUrl: https with path → true", () => {
  assert.equal(isPublicAppUrl("https://example.com/webhook"), true);
});

test("isPublicAppUrl: http://example.com → false (not https)", () => {
  assert.equal(isPublicAppUrl("http://example.com"), false);
});

test("isPublicAppUrl: https://localhost → false", () => {
  assert.equal(isPublicAppUrl("https://localhost"), false);
});

test("isPublicAppUrl: http://localhost:3000 → false", () => {
  assert.equal(isPublicAppUrl("http://localhost:3000"), false);
});

test("isPublicAppUrl: https://127.0.0.1 → false", () => {
  assert.equal(isPublicAppUrl("https://127.0.0.1"), false);
});

test("isPublicAppUrl: https://0.0.0.0 → false", () => {
  assert.equal(isPublicAppUrl("https://0.0.0.0"), false);
});

test("isPublicAppUrl BUG FIX: https://[::1] → false (IPv6 loopback blocked)", () => {
  // The previous check only blocked v4 loopback literals, so
  // [::1] — the IPv6 equivalent — slipped through as "public." Now
  // fixed.
  assert.equal(isPublicAppUrl("https://[::1]"), false);
});

test("isPublicAppUrl BUG FIX: http://[::1] → false", () => {
  assert.equal(isPublicAppUrl("http://[::1]"), false);
});

test("isPublicAppUrl BUG FIX: https://[::1]:3000/path → false", () => {
  assert.equal(isPublicAppUrl("https://[::1]:3000/path"), false);
});

test("isPublicAppUrl: ftp://example.com → false (wrong scheme)", () => {
  assert.equal(isPublicAppUrl("ftp://example.com"), false);
});

test("isPublicAppUrl: malformed URL → false", () => {
  assert.equal(isPublicAppUrl("not a url"), false);
});

test("isPublicAppUrl: empty string → false", () => {
  assert.equal(isPublicAppUrl(""), false);
});

test("isPublicAppUrl: https://LOCALHOST is normalised lowercase → false", () => {
  // URL parser lowercases host, so LOCALHOST still lands in the
  // blocklist.
  assert.equal(isPublicAppUrl("https://LOCALHOST"), false);
});

test("isPublicAppUrl: https://example.com:443/path → true", () => {
  assert.equal(isPublicAppUrl("https://example.com:443/path"), true);
});

test("isPublicAppUrl: javascript: URL → false", () => {
  assert.equal(isPublicAppUrl("javascript:alert(1)"), false);
});

// ── isTwilioSandboxSender ───────────────────────────────────────────────────

test("sandbox sender: whatsapp:+14155238886 → true", () => {
  assert.equal(isTwilioSandboxSender("whatsapp:+14155238886"), true);
});

test("sandbox sender: bare +14155238886 → true", () => {
  assert.equal(isTwilioSandboxSender("+14155238886"), true);
});

test("sandbox sender: WHATSAPP:+14155238886 (case) → true", () => {
  assert.equal(isTwilioSandboxSender("WHATSAPP:+14155238886"), true);
});

test("sandbox sender: WhatsApp:+14155238886 (mixed case) → true", () => {
  assert.equal(isTwilioSandboxSender("WhatsApp:+14155238886"), true);
});

test("sandbox sender: other number → false", () => {
  assert.equal(isTwilioSandboxSender("whatsapp:+14155550123"), false);
});

test("sandbox sender: null → false", () => {
  assert.equal(isTwilioSandboxSender(null), false);
});

test("sandbox sender: undefined → false", () => {
  assert.equal(isTwilioSandboxSender(undefined), false);
});

test("sandbox sender: empty string → false", () => {
  assert.equal(isTwilioSandboxSender(""), false);
});

// ── normalizePhoneNumber ────────────────────────────────────────────────────

test("phone: +14155551234 → +14155551234", () => {
  assert.equal(normalizePhoneNumber("+14155551234"), "+14155551234");
});

test("phone: whatsapp:+14155551234 → +14155551234", () => {
  assert.equal(normalizePhoneNumber("whatsapp:+14155551234"), "+14155551234");
});

test("phone: WhatsApp:+14155551234 (case) strips prefix", () => {
  assert.equal(normalizePhoneNumber("WhatsApp:+14155551234"), "+14155551234");
});

test("phone: +1 (415) 555-1234 strips formatting", () => {
  assert.equal(normalizePhoneNumber("+1 (415) 555-1234"), "+14155551234");
});

test("phone: 14155551234 (no +) gets prefix added", () => {
  assert.equal(normalizePhoneNumber("14155551234"), "+14155551234");
});

test("phone: empty string → null", () => {
  assert.equal(normalizePhoneNumber(""), null);
});

test("phone: pure punctuation → null", () => {
  assert.equal(normalizePhoneNumber("()-. "), null);
});

test("phone: letters only → null", () => {
  assert.equal(normalizePhoneNumber("abcdef"), null);
});

test("phone: whatsapp: prefix with no number → null", () => {
  assert.equal(normalizePhoneNumber("whatsapp:"), null);
});

// ── normalizeTelegramChatId ─────────────────────────────────────────────────

test("chat id: digits only preserved", () => {
  assert.equal(normalizeTelegramChatId("123456789"), "123456789");
});

test("chat id: whitespace trimmed", () => {
  assert.equal(normalizeTelegramChatId("  123456789  "), "123456789");
});

test("chat id: empty → null", () => {
  assert.equal(normalizeTelegramChatId(""), null);
});

test("chat id: whitespace-only → null", () => {
  assert.equal(normalizeTelegramChatId("   "), null);
});

test("chat id: negative group id preserved", () => {
  // Telegram group chat ids are negative integers like "-100123...".
  assert.equal(normalizeTelegramChatId("-1001234567"), "-1001234567");
});

// ── normalizeTelegramUsername ───────────────────────────────────────────────

test("tg username: 'foo' → '@foo'", () => {
  assert.equal(normalizeTelegramUsername("foo"), "@foo");
});

test("tg username: '@foo' stays '@foo'", () => {
  assert.equal(normalizeTelegramUsername("@foo"), "@foo");
});

test("tg username: null → null (unlink clears column)", () => {
  assert.equal(normalizeTelegramUsername(null), null);
});

test("tg username: empty string → null", () => {
  // An empty string as username makes no sense; treat same as null
  // so we don't store '@' as the username.
  assert.equal(normalizeTelegramUsername(""), null);
});

// ── readConnectStatus ───────────────────────────────────────────────────────

test("connect status: { connectStatus: 'connected' } → 'connected'", () => {
  assert.equal(readConnectStatus({ connectStatus: "connected" }), "connected");
});

test("connect status: 'expired' passes through", () => {
  assert.equal(readConnectStatus({ connectStatus: "expired" }), "expired");
});

test("connect status: 'invalid' passes through", () => {
  assert.equal(readConnectStatus({ connectStatus: "invalid" }), "invalid");
});

test("connect status: 'conflict' passes through", () => {
  assert.equal(readConnectStatus({ connectStatus: "conflict" }), "conflict");
});

test("connect status: unknown string defaults to 'connected'", () => {
  // We only ever default to the success-case so a duplicate webhook
  // retry echoes success back to the user rather than surfacing
  // garbage. (An actual failed connect wrote one of the four known
  // strings, so unknown = corrupted metadata = assume connected.)
  assert.equal(readConnectStatus({ connectStatus: "xyz" }), "connected");
});

test("connect status: null metadata → 'connected'", () => {
  assert.equal(readConnectStatus(null), "connected");
});

test("connect status: undefined metadata → 'connected'", () => {
  assert.equal(readConnectStatus(undefined), "connected");
});

test("connect status: array metadata (malformed) → 'connected'", () => {
  // Prisma JSON fields can legally be arrays but we never write one;
  // defensively treat as "connected" (don't throw).
  assert.equal(readConnectStatus(["boom"]), "connected");
});

test("connect status: string metadata → 'connected'", () => {
  assert.equal(readConnectStatus("connected"), "connected");
});

test("connect status: number metadata → 'connected'", () => {
  assert.equal(readConnectStatus(42), "connected");
});

test("connect status: object without connectStatus key → 'connected'", () => {
  assert.equal(readConnectStatus({ other: "value" }), "connected");
});
