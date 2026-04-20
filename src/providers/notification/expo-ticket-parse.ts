/**
 * Pure parsers for Expo Push Service response payloads.
 *
 * Expo's /push/send response has a deceptively nested shape:
 *
 *   { data: [ { status: "ok", id: "XXXX-YYYY-..." } ] }        // success
 *   { data: [ { status: "error", message: "...",               // error
 *               details: { error: "DeviceNotRegistered" } } ] }
 *
 * `data` may be an object (not an array) for some older API
 * responses, missing entirely on network errors, or an empty array.
 * This module extracts whatever useful signal we can coax out of
 * each shape — success→ticket id, error→flattened message —
 * without throwing, so the provider layer can reduce it all to a
 * clean "sent | failed" outcome.
 *
 * Extracted from expo-push.ts (which imports Prisma enums at
 * runtime) so the parse logic can be unit-tested without pulling in
 * the full provider stack.
 */

/**
 * Extract the ticket id from a successful Expo push response.
 * Returns undefined when:
 *   - `data` is missing or not an array
 *   - `data[0]` isn't an object
 *   - `data[0].id` isn't a string
 */
export function readExpoTicketId(
  payload: Record<string, unknown>
): string | undefined {
  if (!Array.isArray(payload.data)) {
    return undefined;
  }

  const firstEntry = payload.data[0];
  return firstEntry && typeof firstEntry === "object" && !Array.isArray(firstEntry)
    ? ((firstEntry as Record<string, unknown>).id as string | undefined)
    : undefined;
}

/**
 * Extract the error message from a failed Expo push response.
 * Returns null when the response isn't actually an error (e.g.
 * status is "ok", or data is missing/empty). When it IS an error,
 * returns a human-readable string combining `message` and the
 * nested `details.error` code — never null once we've confirmed
 * status === "error".
 */
export function readExpoTicketError(
  payload: Record<string, unknown>
): string | null {
  if (!Array.isArray(payload.data)) {
    return null;
  }

  const firstEntry = payload.data[0];
  if (!firstEntry || typeof firstEntry !== "object" || Array.isArray(firstEntry)) {
    return null;
  }

  const record = firstEntry as Record<string, unknown>;
  if (record.status !== "error") {
    return null;
  }

  const details =
    record.details && typeof record.details === "object" && !Array.isArray(record.details)
      ? record.details
      : null;
  const detailError: string | null =
    details && typeof (details as Record<string, unknown>).error === "string"
      ? ((details as Record<string, unknown>).error as string)
      : null;

  if (typeof record.message === "string" && record.message.trim()) {
    return detailError ? `${record.message} (${detailError})` : record.message;
  }

  return detailError ?? "Expo push delivery failed.";
}
