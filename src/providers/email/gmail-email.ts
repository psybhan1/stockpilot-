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
    /** When provided, sent as the multipart/alternative HTML part. */
    html?: string;
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
      html: input.html,
    });
    return {
      providerMessageId: id,
      deliveryState: "sent" as const,
    };
  }

  async sendAlert(input: {
    recipient: string;
    subject: string;
    body: string;
    html?: string;
  }) {
    return this.sendNotification({
      channel: NotificationChannel.EMAIL,
      recipient: input.recipient,
      subject: input.subject,
      body: input.body,
      html: input.html,
    });
  }

  // ── SupplierOrderProvider ───────────────────────────────────────────
  async createDraft(input: {
    supplierName: string;
    mode: "EMAIL" | "WEBSITE" | "MANUAL";
    orderNumber: string;
    lines: Array<{ description: string; quantity: number; unit: string }>;
  }) {
    const { buildSupplierOrderEmail } = await import(
      "@/modules/purchasing/email-template"
    );
    const composed = buildSupplierOrderEmail({
      supplierName: input.supplierName,
      businessName: "Our team",
      orderNumber: input.orderNumber,
      replyToEmail: "",
      lines: input.lines,
    });
    return { subject: composed.subject, body: composed.text };
  }

  async sendApprovedOrder(input: {
    recipient: string;
    subject: string;
    body: string;
    /** Optional HTML body — when present, sent as multipart/alternative. */
    html?: string;
  }) {
    const sent = await this.deliverFull({
      to: input.recipient,
      subject: input.subject,
      body: input.body,
      html: input.html,
    });
    return {
      providerMessageId: sent.id,
      // Surfaced via metadata on the SupplierCommunication row so
      // the Gmail reply-poller can find the right thread later.
      metadata: { gmailThreadId: sent.threadId, gmailMessageId: sent.id },
    };
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
    html?: string;
  }): Promise<string> {
    const full = await this.deliverFull(input);
    return full.id;
  }

  private async deliverFull(input: {
    to: string;
    subject: string;
    body: string;
    html?: string;
  }): Promise<{ id: string; threadId: string }> {
    const creds = await this.ensureFreshToken();

    const headers =
      `From: ${creds.email}\r\n` +
      `To: ${input.to}\r\n` +
      `Reply-To: ${creds.email}\r\n` +
      `Subject: ${sanitizeHeader(input.subject)}\r\n` +
      `MIME-Version: 1.0\r\n`;

    let rfc822: string;
    if (input.html && input.html.trim().length > 0) {
      // Multipart/alternative: text first (fallback), HTML second
      // (preferred). Boundary is a random string per send.
      const boundary = `=_sp_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      const textBase64 = Buffer.from(input.body, "utf8").toString("base64");
      const htmlBase64 = Buffer.from(input.html, "utf8").toString("base64");
      rfc822 =
        headers +
        `Content-Type: multipart/alternative; boundary="${boundary}"\r\n` +
        `\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: text/plain; charset=UTF-8\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `\r\n` +
        wrapBase64(textBase64) +
        `\r\n--${boundary}\r\n` +
        `Content-Type: text/html; charset=UTF-8\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `\r\n` +
        wrapBase64(htmlBase64) +
        `\r\n--${boundary}--\r\n`;
    } else {
      rfc822 =
        headers +
        `Content-Type: text/plain; charset=UTF-8\r\n` +
        `Content-Transfer-Encoding: 7bit\r\n` +
        `\r\n` +
        input.body;
    }

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
      // 403 with insufficient scopes happens when the connected
      // Gmail account was authorised before we narrowed the OAuth
      // scopes to gmail.send + gmail.readonly. The fix is a one-tap
      // reconnect — give the manager that instruction directly.
      if (res.status === 403 && /insufficient.*scope/i.test(text)) {
        throw new Error(
          `Gmail is connected but doesn't have permission to send. Go to Settings → Channels → Gmail and click Reconnect to grant send access.`
        );
      }
      throw new Error(
        `Gmail send failed (${res.status}) for ${creds.email} → ${input.to}: ${text}`
      );
    }

    const payload = (await res.json()) as { id?: string; threadId?: string };
    return {
      id: payload.id ?? `gmail-${Date.now()}`,
      threadId: payload.threadId ?? payload.id ?? `gmail-${Date.now()}`,
    };
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
      // Google's 'invalid_grant' means the refresh token is dead —
      // the user revoked access or the token aged out. Give them a
      // clear reconnect instruction rather than a cryptic 400 body.
      if (text.includes("invalid_grant") || res.status === 400) {
        throw new Error(
          "Gmail access was revoked. Go to Settings → Channels → Gmail and reconnect."
        );
      }
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

function wrapBase64(value: string): string {
  // RFC 2045 wants base64 lines ≤76 chars. Gmail accepts long lines
  // but some downstream MTAs are strict, so be polite.
  return value.replace(/(.{76})/g, "$1\r\n");
}
