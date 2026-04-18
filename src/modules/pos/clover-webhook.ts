/**
 * Pure mapper: Clover webhook event-type → internal sync-job enum.
 * Mirrors the Square-webhook mapper; kept separate because Clover's
 * event-type strings are single-char codes (I/O/M/...) that are wildly
 * different from Square's dotted strings.
 *
 * Clover webhook payload:
 *   {
 *     appId: "...",
 *     merchants: {
 *       "<merchantId>": [
 *         { objectId: "I:abc", type: "UPDATE", ts: 1234567 }
 *       ]
 *     }
 *   }
 *
 * The prefix before `:` in objectId identifies the Clover object class:
 *   I = Inventory (items, categories, modifiers, tax rates)
 *   O = Orders (line items, discounts, payments on an order)
 *   P = Payments
 *   C = Customers
 *   E = Employees
 *   M = Merchant
 *   A = App (installed/uninstalled)
 *
 * We care about I (catalog) and O/P (sales). Everything else is ignored.
 */

export type CloverSyncJobType = "SYNC_CATALOG" | "SYNC_SALES";

export function getCloverWebhookJobType(
  objectId?: string | null
): CloverSyncJobType | null {
  const prefix = objectId?.trim().split(":")[0]?.toUpperCase();
  if (!prefix) return null;
  if (prefix === "I") return "SYNC_CATALOG";
  if (prefix === "O" || prefix === "P") return "SYNC_SALES";
  return null;
}

/**
 * Flatten Clover's nested merchants object into a flat list of events.
 * Most Clover webhooks batch multiple object changes for a single
 * merchant into one POST — enqueuing per-object-change is overkill, so
 * this deduplicates by job type so we enqueue at most one SYNC_CATALOG
 * and one SYNC_SALES job per webhook per merchant.
 */
export function extractCloverEvents(payload: unknown): Array<{
  merchantId: string;
  jobType: CloverSyncJobType;
  objectId: string;
}> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  const merchants = (payload as { merchants?: unknown }).merchants;
  if (!merchants || typeof merchants !== "object" || Array.isArray(merchants)) {
    return [];
  }

  const events: Array<{
    merchantId: string;
    jobType: CloverSyncJobType;
    objectId: string;
  }> = [];
  const seen = new Set<string>();

  for (const [merchantId, rawEntries] of Object.entries(
    merchants as Record<string, unknown>
  )) {
    if (!Array.isArray(rawEntries)) continue;
    for (const entry of rawEntries) {
      if (!entry || typeof entry !== "object") continue;
      const objectId = (entry as { objectId?: string }).objectId;
      if (!objectId) continue;
      const jobType = getCloverWebhookJobType(objectId);
      if (!jobType) continue;
      const key = `${merchantId}:${jobType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ merchantId, jobType, objectId });
    }
  }

  return events;
}
