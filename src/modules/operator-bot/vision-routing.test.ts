import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PHOTO_PROMPT,
  buildUserContent,
  hasVisionContent,
  resolveGroqModel,
  type GroqMessage,
} from "./vision-routing";

const TEXT_DEFAULT = "meta-llama/llama-4-scout-17b-16e-instruct";
const VISION_DEFAULT = "meta-llama/llama-4-maverick-17b-128e-instruct";

// ── buildUserContent ────────────────────────────────────────────────────────

test("buildUserContent: no images → plain string (text path untouched)", () => {
  // Text-only traffic must stay a bare string so we don't swap
  // tokenisation behaviour or telemetry shape for every turn.
  const result = buildUserContent("hello bot");
  assert.equal(result, "hello bot");
});

test("buildUserContent: undefined images → plain string", () => {
  assert.equal(buildUserContent("hi", undefined), "hi");
});

test("buildUserContent: empty images array → plain string", () => {
  // Empty array is equivalent to "no images" — we don't want to
  // emit a multimodal envelope with only a text part, Groq accepts
  // but it's wasteful tokens.
  assert.equal(buildUserContent("hi", []), "hi");
});

test("buildUserContent: caption + 1 image → array form with 2 parts", () => {
  const result = buildUserContent("count these boxes", [
    "data:image/jpeg;base64,AAA",
  ]);
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { type: "text", text: "count these boxes" });
  assert.deepEqual(result[1], {
    type: "image_url",
    image_url: { url: "data:image/jpeg;base64,AAA" },
  });
});

test("buildUserContent: caption-less photo uses DEFAULT_PHOTO_PROMPT", () => {
  // Operator fire-hosing photos at the bot without captions is the
  // common case (open camera, snap delivery, hit send). The default
  // prompt makes the bot behave instead of asking "what do you want
  // me to do?" — so lock the exact text.
  const result = buildUserContent("", ["data:image/jpeg;base64,X"]);
  assert.ok(Array.isArray(result));
  assert.deepEqual(result[0], { type: "text", text: DEFAULT_PHOTO_PROMPT });
});

test("buildUserContent: whitespace-only caption uses default prompt", () => {
  // A trimmed-to-empty caption is semantically the same as no
  // caption — don't ship a blank `text` part to the model.
  const result = buildUserContent("   ", ["data:image/jpeg;base64,X"]);
  assert.ok(Array.isArray(result));
  assert.deepEqual(result[0], { type: "text", text: DEFAULT_PHOTO_PROMPT });
});

test("buildUserContent: caption is NOT trimmed when non-empty", () => {
  // If the operator wrote " what brand is this?" we preserve their
  // literal string (the model handles leading spaces fine, and
  // trimming could collapse a deliberately formatted caption).
  const result = buildUserContent(" what brand is this?", [
    "data:image/jpeg;base64,X",
  ]);
  assert.ok(Array.isArray(result));
  assert.deepEqual(result[0], { type: "text", text: " what brand is this?" });
});

test("buildUserContent: multiple images attach in input order", () => {
  const result = buildUserContent("compare these", [
    "data:image/jpeg;base64,ONE",
    "data:image/png;base64,TWO",
    "data:image/webp;base64,THREE",
  ]);
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 4);
  assert.equal(result[0].type, "text");
  assert.equal((result[1] as { type: "image_url"; image_url: { url: string } }).image_url.url, "data:image/jpeg;base64,ONE");
  assert.equal((result[2] as { type: "image_url"; image_url: { url: string } }).image_url.url, "data:image/png;base64,TWO");
  assert.equal((result[3] as { type: "image_url"; image_url: { url: string } }).image_url.url, "data:image/webp;base64,THREE");
});

test("buildUserContent: text part comes FIRST (Llama docs recommend)", () => {
  // Llama 4 / OpenAI vision docs are explicit about putting text
  // before images. Locking this so a future refactor can't silently
  // reorder the parts.
  const result = buildUserContent("label:", ["data:image/png;base64,X"]);
  assert.ok(Array.isArray(result));
  assert.equal(result[0].type, "text");
  assert.equal(result[1].type, "image_url");
});

// ── hasVisionContent ────────────────────────────────────────────────────────

test("hasVisionContent: all-string messages → false", () => {
  const messages: GroqMessage[] = [
    { role: "system", content: "be helpful" },
    { role: "user", content: "what's on the menu?" },
    { role: "assistant", content: "grilled cheese" },
  ];
  assert.equal(hasVisionContent(messages), false);
});

test("hasVisionContent: empty messages → false", () => {
  assert.equal(hasVisionContent([]), false);
});

test("hasVisionContent: single image_url part on user turn → true", () => {
  const messages: GroqMessage[] = [
    { role: "system", content: "prompt" },
    {
      role: "user",
      content: [
        { type: "text", text: "what is this?" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,X" } },
      ],
    },
  ];
  assert.equal(hasVisionContent(messages), true);
});

test("hasVisionContent: array content with ONLY text parts → false", () => {
  // Someone might emit the array form with just a text part (odd
  // but valid) — that's not a vision turn, don't swap models.
  const messages: GroqMessage[] = [
    {
      role: "user",
      content: [{ type: "text", text: "hi" }],
    },
  ];
  assert.equal(hasVisionContent(messages), false);
});

test("hasVisionContent: null content doesn't crash", () => {
  // Tool-call-only turns have content: null.
  const messages: GroqMessage[] = [
    { role: "assistant", content: null, tool_calls: [] },
  ];
  assert.equal(hasVisionContent(messages), false);
});

test("hasVisionContent: image on a deep history turn still true", () => {
  // Defensive: if upstream ever leaves images on history, we still
  // detect and route to the vision model. (Today we strip history
  // images, but the check must not rely on that.)
  const messages: GroqMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: "older" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,X" } },
      ],
    },
    { role: "assistant", content: "ok" },
    { role: "user", content: "follow up" },
  ];
  assert.equal(hasVisionContent(messages), true);
});

test("hasVisionContent: multiple images still true", () => {
  const messages: GroqMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: "pick" },
        { type: "image_url", image_url: { url: "a" } },
        { type: "image_url", image_url: { url: "b" } },
      ],
    },
  ];
  assert.equal(hasVisionContent(messages), true);
});

test("hasVisionContent: system prompt alone is never vision", () => {
  const messages: GroqMessage[] = [{ role: "system", content: "system only" }];
  assert.equal(hasVisionContent(messages), false);
});

// ── resolveGroqModel ────────────────────────────────────────────────────────

test("resolveGroqModel: text turn, no overrides → Scout default", () => {
  assert.equal(
    resolveGroqModel({
      hasVision: false,
      defaultTextModel: TEXT_DEFAULT,
      defaultVisionModel: VISION_DEFAULT,
    }),
    TEXT_DEFAULT
  );
});

test("resolveGroqModel: vision turn, no overrides → Maverick default", () => {
  // The headline wiring: image turns go to the best multimodal
  // Llama on Groq.
  assert.equal(
    resolveGroqModel({
      hasVision: true,
      defaultTextModel: TEXT_DEFAULT,
      defaultVisionModel: VISION_DEFAULT,
    }),
    VISION_DEFAULT
  );
});

test("resolveGroqModel: text override applies only to text turns", () => {
  assert.equal(
    resolveGroqModel({
      hasVision: false,
      textModelOverride: "custom-text-model",
      visionModelOverride: "custom-vision-model",
      defaultTextModel: TEXT_DEFAULT,
      defaultVisionModel: VISION_DEFAULT,
    }),
    "custom-text-model"
  );
});

test("resolveGroqModel: vision override applies only to vision turns", () => {
  assert.equal(
    resolveGroqModel({
      hasVision: true,
      textModelOverride: "custom-text-model",
      visionModelOverride: "custom-vision-model",
      defaultTextModel: TEXT_DEFAULT,
      defaultVisionModel: VISION_DEFAULT,
    }),
    "custom-vision-model"
  );
});

test("resolveGroqModel: empty-string override treated as unset", () => {
  // `process.env.X = ""` happens in misconfigured deploys — don't
  // silently pick "" as the model id (Groq would 400 with an unhelpful
  // error). Fall back to the default.
  assert.equal(
    resolveGroqModel({
      hasVision: true,
      visionModelOverride: "",
      defaultTextModel: TEXT_DEFAULT,
      defaultVisionModel: VISION_DEFAULT,
    }),
    VISION_DEFAULT
  );
});

test("resolveGroqModel: whitespace-only override treated as unset", () => {
  assert.equal(
    resolveGroqModel({
      hasVision: false,
      textModelOverride: "   ",
      defaultTextModel: TEXT_DEFAULT,
      defaultVisionModel: VISION_DEFAULT,
    }),
    TEXT_DEFAULT
  );
});

test("resolveGroqModel: null overrides treated as unset", () => {
  assert.equal(
    resolveGroqModel({
      hasVision: false,
      textModelOverride: null,
      visionModelOverride: null,
      defaultTextModel: TEXT_DEFAULT,
      defaultVisionModel: VISION_DEFAULT,
    }),
    TEXT_DEFAULT
  );
});

test("resolveGroqModel: undefined overrides treated as unset", () => {
  assert.equal(
    resolveGroqModel({
      hasVision: true,
      textModelOverride: undefined,
      visionModelOverride: undefined,
      defaultTextModel: TEXT_DEFAULT,
      defaultVisionModel: VISION_DEFAULT,
    }),
    VISION_DEFAULT
  );
});

test("resolveGroqModel: override with surrounding whitespace is trimmed", () => {
  // Common copy-paste hazard in .env files.
  assert.equal(
    resolveGroqModel({
      hasVision: true,
      visionModelOverride: "  custom-vision  ",
      defaultTextModel: TEXT_DEFAULT,
      defaultVisionModel: VISION_DEFAULT,
    }),
    "custom-vision"
  );
});

test("resolveGroqModel: only the relevant override is consulted", () => {
  // Text turn: vision override must be completely ignored even if
  // the text override is unset.
  assert.equal(
    resolveGroqModel({
      hasVision: false,
      visionModelOverride: "custom-vision-should-NOT-be-used",
      defaultTextModel: TEXT_DEFAULT,
      defaultVisionModel: VISION_DEFAULT,
    }),
    TEXT_DEFAULT
  );
});

// ── Constants ───────────────────────────────────────────────────────────────

test("DEFAULT_PHOTO_PROMPT: is a non-empty string", () => {
  assert.equal(typeof DEFAULT_PHOTO_PROMPT, "string");
  assert.ok(DEFAULT_PHOTO_PROMPT.length > 20);
});

test("DEFAULT_PHOTO_PROMPT: mentions restaurant-relevant extractions", () => {
  // Lock the key terms so a future prompt refactor doesn't drift
  // toward "describe the picture" (which costs tokens without
  // producing actionable output for a stock manager).
  const lower = DEFAULT_PHOTO_PROMPT.toLowerCase();
  assert.ok(lower.includes("inventory") || lower.includes("stock"));
  assert.ok(lower.includes("receipt") || lower.includes("label"));
});
