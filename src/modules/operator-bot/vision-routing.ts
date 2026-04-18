/**
 * Pure helpers for the multimodal side of the bot agent.
 *
 * Extracted from agent.ts (which imports DB / env / provider code
 * and can't be unit-tested in isolation) so we can lock the
 * Scout ↔ Maverick routing decision and the multimodal content-part
 * builder with node:test.
 *
 * All functions here are side-effect free.
 */

// ── OpenAI-compatible Groq message shapes ──────────────────────────────────

export type GroqToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/**
 * Groq's vision models (Llama 4 Scout / Maverick) accept the full
 * OpenAI multimodal `content` shape: either a plain string or an
 * array of typed parts. We only use the two parts we need —
 * `text` for the caption / default prompt, and `image_url` for a
 * base64 data URL.
 */
export type GroqContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type GroqMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | GroqContentPart[] | null;
  tool_calls?: GroqToolCall[];
  tool_call_id?: string;
  name?: string;
};

// ── Default prompt for caption-less photos ─────────────────────────────────

/**
 * What we substitute when a user sends a bare photo without a
 * caption. The default nudges the model toward restaurant-relevant
 * extraction (receipt / label / shelf) rather than a generic
 * "nice picture!" reply.
 *
 * Exported so tests can regression-lock the exact phrasing (changing
 * this affects token usage + model behaviour).
 */
export const DEFAULT_PHOTO_PROMPT =
  "What's in this photo? If it's inventory, a receipt, or a product label, tell me what you see and offer to update stock or log it.";

// ── Content-part builder ───────────────────────────────────────────────────

/**
 * Build the `content` field for a user turn.
 *
 * Text-only turns stay a plain string so we don't bloat token
 * counts or shift telemetry on traffic that never needed vision.
 *
 * When images are attached, emit the multimodal array with the
 * caption (or the default prompt) first, followed by one
 * `image_url` part per image — matches the order Llama / OpenAI
 * vision docs recommend.
 */
export function buildUserContent(
  text: string,
  images?: string[]
): string | GroqContentPart[] {
  if (!images || images.length === 0) return text;
  const caption = text.trim() ? text : DEFAULT_PHOTO_PROMPT;
  return [
    { type: "text", text: caption },
    ...images.map((url) => ({
      type: "image_url" as const,
      image_url: { url },
    })),
  ];
}

// ── Vision-model routing ───────────────────────────────────────────────────

/**
 * True when any message on the wire carries the multimodal array
 * form with at least one `image_url` part. Drives the Scout →
 * Maverick swap in callGroq so vision gets the stronger Llama 4
 * without slowing down text-only traffic.
 *
 * History with old images has already been stripped upstream — only
 * the latest user turn ever gets images attached — so this is a
 * cheap O(messages + parts) walk.
 */
export function hasVisionContent(messages: GroqMessage[]): boolean {
  for (const m of messages) {
    if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === "image_url") return true;
      }
    }
  }
  return false;
}

/**
 * Resolve the Groq model id for a turn.
 *
 * Text turns:   GROQ_BOT_MODEL         || Scout  (fast, cheap)
 * Vision turns: GROQ_BOT_VISION_MODEL  || Maverick (stronger vision)
 *
 * Pure for testability — env is passed in rather than read here.
 */
export function resolveGroqModel(input: {
  hasVision: boolean;
  textModelOverride?: string | null;
  visionModelOverride?: string | null;
  defaultTextModel: string;
  defaultVisionModel: string;
}): string {
  if (input.hasVision) {
    const override = input.visionModelOverride?.trim();
    if (override) return override;
    return input.defaultVisionModel;
  }
  const override = input.textModelOverride?.trim();
  if (override) return override;
  return input.defaultTextModel;
}
