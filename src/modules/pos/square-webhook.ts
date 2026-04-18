/**
 * Pure mapper: Square Webhook event-type string → our internal
 * sync-job enum. Extracted from service.ts so it can be unit-tested
 * without loading the full POS service (which imports db, providers,
 * Prisma client).
 *
 * Square fires one HTTP POST per change with an `event_type` string
 * like "catalog.version.updated" or "order.created". We queue a job
 * in response:
 *
 *   catalog.* / item.* / category.*  → SYNC_CATALOG (re-pull catalog)
 *   order.*   / payment.* / refund.*  → SYNC_SALES   (re-pull recent sales)
 *   anything else (labor.shift.*, etc.) → null (ignore)
 *
 * Case-insensitive. Whitespace tolerated. Empty / nullish input
 * always returns null — never throws.
 */

export type SquareSyncJobType = "SYNC_CATALOG" | "SYNC_SALES";

export function getSquareWebhookJobType(
  eventType?: string | null
): SquareSyncJobType | null {
  const normalized = eventType?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (
    normalized.startsWith("catalog.") ||
    normalized.startsWith("item.") ||
    normalized.startsWith("category.")
  ) {
    return "SYNC_CATALOG";
  }

  if (
    normalized.startsWith("order.") ||
    normalized.startsWith("payment.") ||
    normalized.startsWith("refund.")
  ) {
    return "SYNC_SALES";
  }

  return null;
}
