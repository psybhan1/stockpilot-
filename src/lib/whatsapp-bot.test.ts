import test from "node:test";
import assert from "node:assert/strict";

import {
  contentTypeToWhisperExtension,
  normalizeWhatsAppAddress,
} from "./whatsapp-bot";

// ── normalizeWhatsAppAddress ────────────────────────────────────────────
//
// Twilio's /Messages.json endpoint rejects any casing variant of the
// prefix — it insists on lowercase `whatsapp:`. Bot routes feed this
// helper every From/To before every send, so every edge case below
// is a real Twilio rejection we would otherwise ship.

test("normalizeWhatsAppAddress: adds prefix to a bare E.164 number", () => {
  assert.equal(normalizeWhatsAppAddress("+14155550123"), "whatsapp:+14155550123");
});

test("normalizeWhatsAppAddress: leaves a correctly-prefixed value untouched", () => {
  assert.equal(
    normalizeWhatsAppAddress("whatsapp:+14155550123"),
    "whatsapp:+14155550123"
  );
});

test("normalizeWhatsAppAddress: forces the prefix lowercase (WhatsApp:)", () => {
  // Bug: the previous implementation treated the prefix match as
  // case-insensitive but preserved the input case. Twilio 400s if
  // the prefix isn't exactly `whatsapp:`.
  assert.equal(
    normalizeWhatsAppAddress("WhatsApp:+14155550123"),
    "whatsapp:+14155550123"
  );
});

test("normalizeWhatsAppAddress: forces the prefix lowercase (WHATSAPP:)", () => {
  assert.equal(
    normalizeWhatsAppAddress("WHATSAPP:+14155550123"),
    "whatsapp:+14155550123"
  );
});

test("normalizeWhatsAppAddress: strips surrounding whitespace", () => {
  assert.equal(
    normalizeWhatsAppAddress("   +14155550123   "),
    "whatsapp:+14155550123"
  );
});

test("normalizeWhatsAppAddress: strips whitespace between prefix and number", () => {
  assert.equal(
    normalizeWhatsAppAddress("whatsapp: +14155550123"),
    "whatsapp:+14155550123"
  );
});

test("normalizeWhatsAppAddress: does not double-prefix when already correct", () => {
  const once = normalizeWhatsAppAddress("+14155550123");
  const twice = normalizeWhatsAppAddress(once);
  assert.equal(twice, "whatsapp:+14155550123");
  assert.equal(once, twice); // idempotent
});

test("normalizeWhatsAppAddress: idempotent on mixed-case prefix input", () => {
  const once = normalizeWhatsAppAddress("WhatsApp:+14155550123");
  const twice = normalizeWhatsAppAddress(once);
  assert.equal(once, twice);
});

test("normalizeWhatsAppAddress: preserves number casing/formatting after prefix", () => {
  // The number itself is opaque to us — any chars the caller passed
  // (+, digits, hyphens) survive. Validation happens elsewhere.
  assert.equal(
    normalizeWhatsAppAddress("+1 (415) 555-0123"),
    "whatsapp:+1 (415) 555-0123"
  );
});

test("normalizeWhatsAppAddress: only strips a leading prefix (not mid-string)", () => {
  // Defensive guard: a weirdly malformed value like
  // "+14155550123whatsapp:" should not have the trailing text stripped.
  assert.equal(
    normalizeWhatsAppAddress("+14155550123whatsapp:"),
    "whatsapp:+14155550123whatsapp:"
  );
});

test("normalizeWhatsAppAddress: empty string still produces a prefix", () => {
  // Not a valid number, but we don't want to throw in a normaliser.
  // Validation upstream rejects empties before we get here.
  assert.equal(normalizeWhatsAppAddress(""), "whatsapp:");
});

test("normalizeWhatsAppAddress: tab characters at boundaries are trimmed", () => {
  assert.equal(
    normalizeWhatsAppAddress("\t+14155550123\t"),
    "whatsapp:+14155550123"
  );
});

// ── contentTypeToWhisperExtension ───────────────────────────────────────
//
// Groq's Whisper endpoint validates the filename extension against
// the audio format. If we hand it `voice.mp4` but the bytes are an
// MP3 stream (audio/mpeg), the transcription request 400s — which
// means the bot silently fails to understand a voice note, a real
// UX regression.

test("content-type ext: audio/ogg → ogg (Twilio WhatsApp default)", () => {
  assert.equal(contentTypeToWhisperExtension("audio/ogg"), "ogg");
});

test("content-type ext: audio/ogg; codecs=opus → ogg", () => {
  assert.equal(
    contentTypeToWhisperExtension("audio/ogg; codecs=opus"),
    "ogg"
  );
});

test("content-type ext: audio/opus → ogg (opus is muxed in ogg)", () => {
  assert.equal(contentTypeToWhisperExtension("audio/opus"), "ogg");
});

test("content-type ext: audio/mpeg → mp3 (MP3 stream, NOT mp4)", () => {
  // Regression: previous impl returned "mp4" for audio/mpeg, which
  // is MP3. Whisper accepted the upload but flagged the extension
  // mismatch, so a WhatsApp voice note transcribed as "voice.mp4"
  // containing MP3 bytes failed in production.
  assert.equal(contentTypeToWhisperExtension("audio/mpeg"), "mp3");
});

test("content-type ext: audio/mp3 → mp3", () => {
  assert.equal(contentTypeToWhisperExtension("audio/mp3"), "mp3");
});

test("content-type ext: audio/mpga → mp3 (Whisper accepts mpga; safer as mp3)", () => {
  assert.equal(contentTypeToWhisperExtension("audio/mpga"), "mp3");
});

test("content-type ext: audio/mp4 → mp4", () => {
  assert.equal(contentTypeToWhisperExtension("audio/mp4"), "mp4");
});

test("content-type ext: audio/m4a → m4a (NOT mp4 — distinct Apple container)", () => {
  // Prev impl: "m4a" matched "mp4"? No — doesn't contain "mp4"
  // literally but contains "m4a" — make sure we prefer m4a.
  assert.equal(contentTypeToWhisperExtension("audio/m4a"), "m4a");
});

test("content-type ext: audio/x-m4a → m4a", () => {
  assert.equal(contentTypeToWhisperExtension("audio/x-m4a"), "m4a");
});

test("content-type ext: audio/wav → wav", () => {
  assert.equal(contentTypeToWhisperExtension("audio/wav"), "wav");
});

test("content-type ext: audio/x-wav → wav", () => {
  assert.equal(contentTypeToWhisperExtension("audio/x-wav"), "wav");
});

test("content-type ext: audio/webm → webm", () => {
  assert.equal(contentTypeToWhisperExtension("audio/webm"), "webm");
});

test("content-type ext: audio/flac → flac", () => {
  assert.equal(contentTypeToWhisperExtension("audio/flac"), "flac");
});

test("content-type ext: audio/amr → amr (Whisper rejects, but preserve signal)", () => {
  assert.equal(contentTypeToWhisperExtension("audio/amr"), "amr");
});

test("content-type ext: AUDIO/OGG → ogg (case-insensitive)", () => {
  assert.equal(contentTypeToWhisperExtension("AUDIO/OGG"), "ogg");
});

test("content-type ext: AUDIO/MPEG → mp3 (case-insensitive)", () => {
  assert.equal(contentTypeToWhisperExtension("AUDIO/MPEG"), "mp3");
});

test("content-type ext: unknown content-type falls back to ogg (WhatsApp default)", () => {
  // Unknown types shouldn't throw — Twilio WhatsApp voice notes are
  // almost always ogg/opus, so that's the pragmatic default.
  assert.equal(contentTypeToWhisperExtension("audio/xyz-unknown"), "ogg");
});

test("content-type ext: empty content-type falls back to ogg", () => {
  assert.equal(contentTypeToWhisperExtension(""), "ogg");
});

test("content-type ext: ogg wins over mp4 when both substrings appear", () => {
  // Hypothetical Content-Type header that happens to contain both.
  // We want to match the *audio format*, not the container. Ogg is
  // what Twilio actually sends for WhatsApp voice notes.
  assert.equal(
    contentTypeToWhisperExtension("audio/ogg; also-mp4"),
    "ogg"
  );
});

test("content-type ext: mp3 wins over mp4 when both substrings appear", () => {
  // Mp3 check runs before mp4 — a Content-Type like `audio/mp3;
  // mp4-fallback=...` (seen in the wild from some gateways) still
  // resolves to mp3, not mp4.
  assert.equal(
    contentTypeToWhisperExtension("audio/mp3; codecs=mp4"),
    "mp3"
  );
});

test("content-type ext: m4a wins over mp4 when both substrings appear", () => {
  // m4a check runs before mp4 — `audio/m4a` also contains "m4"
  // but we shouldn't coerce to mp4 (different container, Whisper
  // needs the right extension).
  assert.equal(
    contentTypeToWhisperExtension("audio/m4a; variant=mp4"),
    "m4a"
  );
});

test("content-type ext: output is always a bare extension (no leading dot)", () => {
  // The caller does `voice.${ext}` — a dotted output would yield
  // `voice..mp3` and fail the Whisper filename check.
  const samples = [
    "audio/ogg",
    "audio/mpeg",
    "audio/mp4",
    "audio/m4a",
    "audio/wav",
    "audio/webm",
    "audio/flac",
    "audio/amr",
    "unknown/type",
  ];
  for (const s of samples) {
    const ext = contentTypeToWhisperExtension(s);
    assert.ok(!ext.startsWith("."), `extension should not start with '.': ${ext}`);
    assert.ok(ext.length >= 3 && ext.length <= 4, `unexpected length: ${ext}`);
  }
});

test("content-type ext: every mapping produces a Whisper-compatible extension", () => {
  // Whisper's supported extensions. `amr` is not in this list but
  // we intentionally pass it through — see helper comment.
  const whisperExtensions = new Set([
    "mp3",
    "mp4",
    "mpeg",
    "mpga",
    "m4a",
    "wav",
    "webm",
    "ogg",
    "flac",
  ]);
  const mapped = [
    "audio/ogg",
    "audio/opus",
    "audio/mpeg",
    "audio/mp3",
    "audio/mpga",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "audio/flac",
  ];
  for (const s of mapped) {
    const ext = contentTypeToWhisperExtension(s);
    assert.ok(
      whisperExtensions.has(ext),
      `${s} → ${ext} is not a Whisper-supported extension`
    );
  }
});
