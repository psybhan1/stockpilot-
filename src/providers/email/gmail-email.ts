/**
 * GmailEmailProvider — free, scalable email sending via each location's
 * OWN connected Gmail account.
 *
 * Why this approach:
 *   - Zero per-message cost at StockPilot scale: each location uses
 *     Google's 500/day (personal) or 2000/day (Workspace) quota on
 *     their own account. 10,000 users → 10,000 × 500 = 5M emails/day
 *     free. We never touch the quota.
 *   - Emails come FROM the business's actual address, so suppliers
 *     see a familiar sender and replies land back in the manager's
 *     inbox (not a blackhole).
 *   - Token storage + OAuth flow was already shipped — this just uses
 *     the stored creds.
 *
 * Handles:
 *   - Automatic access-token refresh when expiresAt is close, using
 *     the stored refresh_token. New token is persisted back via
 *     updateGmailAccessToken() so we don't refresh on every send.
 *   - RFC 2822 message assembly + Gmail-API base64url encoding.
 *   - Clear errors if there's no Gmail connection for the location
 *     (caller can fall back to the console/resend provider).
 */

import type {
  NotificationProvider,
  SupplierOrderProvider,
} from "@/providers/contracts";
import { NotificationChannel } from "@/lib/prisma";
import { buildWebsiteOrderPlaywrightTemplate } from "@/modules/automation/playwright-template";
import { env } from "@/lib/env";
import {
  getGmailCredentials,
  updateGmailAccessToken,
  type GmailCredentials,
} from "@/modules/channels/service";

const GMAIL_SEND_ENDPOINT =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ACCESS_TOKEN_SAFETY_MS = 60_000; // refresh when <60s of life left

export class GmailNotConnectedError extends Error {
  constructor(locationId: string) {
    super(`No Gmail channel connected for location ${locationId}`);
    this.name = "GmailNotConnectedError";
  }
}

export class GmailEmailProvider
  implements NotificationProvider, SupplierOrderProvider
{
  constructor(private readonly locationId: string) {}

  // ── NotificationProvider ────────────────────────────────────────────
  async sendNotification(input: {
    notificationId?: string;
    channel: NotificationChannel;
    recipient: string;
    subject?: string;
    body: string;
  }) {
    if (input.channel !== NotificationChannel.EMAIL) {
      // Only email is supported; let the dispatcher route other
      // channels elsewhere.
      throw new Error(
        `GmailEmailProvider received ${input.channel}; only EMAIL is supported.`
      );
    }
    const id = await this.deliver({
      to: input.recipient,
      subject: input.subject ?? "StockPilot notification",
      body: input.body,
    });
    return {
      providerMessageId: id,
      deliveryState: "sent" as const,
    };
  }

  async sendAlert(input: { recipient: string; subject: string; body: string }) {
    return this.sendNotification({
      channel: NotificationChannel.EMAIL,
      recipient: input.recipient,
      subject: input.subject,
      body: input.body,
    });
  }

  // ── SupplierOrderProvider ───────────────────────────────────────────
  async createDraft(input: {
    supplierName: string;
    mode: "EMAIL" | "WEBSITE" | "MANUAL";
    orderNumber: string;
    lines: Array<{ description: string; quantity: number; unit: string }>;
  }) {
    const lines = input.lines
      .map((line) => `- ${line.description}: ${line.quantity} ${line.unit}`)
      .join("\n");
    return {
      subject: `Purchase order ${input.orderNumber}`,
      body: `Hello ${input.supplierName},\n\nPlease confirm the following order:\n${lines}\n\nThank you,\nStockPilot`,
    };
  }

  async sendApprovedOrder(input: {
    recipient: string;
    subject: string;
    body: string;
  }) {
    const id = await this.deliver({
      to: input.recipient,
      subject: input.subject,
      body: input.body,
    });
    return { providerMessageId: id };
  }

  async prepareWebsiteTask(input: {
    supplierName: string;
    website?: string | null;
    orderNumber: string;
    lines: Array<{ description: string; quantity: number; unit: string }>;
  }) {
    // WEBSITE mode goes through the automation provider elsewhere —
    // we just surface a matching agent-task payload so the shape is
    // compatible with the contract.
    const lineSummary = input.lines
      .map((l) => `${l.description} ${l.quantity}${l.unit}`)
      .join(", ");
    return {
      title: `Prepare ${input.supplierName} website order`,
      description: `Review the website order draft for PO ${input.orderNumber}. ${lineSummary}`,
      input: {
        ...input,
        scriptTemplate: buildWebsiteOrderPlaywrightTemplate({
          supplierName: input.supplierName,
          website: input.website ?? null,
          orderNumber: input.orderNumber,
          lines: input.lines,
        }),
      } as Record<string, unknown>,
    };
  }

  // ── Internal: send email via Gmail REST API ─────────────────────────
  private async deliver(input: {
    to: string;
    subject: string;
    body: string;
  }): Promise<string> {
    const creds = await this.ensureFreshToken();

    // Build RFC 2822 / RFC 5322 message.
    const rfc822 =
      `From: ${creds.email}\r\n` +
      `To: ${input.to}\r\n` +
      `Subject: ${sanitizeHeader(input.subject)}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/plain; charset=UTF-8\r\n` +
      `Content-Transfer-Encoding: 7bit\r\n` +
      `\r\n` +
      input.body;

    const raw = Buffer.from(rfc822, "utf8").toString("base64url");

    const res = await fetch(GMAIL_SEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Gmail send failed (${res.status}) for ${creds.email} → ${input.to}: ${text}`
      );
    }

    const payload = (await res.json()) as { id?: string };
    return payload.id ?? `gmail-${Date.now()}`;
  }

  private async ensureFreshToken(): Promise<GmailCredentials> {
    const creds = await getGmailCredentials(this.locationId);
    if (!creds) throw new GmailNotConnectedError(this.locationId);

    const timeLeft = (creds.expiresAt ?? 0) - Date.now();
    if (timeLeft > ACCESS_TOKEN_SAFETY_MS) return creds;

    if (!creds.refreshToken) {
      throw new Error(
        `Gmail access token expired for location ${this.locationId} and no refresh token is stored. Reconnect Gmail in Settings.`
      );
    }

    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        "GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET must be configured to refresh Gmail tokens."
      );
    }

    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Gmail token refresh failed (${res.status}): ${text}`);
    }

    const body = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token) {
      throw new Error("Gmail token refresh returned no access_token.");
    }

    const expiresAt = Date.now() + (body.expires_in ?? 3500) * 1000;
    await updateGmailAccessToken(this.locationId, {
      accessToken: body.access_token,
      expiresAt,
    });

    return {
      ...creds,
      accessToken: body.access_token,
      expiresAt,
    };
  }
}

function sanitizeHeader(value: string): string {
  // Strip CR/LF so no one can inject extra headers via the subject.
  return value.replace(/[\r\n]+/g, " ").trim();
}
