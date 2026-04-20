/**
 * Weekly exec digest — called Monday morning by n8n (or any cron).
 * Composes a single email per location summarising the past week's
 * inventory operations and sends it to every paired manager from
 * the location's connected Gmail. Falls back silently when the
 * Gmail channel isn't connected.
 *
 * Returns JSON describing what was sent so n8n can surface it in
 * an execution log.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyN8nRequest } from "@/modules/automation/n8n-auth";
import { getAnalyticsOverview } from "@/modules/analytics/queries";
import { GmailEmailProvider } from "@/providers/email/gmail-email";

export async function GET(request: NextRequest) {
  const auth = await verifyN8nRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ message: auth.reason }, { status: 401 });
  }

  const locations = await db.location.findMany({
    select: {
      id: true,
      name: true,
      business: { select: { name: true } },
      roles: {
        where: {
          user: { email: { not: { startsWith: "demo-" } } },
        },
        select: { user: { select: { email: true, name: true } } },
      },
    },
  });

  const results: Array<{
    locationId: string;
    locationName: string;
    sent: boolean;
    recipients: number;
    reason?: string;
  }> = [];

  for (const location of locations) {
    try {
      const overview = await getAnalyticsOverview(location.id);
      const recipients = Array.from(
        new Set(location.roles.map((r) => r.user.email).filter(Boolean))
      );
      if (recipients.length === 0) {
        results.push({
          locationId: location.id,
          locationName: location.name,
          sent: false,
          recipients: 0,
          reason: "no recipients",
        });
        continue;
      }

      const html = renderDigestHtml({
        businessName: location.business?.name ?? "Your café",
        locationName: location.name,
        overview,
      });
      const text = renderDigestText({
        businessName: location.business?.name ?? "Your café",
        locationName: location.name,
        overview,
      });
      const subject = `Weekly inventory digest · ${location.name} · ${new Date().toLocaleDateString()}`;

      const provider = new GmailEmailProvider(location.id);
      let anySent = false;
      for (const to of recipients) {
        try {
          await provider.sendNotification({
            channel: "EMAIL" as never,
            recipient: to,
            subject,
            body: text,
            html,
          });
          anySent = true;
        } catch (err) {
          console.warn(`[weekly-digest] send to ${to} failed:`, err);
        }
      }
      results.push({
        locationId: location.id,
        locationName: location.name,
        sent: anySent,
        recipients: recipients.length,
        reason: anySent ? undefined : "all sends failed (Gmail not connected?)",
      });
    } catch (err) {
      console.error(`[weekly-digest] location ${location.id} failed:`, err);
      results.push({
        locationId: location.id,
        locationName: location.name,
        sent: false,
        recipients: 0,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ ok: true, results });
}

function renderDigestText(input: {
  businessName: string;
  locationName: string;
  overview: Awaited<ReturnType<typeof getAnalyticsOverview>>;
}): string {
  const { overview } = input;
  const spend = (overview.totalSpendCents / 100).toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  });
  const lines = [
    `Weekly digest for ${input.businessName} — ${input.locationName}`,
    "",
    `Orders sent: ${overview.ordersSent}`,
    `Confirmed by suppliers: ${overview.ordersConfirmed}`,
    `Out-of-stock replies: ${overview.ordersOutOfStock}`,
    `Auto-rescues triggered: ${overview.rescueOrders}`,
    `Total spend (confirmed lines): ${spend}`,
    overview.averageReplyHours != null
      ? `Avg supplier reply: ${overview.averageReplyHours.toFixed(1)}h`
      : `Avg supplier reply: —`,
    "",
    `Top suppliers this week:`,
    ...overview.topSuppliers.slice(0, 5).map(
      (s) =>
        `  • ${s.name}: ${s.totalOrders} order${s.totalOrders === 1 ? "" : "s"}, ` +
        `${Math.round(s.confirmRate * 100)}% confirm rate`
    ),
    "",
    `Top reordered items:`,
    ...overview.topItems.slice(0, 5).map(
      (i) =>
        `  • ${i.name}: ${i.orderCount} order${i.orderCount === 1 ? "" : "s"}, ` +
        `${i.totalQuantityOrdered} ${i.unit} total`
    ),
  ];
  return lines.join("\n");
}

function renderDigestHtml(input: {
  businessName: string;
  locationName: string;
  overview: Awaited<ReturnType<typeof getAnalyticsOverview>>;
}): string {
  const { overview } = input;
  const spend = (overview.totalSpendCents / 100).toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  });
  const suppliers = overview.topSuppliers
    .slice(0, 5)
    .map(
      (s) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0ece4">${escapeHtml(s.name)}</td>` +
        `<td style="padding:8px 12px;border-bottom:1px solid #f0ece4;text-align:right;font-variant-numeric:tabular-nums">${s.totalOrders}</td>` +
        `<td style="padding:8px 12px;border-bottom:1px solid #f0ece4;text-align:right;font-variant-numeric:tabular-nums">${Math.round(s.confirmRate * 100)}%</td></tr>`
    )
    .join("");
  const items = overview.topItems
    .slice(0, 5)
    .map(
      (i) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0ece4">${escapeHtml(i.name)}</td>` +
        `<td style="padding:8px 12px;border-bottom:1px solid #f0ece4;text-align:right;font-variant-numeric:tabular-nums">${i.orderCount}</td>` +
        `<td style="padding:8px 12px;border-bottom:1px solid #f0ece4;text-align:right;color:#6b7280">${i.totalQuantityOrdered} ${escapeHtml(i.unit)}</td></tr>`
    )
    .join("");
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827">
  <table width="100%" cellspacing="0" cellpadding="0" border="0" style="padding:32px 12px"><tr><td align="center">
    <table width="640" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#fff;border-radius:14px;overflow:hidden">
      <tr><td style="padding:28px 32px 4px 32px">
        <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;font-weight:600">Weekly digest</div>
        <div style="margin-top:6px;font-size:22px;font-weight:600">${escapeHtml(input.businessName)} — ${escapeHtml(input.locationName)}</div>
      </td></tr>
      <tr><td style="padding:20px 32px 0 32px">
        <table width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #e5e7eb;border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden">
          <tr>
            <th style="padding:10px 12px;text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb">Metric</th>
            <th style="padding:10px 12px;text-align:right;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb">Last 30d</th>
          </tr>
          ${row("Orders sent", overview.ordersSent.toString())}
          ${row("Confirmed by suppliers", overview.ordersConfirmed.toString())}
          ${row("Out of stock", overview.ordersOutOfStock.toString())}
          ${row("Auto-rescues", overview.rescueOrders.toString())}
          ${row("Total spend", spend)}
          ${row(
            "Avg supplier reply",
            overview.averageReplyHours != null
              ? `${overview.averageReplyHours.toFixed(1)}h`
              : "—"
          )}
        </table>
      </td></tr>
      ${
        suppliers
          ? `<tr><td style="padding:20px 32px 0 32px">
              <div style="font-size:14px;font-weight:600;margin-bottom:8px">Top suppliers</div>
              <table width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #e5e7eb;border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden">
                <tr><th style="padding:10px 12px;text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb">Supplier</th><th style="padding:10px 12px;text-align:right;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb">Orders</th><th style="padding:10px 12px;text-align:right;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb">Confirm %</th></tr>
                ${suppliers}
              </table>
            </td></tr>`
          : ""
      }
      ${
        items
          ? `<tr><td style="padding:20px 32px 0 32px">
              <div style="font-size:14px;font-weight:600;margin-bottom:8px">Top reordered items</div>
              <table width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #e5e7eb;border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden">
                <tr><th style="padding:10px 12px;text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb">Item</th><th style="padding:10px 12px;text-align:right;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb">Orders</th><th style="padding:10px 12px;text-align:right;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb">Total</th></tr>
                ${items}
              </table>
            </td></tr>`
          : ""
      }
      <tr><td style="padding:24px 32px 28px 32px;color:#6b7280;font-size:13px">
        See the full breakdown in the app → <a href="${escapeAttr(process.env.APP_URL ?? "")}/analytics" style="color:#2563eb;text-decoration:none">Analytics</a>.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:10px 12px;border-bottom:1px solid #f0ece4">${escapeHtml(label)}</td>` +
    `<td style="padding:10px 12px;border-bottom:1px solid #f0ece4;text-align:right;font-variant-numeric:tabular-nums;font-weight:500">${escapeHtml(value)}</td></tr>`;
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
  return escapeHtml(value);
}
