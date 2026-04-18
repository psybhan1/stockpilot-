import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalImageMime,
  contentTypeToWhisperExtension,
  isSupportedImageContentType,
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

// ── isSupportedImageContentType ──────────────────────────────────────────
//
// Gate before we spend a Twilio media download + Groq vision tokens.
// Twilio occasionally forwards non-image MIMEs (video/*, application/*
// for PDF invoices) that Llama 4 Scout can't parse — we want the
// helper to say "no" so the route ignores the media rather than
// shipping a garbage data URL to the model.

test("image mime supported: image/jpeg → true", () => {
  assert.equal(isSupportedImageContentType("image/jpeg"), true);
});

test("image mime supported: image/jpg (non-standard) → true", () => {
  // Some Twilio carriers report jpg without the "e". We still accept
  // and canonicalise downstream.
  assert.equal(isSupportedImageContentType("image/jpg"), true);
});

test("image mime supported: image/png → true", () => {
  assert.equal(isSupportedImageContentType("image/png"), true);
});

test("image mime supported: image/webp → true", () => {
  assert.equal(isSupportedImageContentType("image/webp"), true);
});

test("image mime supported: image/gif → true", () => {
  assert.equal(isSupportedImageContentType("image/gif"), true);
});

test("image mime supported: IMAGE/JPEG (case) → true", () => {
  assert.equal(isSupportedImageContentType("IMAGE/JPEG"), true);
});

test("image mime supported: image/jpeg;charset=binary → true (params stripped)", () => {
  assert.equal(
    isSupportedImageContentType("image/jpeg;charset=binary"),
    true
  );
});

test("image mime supported: 'image/jpeg ' (whitespace) → true", () => {
  // Defensive — some gateways pad the content-type header.
  assert.equal(isSupportedImageContentType("image/jpeg "), true);
});

test("image mime supported: image/bmp → false (not in vision allowlist)", () => {
  // Llama 4 Scout docs list jpeg/png/webp/gif; bmp isn't guaranteed.
  // Reject upfront so we don't waste a Groq call on 400 back.
  assert.equal(isSupportedImageContentType("image/bmp"), false);
});

test("image mime supported: image/tiff → false", () => {
  assert.equal(isSupportedImageContentType("image/tiff"), false);
});

test("image mime supported: image/svg+xml → false", () => {
  // SVG is XML — vision models don't read it as an image.
  assert.equal(isSupportedImageContentType("image/svg+xml"), false);
});

test("image mime supported: video/mp4 → false", () => {
  assert.equal(isSupportedImageContentType("video/mp4"), false);
});

test("image mime supported: application/pdf → false", () => {
  // Common: manager forwards a PDF invoice. We currently don't
  // handle PDFs via the vision model — reject and let the route
  // fall back to "unsupported".
  assert.equal(isSupportedImageContentType("application/pdf"), false);
});

test("image mime supported: audio/ogg → false", () => {
  assert.equal(isSupportedImageContentType("audio/ogg"), false);
});

test("image mime supported: empty string → false", () => {
  assert.equal(isSupportedImageContentType(""), false);
});

test("image mime supported: 'image' with no subtype → false", () => {
  assert.equal(isSupportedImageContentType("image"), false);
});

// ── canonicalImageMime ───────────────────────────────────────────────────
//
// The vision model expects the `data:<mime>;base64,...` prefix to use
// the canonical IANA MIME. `image/jpg` is a widespread typo that the
// model rejects, so we normalise it to `image/jpeg`.

test("canonical mime: image/jpeg unchanged", () => {
  assert.equal(canonicalImageMime("image/jpeg"), "image/jpeg");
});

test("canonical mime: image/jpg → image/jpeg (normaliser)", () => {
  assert.equal(canonicalImageMime("image/jpg"), "image/jpeg");
});

test("canonical mime: image/png unchanged", () => {
  assert.equal(canonicalImageMime("image/png"), "image/png");
});

test("canonical mime: image/webp unchanged", () => {
  assert.equal(canonicalImageMime("image/webp"), "image/webp");
});

test("canonical mime: params stripped (image/jpeg;foo=bar → image/jpeg)", () => {
  assert.equal(canonicalImageMime("image/jpeg;charset=binary"), "image/jpeg");
});

test("canonical mime: IMAGE/PNG → image/png (lowercased)", () => {
  assert.equal(canonicalImageMime("IMAGE/PNG"), "image/png");
});

test("canonical mime: 'image/jpg ; foo' → image/jpeg (trim + params + normalise)", () => {
  assert.equal(canonicalImageMime("image/jpg ; foo"), "image/jpeg");
});
