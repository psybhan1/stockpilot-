import { env } from "./env";

export type SendWhatsAppOptions = {
  /**
   * Twilio Content SID of a pre-approved WhatsApp Content Template
   * with Quick Reply buttons. When set, Twilio uses this template
   * instead of the raw text body (text becomes the fallback preview).
   * Requires a template approved by Meta.
   */
  contentSid?: string;
  /** Variables substituted into the approved template body. */
  contentVariables?: Record<string, string>;
};

/**
 * Send a WhatsApp message proactively via the Twilio REST API.
 * Used for outbound notifications (alerts, order approvals) and bot
 * replies outside of a TwiML response window.
 *
 * `to` can be a plain E.164 number (+14155551234) or already prefixed
 * with "whatsapp:" — both are normalised automatically.
 *
 * When options.contentSid is provided, uses Twilio's Content API so
 * the message can include Quick Reply buttons (requires a Meta-
 * approved template). Without it, falls back to plain text — the
 * conversation path still works because the bot agent understands
 * plain-language "approve" / "cancel" replies via its tools.
 */
export async function sendWhatsAppMessage(
  to: string,
  text: string,
  options?: SendWhatsAppOptions
) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM } = env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM) {
    return { ok: false, skipped: true, reason: "Missing Twilio credentials" };
  }

  const from = normalizeWhatsAppAddress(TWILIO_WHATSAPP_FROM);
  const toAddress = normalizeWhatsAppAddress(to);

  const params = new URLSearchParams({ From: from, To: toAddress });

  if (options?.contentSid) {
    // Use pre-approved Content Template (can include Quick Reply buttons).
    params.set("ContentSid", options.contentSid);
    if (options.contentVariables) {
      params.set("ContentVariables", JSON.stringify(options.contentVariables));
    }
    // Body still required as a fallback for clients that can't render
    // interactive messages.
    params.set("Body", text);
  } else {
    params.set("Body", text);
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    }
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(
      payload.message ?? `Twilio WhatsApp send failed with status ${response.status}`
    );
  }

  const payload = (await response.json()) as { sid?: string };
  return { ok: true, skipped: false, sid: payload.sid };
}

/**
 * Download a Twilio media file (voice note, image, etc.) as an ArrayBuffer.
 * Twilio media URLs require HTTP Basic auth using account credentials.
 */
export async function downloadTwilioMedia(mediaUrl: string): Promise<ArrayBuffer | null> {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;

  try {
    const response = await fetch(mediaUrl, {
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`
        ).toString("base64")}`,
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * Transcribe a WhatsApp voice note (OGG/MP4/AMR) via Groq Whisper.
 * Returns the transcribed text, or null if transcription fails.
 */
export async function transcribeWhatsAppVoice(
  mediaUrl: string,
  contentType: string
): Promise<string | null> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return null;

  const audioBuffer = await downloadTwilioMedia(mediaUrl);
  if (!audioBuffer) return null;

  const ext = contentTypeToWhisperExtension(contentType);

  const audioBlob = new Blob([audioBuffer], { type: contentType });

  const formData = new FormData();
  formData.append("file", audioBlob, `voice.${ext}`);
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("response_format", "json");

  try {
    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}` },
      body: formData,
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { text?: string };
    return data.text?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Check whether a Twilio media content-type is one the vision model
 * can actually interpret. We accept the four web-image MIMEs —
 * Llama 4 Scout rejects everything else and we'd rather tell the
 * user than silently drop the image.
 */
export function isSupportedImageContentType(contentType: string): boolean {
  const c = contentType.toLowerCase().split(";")[0].trim();
  return (
    c === "image/jpeg" ||
    c === "image/jpg" ||
    c === "image/png" ||
    c === "image/webp" ||
    c === "image/gif"
  );
}

/**
 * Canonicalise a media content-type to the form the vision model
 * expects in the data-URL prefix. Twilio sometimes sends `image/jpg`
 * which is non-standard; Llama wants `image/jpeg`.
 */
export function canonicalImageMime(contentType: string): string {
  const c = contentType.toLowerCase().split(";")[0].trim();
  if (c === "image/jpg") return "image/jpeg";
  return c;
}

/**
 * Download a Twilio media URL and return it as a base64 `data:`
 * URL suitable for inlining into a Groq / OpenAI `image_url`
 * content part. Returns null on any failure so the caller falls
 * back to text-only.
 */
export async function downloadTwilioMediaAsDataUrl(
  mediaUrl: string,
  contentType: string
): Promise<string | null> {
  const buffer = await downloadTwilioMedia(mediaUrl);
  if (!buffer) return null;
  const mime = canonicalImageMime(contentType);
  const b64 = Buffer.from(buffer).toString("base64");
  return `data:${mime};base64,${b64}`;
}

/**
 * Normalise to the exact `whatsapp:<number>` form Twilio requires.
 *
 * Twilio rejects any variant casing ("WhatsApp:", "WHATSAPP:") — it
 * wants lowercase. We strip whatever prefix is present case-
 * insensitively, trim internal whitespace, then re-prefix. A previous
 * version preserved the incoming case, which meant values like
 * "WhatsApp:+1…" from stale DB rows would go out to Twilio and 400
 * back.
 */
export function normalizeWhatsAppAddress(value: string): string {
  const stripped = value.trim().replace(/^whatsapp:\s*/i, "");
  return `whatsapp:${stripped}`;
}

/**
 * Map a Twilio media content-type to the best-matching file extension
 * Groq Whisper accepts. Whisper validates the filename extension, so
 * using the wrong one (e.g. `.mp4` for an MP3 stream) causes the
 * request to fail even when the audio itself is fine.
 *
 * Supported by Whisper: mp3, mp4, mpeg, mpga, m4a, wav, webm, ogg,
 * flac. amr is not supported — we pass it through anyway so Groq's
 * error is clear instead of being masked by a wrong extension.
 */
export function contentTypeToWhisperExtension(contentType: string): string {
  const c = contentType.toLowerCase();
  if (c.includes("ogg") || c.includes("opus")) return "ogg";
  if (c.includes("mp3") || c.includes("mpeg") || c.includes("mpga")) return "mp3";
  if (c.includes("m4a")) return "m4a";
  if (c.includes("mp4")) return "mp4";
  if (c.includes("wav")) return "wav";
  if (c.includes("webm")) return "webm";
  if (c.includes("flac")) return "flac";
  if (c.includes("amr")) return "amr";
  return "ogg";
}
