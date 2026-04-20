/**
 * Pure primitives for the supplier-nudges worker (`./supplier-nudges`).
 *
 * Nothing in this file touches the database, the network, or time —
 * every helper takes the clock (`now`) as an argument. Keeps the
 * `runSupplierNudges()` orchestration thin and lets us unit-test the
 * branching / copy / metadata logic without spinning up Prisma.
 */

/**
 * Number of hours an outbound supplier email has to wait without a
 * reply before we send a follow-up "where's my order?" message.
 */
export const NUDGE_AFTER_HOURS = 24;

/**
 * Extra slack beyond `leadTimeDays` before we prompt the manager to
 * confirm a delivery arrived. Giving the supplier the full lead-time
 * PLUS a small buffer avoids spamming about orders that just landed
 * a bit later than the quoted window.
 */
export const LATE_DELIVERY_BUFFER_HOURS = 2;

/** Default supplier lead time when the supplier record has no value. */
export const DEFAULT_LEAD_TIME_DAYS = 2;

// ── Metadata marker guards ──────────────────────────────────────────
// Supplier-comm + PO records carry a free-form Json `metadata` field.
// We stamp a timestamp string on it once a nudge has fired so we don't
// repeat. The guards below accept whatever blob lives there and
// answer one question: "have we already done this?"

export type MetadataBlob = Record<string, unknown> | null | undefined;

export function isReplyNudgeAlreadySent(metadata: MetadataBlob): boolean {
  if (!metadata) return false;
  const value = (metadata as Record<string, unknown>).nudgeSentAt;
  return typeof value === "string" && value.length > 0;
}

export function isLateDeliveryPromptAlreadySent(
  metadata: MetadataBlob
): boolean {
  if (!metadata) return false;
  const value = (metadata as Record<string, unknown>)
    .lateDeliveryPromptSentAt;
  return typeof value === "string" && value.length > 0;
}

/**
 * Returns the metadata blob with a `nudgeSentAt` stamp added. Does
 * not mutate the input — caller writes the result to the DB.
 */
export function markReplyNudgeSent(
  metadata: MetadataBlob,
  now: Date
): Record<string, unknown> {
  const base = (metadata ?? {}) as Record<string, unknown>;
  return { ...base, nudgeSentAt: now.toISOString() };
}

export function markLateDeliveryPromptSent(
  metadata: MetadataBlob,
  now: Date
): Record<string, unknown> {
  const base = (metadata ?? {}) as Record<string, unknown>;
  return { ...base, lateDeliveryPromptSentAt: now.toISOString() };
}

// ── Time math ───────────────────────────────────────────────────────

/**
 * The earliest `createdAt` value a SENT outbound communication can
 * have for us to treat it as "overdue for a reply". Everything newer
 * than this is still within the normal response window.
 */
export function computeStuckReplyCutoff(now: Date): Date {
  return new Date(now.getTime() - NUDGE_AFTER_HOURS * 60 * 60 * 1000);
}

export function computeLeadHours(
  leadTimeDays: number | null | undefined,
  bufferHours: number = LATE_DELIVERY_BUFFER_HOURS
): number {
  const days =
    typeof leadTimeDays === "number" && leadTimeDays > 0
      ? leadTimeDays
      : DEFAULT_LEAD_TIME_DAYS;
  return days * 24 + bufferHours;
}

export function computeHoursSinceSent(
  sentAt: Date | null | undefined,
  now: Date
): number | null {
  if (!sentAt) return null;
  const diffMs = now.getTime() - sentAt.getTime();
  if (diffMs < 0) return 0; // clock skew — treat as "just sent"
  return diffMs / (60 * 60 * 1000);
}

/**
 * True when a SENT/ACKNOWLEDGED PO has been in-flight longer than the
 * supplier's lead time + buffer and is ready for a "did it arrive?"
 * ping. Returns false if `sentAt` is missing (defensive).
 */
export function isLateDeliveryReady(input: {
  sentAt: Date | null | undefined;
  leadTimeDays: number | null | undefined;
  now: Date;
  bufferHours?: number;
}): boolean {
  const hours = computeHoursSinceSent(input.sentAt, input.now);
  if (hours == null) return false;
  const threshold = computeLeadHours(input.leadTimeDays, input.bufferHours);
  return hours >= threshold;
}

// ── Copy builders: stuck-reply email ────────────────────────────────

/**
 * The subject a follow-up nudge reply should carry. Prefixes `Re:` so
 * Gmail threads it under the original outbound. Falls back to a
 * synthetic subject keyed by orderNumber when we didn't capture one.
 */
export function buildStuckReplySubject(input: {
  originalSubject: string | null | undefined;
  orderNumber: string;
}): string {
  const base =
    input.originalSubject && input.originalSubject.trim().length > 0
      ? input.originalSubject
      : `Purchase Order ${input.orderNumber}`;
  return `Re: ${base}`;
}

/**
 * Preferred greeting name: the supplier contact's first-line string
 * (trimmed), falling back to the supplier's business name if contact
 * is missing or whitespace-only.
 */
export function buildStuckReplyGreeting(input: {
  contactName: string | null | undefined;
  supplierName: string;
}): string {
  const trimmed = input.contactName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : input.supplierName;
}

/**
 * "{Business name} — {Location name}" sign-off line, with either
 * half omitted if missing. Returns empty string if both are empty so
 * the caller can fall back to a generic "the team" signature.
 */
export function buildStuckReplyBusinessLine(input: {
  businessName: string | null | undefined;
  locationName: string | null | undefined;
}): string {
  return [input.businessName, input.locationName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(" — ");
}

export function buildStuckReplyTextBody(input: {
  greeting: string;
  orderNumber: string;
  businessLine: string;
}): string {
  const sign = input.businessLine || "the team";
  return (
    `Hi ${input.greeting},\n\n` +
    `Just checking in on order *${input.orderNumber}* — when should I expect it? ` +
    `If anything's short or back-ordered, let me know what you can substitute and I'll adjust.\n\n` +
    `Thanks,\n${sign}`
  );
}

export function buildStuckReplyHtmlBody(input: {
  greeting: string;
  orderNumber: string;
  businessLine: string;
}): string {
  const sign = input.businessLine || "the team";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827">
      <table width="100%" cellspacing="0" cellpadding="0" border="0" style="padding:24px 12px"><tr><td align="center">
        <table width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;padding:24px 28px">
          <tr><td style="font-size:15px;line-height:1.55">
            <p style="margin:0 0 12px 0">Hi ${escapeHtml(input.greeting)},</p>
            <p style="margin:0 0 14px 0">Just checking in on order <b>${escapeHtml(input.orderNumber)}</b> — when should I expect it? If anything's short or back-ordered, let me know what you can substitute and I'll adjust.</p>
            <p style="margin:0 0 4px 0">Thanks,</p>
            <p style="margin:0;font-weight:600">${escapeHtml(sign)}</p>
          </td></tr>
        </table>
      </td></tr></table>
    </body></html>`;
}

// ── Copy builders: late-delivery Telegram ping ──────────────────────

export type TelegramKeyboard = Array<
  Array<{ text: string; callback_data: string }>
>;

export function buildLateDeliveryMessage(input: {
  orderNumber: string;
  supplierName: string;
}): string {
  return (
    `📦 *${input.orderNumber}* from *${input.supplierName}* should have arrived by now.\n\n` +
    `Did the delivery come in? Tap below to close the loop.`
  );
}

export function buildLateDeliveryKeyboard(
  purchaseOrderId: string
): TelegramKeyboard {
  return [
    [
      {
        text: "✅ Yes — delivered",
        callback_data: `po_delivered:${purchaseOrderId}`,
      },
      {
        text: "⏰ Still waiting",
        callback_data: `po_snooze_delivery:${purchaseOrderId}`,
      },
    ],
  ];
}

// ── HTML escape (local to this module; email-template.ts owns its own) ─

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
