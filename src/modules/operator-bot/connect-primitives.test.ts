import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTelegramConnectUrl,
  buildWhatsAppConnectUrl,
  isPublicAppUrl,
  isTwilioSandboxSender,
  readConnectTokenFromText,
} from "./connect-primitives";

// ── readConnectTokenFromText ───────────────────────────────────────────
//
// The only entry points for the connect flow are:
//   Telegram deep link → message body `/start connect-<TOKEN>`
//   wa.me template     → body contains `Code: <TOKEN>` (plus emoji/intro)
//   Legacy wa.me link  → body is just `connect <TOKEN>`
//
// Getting this parser wrong means a user taps the connect button, we
// fail to recognise the inbound, and they're stuck in "please tap
// again" loops. Each case below is a real wire payload we saw in
// polling.ts / route.ts.

test("readConnectTokenFromText: Telegram /start connect-<token> happy path", () => {
  const result = readConnectTokenFromText({
    channel: "TELEGRAM",
    text: "/start connect-ABCdef_123-xyz",
  });
  assert.equal(result, "ABCdef_123-xyz");
});

test("readConnectTokenFromText: Telegram case-insensitive on /start verb", () => {
  // Telegram's own client lowercases but a forwarded or automation-
  // pasted message might not. /i on the verb is intentional.
  const result = readConnectTokenFromText({
    channel: "TELEGRAM",
    text: "/START connect-TokenAbc",
  });
  assert.equal(result, "TokenAbc");
});

test("readConnectTokenFromText: Telegram preserves token case (base64url is case-sensitive)", () => {
  // Tokens come from randomBytes(12).toString("base64url") — case
  // matters. A /i that case-folded the token would silently corrupt
  // lookups.
  const result = readConnectTokenFromText({
    channel: "TELEGRAM",
    text: "/start connect-Ab-Cd_Ef",
  });
  assert.equal(result, "Ab-Cd_Ef");
});

test("readConnectTokenFromText: Telegram tolerates multiple spaces between /start and token", () => {
  const result = readConnectTokenFromText({
    channel: "TELEGRAM",
    text: "/start   connect-spaced-token",
  });
  assert.equal(result, "spaced-token");
});

test("readConnectTokenFromText: Telegram trims surrounding whitespace", () => {
  const result = readConnectTokenFromText({
    channel: "TELEGRAM",
    text: "   /start connect-trim-me   ",
  });
  assert.equal(result, "trim-me");
});

test("readConnectTokenFromText: Telegram rejects /start without connect- prefix", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "TELEGRAM", text: "/start onboarding" }),
    null
  );
});

test("readConnectTokenFromText: Telegram rejects plain /start (no parameter)", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "TELEGRAM", text: "/start" }),
    null
  );
});

test("readConnectTokenFromText: Telegram rejects WhatsApp legacy syntax on wrong channel", () => {
  // Channel-scoping matters — a user copy-pasting the WhatsApp
  // legacy form into Telegram should fall through to the agent.
  assert.equal(
    readConnectTokenFromText({ channel: "TELEGRAM", text: "connect abc123" }),
    null
  );
});

test("readConnectTokenFromText: Telegram rejects /start@botname connect-<token> (group-chat form)", () => {
  // Groups append the bot mention to commands. The connect flow is
  // 1-on-1, so we intentionally don't support this. Pin it so the
  // choice is explicit — if we ever enable group connects we'll
  // need to widen the regex.
  assert.equal(
    readConnectTokenFromText({
      channel: "TELEGRAM",
      text: "/start@stockpilot_bot connect-abc",
    }),
    null
  );
});

test("readConnectTokenFromText: Telegram accepts newline between /start and token (\\s matches \\n)", () => {
  // Documents actual behaviour: \s+ between `/start` and
  // `connect-<tok>` matches newlines too. Telegram's wire format
  // puts them on one line, so this rarely matters, but a pasted
  // connect link with a line break still works.
  assert.equal(
    readConnectTokenFromText({
      channel: "TELEGRAM",
      text: "/start\nconnect-abc",
    }),
    "abc"
  );
});

test("readConnectTokenFromText: WhatsApp pretty format `Code: <token>`", () => {
  const result = readConnectTokenFromText({
    channel: "WHATSAPP",
    text: "Code: abc123",
  });
  assert.equal(result, "abc123");
});

test("readConnectTokenFromText: WhatsApp full template with emoji + newline", () => {
  // Exact body that wa.me will prefill from buildWhatsAppConnectUrl.
  const result = readConnectTokenFromText({
    channel: "WHATSAPP",
    text: "🔗 Link my StockPilot account\nCode: AbCd_12-34",
  });
  assert.equal(result, "AbCd_12-34");
});

test("readConnectTokenFromText: WhatsApp legacy `connect <token>`", () => {
  const result = readConnectTokenFromText({
    channel: "WHATSAPP",
    text: "connect legacy-token",
  });
  assert.equal(result, "legacy-token");
});

test("readConnectTokenFromText: WhatsApp case-insensitive on Code: keyword", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: "CODE: upper" }),
    "upper"
  );
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: "code: lower" }),
    "lower"
  );
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: "CoDe: mixed" }),
    "mixed"
  );
});

test("readConnectTokenFromText: WhatsApp pretty beats legacy when both appear", () => {
  // Pretty is the current template; legacy was a one-off earlier
  // format. If a user happens to paste both, pretty is the modern
  // intent.
  const result = readConnectTokenFromText({
    channel: "WHATSAPP",
    text: "connect old-tok\nCode: new-tok",
  });
  assert.equal(result, "new-tok");
});

test("readConnectTokenFromText: WhatsApp rejects `code:` with no token", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: "Code: " }),
    null
  );
});

test("readConnectTokenFromText: WhatsApp tolerates multiple whitespace after Code:", () => {
  const result = readConnectTokenFromText({
    channel: "WHATSAPP",
    text: "Code:     padded",
  });
  assert.equal(result, "padded");
});

test("readConnectTokenFromText: WhatsApp tolerates NO space after `Code:`", () => {
  const result = readConnectTokenFromText({
    channel: "WHATSAPP",
    text: "Code:nospace",
  });
  assert.equal(result, "nospace");
});

test("readConnectTokenFromText: WhatsApp rejects garbage chat", () => {
  assert.equal(
    readConnectTokenFromText({
      channel: "WHATSAPP",
      text: "hey what's up, any milk left?",
    }),
    null
  );
});

test("readConnectTokenFromText: WhatsApp legacy must be anchored (no mid-message match)", () => {
  // Avoid `… please connect abc123 now` false positive. Anchor
  // forces a clean "connect <tok>" line; user's casual sentence
  // shouldn't hijack the connect flow.
  assert.equal(
    readConnectTokenFromText({
      channel: "WHATSAPP",
      text: "please connect abc123 now",
    }),
    null
  );
});

test("readConnectTokenFromText: WhatsApp preserves underscore + hyphen in token", () => {
  const result = readConnectTokenFromText({
    channel: "WHATSAPP",
    text: "Code: tok_abc-XYZ_123",
  });
  assert.equal(result, "tok_abc-XYZ_123");
});

test("readConnectTokenFromText: empty text returns null (both channels)", () => {
  assert.equal(readConnectTokenFromText({ channel: "TELEGRAM", text: "" }), null);
  assert.equal(readConnectTokenFromText({ channel: "WHATSAPP", text: "" }), null);
});

test("readConnectTokenFromText: whitespace-only text returns null", () => {
  assert.equal(
    readConnectTokenFromText({ channel: "TELEGRAM", text: "   \n\t  " }),
    null
  );
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: "   \n\t  " }),
    null
  );
});

test("readConnectTokenFromText: Telegram rejects tab-only separator (requires \\s+)", () => {
  // \s covers tabs too — double-check we accept a tab.
  const result = readConnectTokenFromText({
    channel: "TELEGRAM",
    text: "/start\tconnect-tabbed",
  });
  assert.equal(result, "tabbed");
});

// ── buildTelegramConnectUrl ────────────────────────────────────────────

test("buildTelegramConnectUrl: bare username → https://t.me/<user>?start=connect-<tok>", () => {
  assert.equal(
    buildTelegramConnectUrl("stockpilot_bot", "abc123"),
    "https://t.me/stockpilot_bot?start=connect-abc123"
  );
});

test("buildTelegramConnectUrl: strips leading @ from username", () => {
  assert.equal(
    buildTelegramConnectUrl("@stockpilot_bot", "abc123"),
    "https://t.me/stockpilot_bot?start=connect-abc123"
  );
});

test("buildTelegramConnectUrl: strips leading @ even with surrounding whitespace (REGRESSION)", () => {
  // BUG FIX REGRESSION: previous impl did .replace(/^@/,"").trim() —
  // the regex `^@` didn't match when the @ wasn't at position 0,
  // so leading whitespace left the @ in place after trim. The
  // URL `https://t.me/@bot?start=…` is a broken deep link.
  assert.equal(
    buildTelegramConnectUrl("  @stockpilot_bot  ", "abc123"),
    "https://t.me/stockpilot_bot?start=connect-abc123"
  );
});

test("buildTelegramConnectUrl: trims trailing whitespace without @", () => {
  assert.equal(
    buildTelegramConnectUrl("stockpilot_bot\n", "abc123"),
    "https://t.me/stockpilot_bot?start=connect-abc123"
  );
});

test("buildTelegramConnectUrl: embeds token verbatim (base64url is URL-safe)", () => {
  // Tokens come from randomBytes(...).toString("base64url") — chars
  // are [A-Za-z0-9_-]. No URL encoding needed; confirm we don't
  // accidentally encode them (which would not round-trip through
  // Telegram's deep-link reader).
  assert.equal(
    buildTelegramConnectUrl("bot", "Ab-Cd_Ef"),
    "https://t.me/bot?start=connect-Ab-Cd_Ef"
  );
});

test("buildTelegramConnectUrl: only strips a leading @, not a middle one", () => {
  // A username can't contain @ in reality, but defensive: if the
  // caller accidentally passes "bot@weird", we should not mangle it
  // past the leading-@ strip.
  assert.equal(
    buildTelegramConnectUrl("bot@weird", "tok"),
    "https://t.me/bot@weird?start=connect-tok"
  );
});

test("buildTelegramConnectUrl: URL always starts with https://t.me/", () => {
  // Telegram's deep-link scheme requires t.me — never tg.me, never
  // http. Regression guard.
  const url = buildTelegramConnectUrl("bot", "tok");
  assert.ok(url.startsWith("https://t.me/"), `got: ${url}`);
});

test("buildTelegramConnectUrl: connect- prefix is hard-coded (callback parser depends on it)", () => {
  // polling.ts + telegram/route.ts both parse the inbound as
  // `/start connect-<tok>` — changing this prefix without also
  // updating the parser silently breaks connect.
  const url = buildTelegramConnectUrl("bot", "xyz");
  assert.ok(url.endsWith("?start=connect-xyz"), `got: ${url}`);
});

// ── buildWhatsAppConnectUrl ────────────────────────────────────────────

test("buildWhatsAppConnectUrl: strips + and produces wa.me/<digits>?text=…", () => {
  const url = buildWhatsAppConnectUrl("+14155551234", "tokXYZ");
  assert.ok(url.startsWith("https://wa.me/14155551234?text="));
});

test("buildWhatsAppConnectUrl: strips whatsapp: prefix (any case)", () => {
  for (const prefix of ["whatsapp:", "WhatsApp:", "WHATSAPP:"]) {
    const url = buildWhatsAppConnectUrl(`${prefix}+14155551234`, "tok");
    assert.ok(
      url.startsWith("https://wa.me/14155551234?text="),
      `${prefix}: got ${url}`
    );
  }
});

test("buildWhatsAppConnectUrl: strips dashes, spaces, parens from number", () => {
  // Admins often paste pretty-formatted numbers. wa.me spec says
  // "omit any zeroes, brackets, or dashes" — we do the stripping.
  const url = buildWhatsAppConnectUrl("+1 (415) 555-1234", "tok");
  assert.ok(url.startsWith("https://wa.me/14155551234?text="), `got ${url}`);
});

test("buildWhatsAppConnectUrl: body contains URL-encoded 🔗 emoji", () => {
  const url = buildWhatsAppConnectUrl("+14155551234", "tokABC");
  // UTF-8 bytes for 🔗 are F0 9F 94 97.
  assert.ok(url.includes("%F0%9F%94%97"), `no link emoji: ${url}`);
});

test("buildWhatsAppConnectUrl: body contains URL-encoded newline + colon", () => {
  const url = buildWhatsAppConnectUrl("+14155551234", "tokABC");
  assert.ok(url.includes("%0A"), "no %0A (newline)");
  assert.ok(url.includes("Code%3A"), "no Code%3A (colon)");
});

test("buildWhatsAppConnectUrl: decoded body round-trips to expected template", () => {
  // Sanity check: the body we actually send, after URL-decode, is
  // exactly what readConnectTokenFromText will see on inbound.
  const url = buildWhatsAppConnectUrl("+14155551234", "round-trip-tok");
  const body = decodeURIComponent(url.split("?text=")[1] ?? "");
  assert.equal(body, "🔗 Link my StockPilot account\nCode: round-trip-tok");
});

test("buildWhatsAppConnectUrl → readConnectTokenFromText round-trip", () => {
  // The golden path: admin tap → wa.me prefill → user hits send →
  // webhook/poll sees body → parser extracts the same token.
  const token = "A1b2_C3-d4";
  const url = buildWhatsAppConnectUrl("+14155551234", token);
  const body = decodeURIComponent(url.split("?text=")[1] ?? "");
  assert.equal(
    readConnectTokenFromText({ channel: "WHATSAPP", text: body }),
    token
  );
});

test("buildTelegramConnectUrl → readConnectTokenFromText round-trip", () => {
  // Simulates the Telegram client sending the deep-link's start
  // parameter back as `/start connect-<tok>`.
  const token = "Tg_12-ab";
  const url = buildTelegramConnectUrl("@bot", token);
  // url = https://t.me/bot?start=connect-<token>
  // Telegram client converts ?start=X into `/start X` on first tap.
  const inbound = `/start connect-${token}`;
  assert.equal(url.endsWith(`?start=connect-${token}`), true);
  assert.equal(
    readConnectTokenFromText({ channel: "TELEGRAM", text: inbound }),
    token
  );
});

// ── isPublicAppUrl ─────────────────────────────────────────────────────

test("isPublicAppUrl: https public domain → true", () => {
  assert.equal(isPublicAppUrl("https://stockpilot.example.com"), true);
});

test("isPublicAppUrl: https with port preserved → true", () => {
  assert.equal(isPublicAppUrl("https://tunnel.example.com:8443"), true);
});

test("isPublicAppUrl: http public domain → false (Telegram/Twilio require TLS)", () => {
  assert.equal(isPublicAppUrl("http://stockpilot.example.com"), false);
});

test("isPublicAppUrl: https://localhost → false (webhooks can't reach it)", () => {
  assert.equal(isPublicAppUrl("https://localhost"), false);
  assert.equal(isPublicAppUrl("https://localhost:3000"), false);
});

test("isPublicAppUrl: https://127.0.0.1 → false", () => {
  assert.equal(isPublicAppUrl("https://127.0.0.1"), false);
});

test("isPublicAppUrl: https://0.0.0.0 → false", () => {
  // Rare but seen on Docker `--network host` setups where APP_URL
  // gets defaulted to 0.0.0.0 — would publish unreachable webhooks.
  assert.equal(isPublicAppUrl("https://0.0.0.0"), false);
});

test("isPublicAppUrl: http://localhost → false (tunnel required for webhooks)", () => {
  // http://localhost passes the protocol-check short-circuit (since
  // hostname is localhost) but falls through to the blocklist.
  assert.equal(isPublicAppUrl("http://localhost"), false);
});

test("isPublicAppUrl: hostname case-insensitive (LOCALHOST)", () => {
  // URL parser already lowercases, but we also .toLowerCase() again —
  // pin the invariant so a future refactor doesn't accidentally
  // reintroduce case-sensitive comparison.
  assert.equal(isPublicAppUrl("https://LOCALHOST"), false);
  assert.equal(isPublicAppUrl("https://127.0.0.1"), false);
});

test("isPublicAppUrl: empty string → false (no throw)", () => {
  assert.equal(isPublicAppUrl(""), false);
});

test("isPublicAppUrl: un-parseable string → false (no throw)", () => {
  assert.equal(isPublicAppUrl("not a url at all !!"), false);
  assert.equal(isPublicAppUrl("///bad"), false);
});

test("isPublicAppUrl: ftp:// → false (non-TLS non-localhost)", () => {
  assert.equal(isPublicAppUrl("ftp://example.com"), false);
});

test("isPublicAppUrl: https with path + query still recognised", () => {
  // polling.ts passes env.APP_URL directly — shouldn't matter if it
  // happens to carry a trailing path.
  assert.equal(
    isPublicAppUrl("https://stockpilot.example.com/app?foo=bar"),
    true
  );
});

test("isPublicAppUrl: private-range IP 10.x passes (we only filter loopback)", () => {
  // Design choice: we only block loopback/0.0.0.0. LAN addresses
  // reach webhooks inside that LAN — pin the behaviour so the
  // blocklist doesn't get silently widened (would break office
  // staging setups).
  assert.equal(isPublicAppUrl("https://10.0.0.5"), true);
});

// ── isTwilioSandboxSender ──────────────────────────────────────────────
//
// The shared Twilio sandbox is +14155238886 — any account hitting
// this number in env.TWILIO_WHATSAPP_FROM gets a "join the sandbox"
// callout in the settings UI. Matching must be robust to prefix
// casing, since admins paste from Twilio's dashboard UI.

test("isTwilioSandboxSender: bare sandbox number → true", () => {
  assert.equal(isTwilioSandboxSender("+14155238886"), true);
});

test("isTwilioSandboxSender: whatsapp: prefix stripped → true", () => {
  assert.equal(isTwilioSandboxSender("whatsapp:+14155238886"), true);
});

test("isTwilioSandboxSender: case-insensitive prefix strip", () => {
  assert.equal(isTwilioSandboxSender("WhatsApp:+14155238886"), true);
  assert.equal(isTwilioSandboxSender("WHATSAPP:+14155238886"), true);
});

test("isTwilioSandboxSender: null / undefined / empty → false (no throw)", () => {
  assert.equal(isTwilioSandboxSender(null), false);
  assert.equal(isTwilioSandboxSender(undefined), false);
  assert.equal(isTwilioSandboxSender(""), false);
});

test("isTwilioSandboxSender: non-sandbox number → false", () => {
  assert.equal(isTwilioSandboxSender("+14155551234"), false);
  assert.equal(isTwilioSandboxSender("whatsapp:+447911123456"), false);
});

test("isTwilioSandboxSender: sandbox number with extra whitespace between prefix and number → false", () => {
  // Defensive pin: we do a byte-exact compare after prefix strip —
  // if we ever relax to trim-inside, update this test. Today, a
  // stray space means the operator's env has a typo worth surfacing.
  assert.equal(isTwilioSandboxSender("whatsapp: +14155238886"), false);
});

test("isTwilioSandboxSender: sandbox number without + sign → false", () => {
  // Twilio always emits the + in its UI. A bare "14155238886" is
  // malformed and shouldn't silently match.
  assert.equal(isTwilioSandboxSender("14155238886"), false);
});

test("isTwilioSandboxSender: similar but different number (+1 415 523 8887) → false", () => {
  // Off-by-one: ensure we're checking exact equality, not prefix.
  assert.equal(isTwilioSandboxSender("+14155238887"), false);
  assert.equal(isTwilioSandboxSender("+141552388860"), false);
});
