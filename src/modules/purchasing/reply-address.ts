// Builds the Reply-To address for outbound PO emails so supplier
// replies flow into our inbound-email webhook instead of the user's
// Gmail inbox. Without REPLY_DOMAIN configured, returns null and
// the caller falls back to the user's own mailbox (legacy path).
//
// Format: reply+<purchaseOrderId>@<REPLY_DOMAIN>
//
// The "reply+" prefix plus the PO id as a subaddress means a single
// verified domain + a single MX record can route every supplier's
// reply correctly. `/api/inbound/email` parses the local-part back
// into the PO id and re-attaches the reply on the same PO.

import { env } from "../../lib/env";

export function buildSupplierReplyAddress(
  purchaseOrderId: string | null | undefined
): string | null {
  if (!purchaseOrderId) return null;
  if (!env.REPLY_DOMAIN || env.REPLY_DOMAIN.trim().length === 0) return null;
  return `reply+${purchaseOrderId}@${env.REPLY_DOMAIN.trim()}`;
}

// Pulls the PO id out of an inbound recipient address matching the
// format above. Returns null if the address doesn't belong to us.
// Accepts raw header values like `"Replies <reply+abc@example.com>"`
// by stripping angle-bracket wrappers first.
export function parsePurchaseOrderIdFromReplyAddress(
  recipient: string | null | undefined
): string | null {
  if (!recipient) return null;
  const angleMatch = recipient.match(/<([^>]+)>/);
  const email = (angleMatch?.[1] ?? recipient).trim().toLowerCase();

  const domain = env.REPLY_DOMAIN?.trim().toLowerCase();
  if (!domain) return null;

  const [localPart, addrDomain] = email.split("@");
  if (!localPart || !addrDomain) return null;
  if (addrDomain !== domain) return null;
  if (!localPart.startsWith("reply+")) return null;

  const poId = localPart.slice("reply+".length);
  if (!poId) return null;
  // Prisma cuid()s are lowercase alphanumeric — tolerant match.
  if (!/^[a-z0-9]{10,50}$/.test(poId)) return null;
  return poId;
}
