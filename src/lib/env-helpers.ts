/**
 * Pure parsing helpers for env.ts.
 *
 * env.ts reads process.env at module load, which is fine for
 * runtime but makes the module untestable (values are frozen at
 * first import). These helpers encode the actual transformation
 * logic so tests can exercise the edge cases — non-numeric strings,
 * negative numbers, trailing slashes on base URLs, etc. — without
 * rebooting the process.
 */

/**
 * Parse an env-style string into a positive number.
 *
 * Accepts "30000", "1.5", " 42 ". Rejects undefined, empty string,
 * "abc", "-5", "0", "NaN", "Infinity"-as-text (Number('Infinity') is
 * Infinity, which we explicitly reject because a config like
 * WORKER_POLL_MS=Infinity would starve the event loop).
 *
 * The fallback is returned for every rejected input — callers
 * should pass a sensible default.
 */
export function parsePositiveNumber(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Construct a webhook URL from an n8n base URL and a path segment.
 *
 * The base URL is expected to be of the form
 * "https://n8n.example.com" (no trailing slash) or
 * "https://n8n.example.com/" (trailing slash). Either gets
 * normalized so the joined URL is exactly one slash between base
 * and "webhook/".
 *
 * Returns undefined (not empty string, not the bare path) when the
 * base URL is missing or blank — callers treat that as "n8n isn't
 * configured" and typically fall back to a different URL.
 */
export function buildN8nWebhookUrl(
  baseUrl: string | undefined,
  path: string
): string | undefined {
  if (!baseUrl?.trim()) {
    return undefined;
  }
  return `${baseUrl.replace(/\/$/, "")}/webhook/${path}`;
}
