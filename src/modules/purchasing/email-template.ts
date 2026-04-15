/**
 * Builds a professional HTML purchase-order email with a sensible
 * plain-text fallback. Keeps formatting deterministic so suppliers
 * always see the same structure (subject + greeting + line table +
 * delivery date + reply instruction + signature).
 *
 * Why deterministic over AI:
 *   - Suppliers parse PO emails by pattern. AI free-styling produces
 *     subtly different shapes each time, which trips up their
 *     workflows.
 *   - Email clients render HTML tables much more legibly than the
 *     "- item: 5 units" plain-text bullet we used before.
 *   - We can guarantee critical info (PO number, totals, our reply
 *     address) is present.
 */

export type SupplierOrderEmailLine = {
  description: string;
  quantity: number;
  unit: string;
  notes?: string | null;
};

export type SupplierOrderEmailInput = {
  supplierName: string;
  /** Greeting recipient — defaults to supplierName. Use "Sales team" etc. when unknown. */
  contactName?: string | null;
  /** The cafe / restaurant placing the order. */
  businessName: string;
  /** Specific location, when the business has multiple. */
  locationName?: string | null;
  /** Optional street address for the delivery destination. */
  locationAddress?: string | null;
  orderNumber: string;
  /** Who pressed Approve, e.g. "Sobhan Bhandari" or "the StockPilot bot on behalf of <name>". */
  orderedByName?: string | null;
  /** Reply-to + sender display, e.g. "sobhan2034@gmail.com". */
  replyToEmail: string;
  lines: SupplierOrderEmailLine[];
  /** ISO date or human string. Falls back to "as soon as possible". */
  requestedDeliveryDate?: string | null;
  /** Optional free-text note (PO terms, special instructions). */
  notes?: string | null;
};

export type SupplierOrderEmail = {
  subject: string;
  /** Plain-text body — used as the .text alternative and as fallback storage. */
  text: string;
  /** Rich HTML body — what suppliers see in Gmail / Outlook. */
  html: string;
};

export function buildSupplierOrderEmail(
  input: SupplierOrderEmailInput
): SupplierOrderEmail {
  const greetingName =
    (input.contactName?.trim() ||
      humanizeSupplierName(input.supplierName)) ?? "team";
  const businessLine = input.locationName
    ? `${input.businessName} — ${input.locationName}`
    : input.businessName;
  const requestedBy = (input.requestedDeliveryDate ?? "").trim() ||
    "as soon as you're able";
  const orderedBy =
    (input.orderedByName ?? "").trim() ||
    `the ${input.businessName} team`;

  const subject = `Purchase Order ${input.orderNumber} — ${input.businessName}`;

  // ── Plain-text version ─────────────────────────────────────────
  const textLines = input.lines
    .map((line, idx) => {
      const qty = `${line.quantity} ${line.unit}`.trim();
      const notes = line.notes ? ` (${line.notes})` : "";
      return `  ${idx + 1}. ${line.description} — ${qty}${notes}`;
    })
    .join("\n");

  const text =
    `Hi ${greetingName},\n\n` +
    `Please confirm the following purchase order from ${businessLine}:\n\n` +
    `Order number: ${input.orderNumber}\n` +
    `Requested delivery: ${requestedBy}\n\n` +
    `Items\n${textLines}\n\n` +
    (input.notes ? `Notes: ${input.notes}\n\n` : "") +
    `Please reply to this email to confirm pricing, availability, and the delivery window. ` +
    `If anything is short or back-ordered, let us know what you can substitute.\n\n` +
    `Thanks,\n${orderedBy}\n${businessLine}\n${input.replyToEmail}`;

  // ── HTML version ───────────────────────────────────────────────
  const rowsHtml = input.lines
    .map((line, idx) => {
      const qty = `${escapeHtml(String(line.quantity))} ${escapeHtml(line.unit)}`;
      const notes = line.notes
        ? `<div style="color:#6b7280;font-size:13px;margin-top:2px">${escapeHtml(
            line.notes
          )}</div>`
        : "";
      const zebra = idx % 2 === 0 ? "#ffffff" : "#fafafa";
      return `
        <tr style="background:${zebra}">
          <td style="padding:12px 16px;border-bottom:1px solid #eef0f3;color:#6b7280;font-variant-numeric:tabular-nums;width:36px">${
        idx + 1
      }</td>
          <td style="padding:12px 16px;border-bottom:1px solid #eef0f3;color:#111827;font-weight:500">
            ${escapeHtml(line.description)}
            ${notes}
          </td>
          <td style="padding:12px 16px;border-bottom:1px solid #eef0f3;color:#111827;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap">${qty}</td>
        </tr>`;
    })
    .join("");

  const notesBlock = input.notes
    ? `<div style="margin-top:24px;padding:12px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#78350f;font-size:14px">
         <strong style="font-weight:600">Note:</strong> ${escapeHtml(input.notes)}
       </div>`
    : "";

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;-webkit-font-smoothing:antialiased">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f3f4f6;padding:32px 12px">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,0.04),0 8px 24px rgba(17,24,39,0.06);overflow:hidden">
            <tr>
              <td style="padding:28px 32px 8px 32px">
                <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;font-weight:600">Purchase Order</div>
                <div style="margin-top:6px;font-size:24px;font-weight:600;color:#111827">${escapeHtml(
                  input.orderNumber
                )}</div>
                <div style="margin-top:2px;font-size:14px;color:#6b7280">From ${escapeHtml(
                  businessLine
                )}</div>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 32px 0 32px;font-size:15px;line-height:1.55;color:#111827">
                <p style="margin:0 0 12px 0">Hi ${escapeHtml(greetingName)},</p>
                <p style="margin:0 0 16px 0">Please confirm the order below. Reply to this email with availability, pricing, and the delivery date you can commit to.</p>
              </td>
            </tr>

            <tr>
              <td style="padding:8px 32px 0 32px">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border:1px solid #e5e7eb;border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden">
                  <thead>
                    <tr style="background:#f9fafb">
                      <th style="padding:10px 16px;text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb">#</th>
                      <th style="padding:10px 16px;text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb">Item</th>
                      <th style="padding:10px 16px;text-align:right;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rowsHtml}
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 32px 0 32px">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="font-size:14px;color:#111827">
                  <tr>
                    <td style="padding:6px 0;color:#6b7280;width:160px">Requested delivery</td>
                    <td style="padding:6px 0;font-weight:500">${escapeHtml(requestedBy)}</td>
                  </tr>
                  ${
                    input.locationAddress
                      ? `<tr>
                    <td style="padding:6px 0;color:#6b7280">Deliver to</td>
                    <td style="padding:6px 0;font-weight:500">${escapeHtml(
                      input.locationAddress
                    )}</td>
                  </tr>`
                      : ""
                  }
                  <tr>
                    <td style="padding:6px 0;color:#6b7280">Reply to</td>
                    <td style="padding:6px 0;font-weight:500"><a href="mailto:${escapeAttr(
                      input.replyToEmail
                    )}" style="color:#2563eb;text-decoration:none">${escapeHtml(
    input.replyToEmail
  )}</a></td>
                  </tr>
                </table>
                ${notesBlock}
              </td>
            </tr>

            <tr>
              <td style="padding:24px 32px 28px 32px;font-size:14px;line-height:1.55;color:#111827">
                <p style="margin:0 0 4px 0">Thanks,</p>
                <p style="margin:0;font-weight:600">${escapeHtml(orderedBy)}</p>
                <p style="margin:2px 0 0 0;color:#6b7280">${escapeHtml(businessLine)}</p>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 32px 22px 32px;border-top:1px solid #f1f5f9;font-size:12px;color:#9ca3af">
                Sent via StockPilot. Replies go straight to ${escapeHtml(input.replyToEmail)}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

function humanizeSupplierName(name: string): string {
  // "FreshCo Produce LLC" → "FreshCo Produce" team
  const trimmed = name
    .replace(/\b(LLC|Inc\.?|Ltd\.?|Pty|GmbH|Corp\.?|Co\.?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return trimmed ? `${trimmed} team` : "team";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
