import { NextRequest, NextResponse } from "next/server";
import { getSmtpCredentials, getGmailCredentials } from "@/modules/channels/service";
import nodemailer from "nodemailer";

function validateSecret(request: NextRequest) {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) return true;
  return request.headers.get("X-StockPilot-Webhook-Secret") === secret;
}

async function sendViaSmtp(
  locationId: string,
  to: string,
  subject: string,
  html: string
) {
  const creds = await getSmtpCredentials(locationId);
  if (!creds) throw new Error("SMTP channel not configured for this location");

  const transport = nodemailer.createTransport({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: { user: creds.user, pass: creds.pass },
  });

  const info = await transport.sendMail({
    from: `"${creds.fromName}" <${creds.fromEmail}>`,
    to,
    subject,
    html,
    text: html.replace(/<[^>]+>/g, ""),
  });

  return info.messageId as string;
}

async function sendViaGmail(
  locationId: string,
  to: string,
  subject: string,
  html: string
) {
  const creds = await getGmailCredentials(locationId);
  if (!creds) throw new Error("Gmail channel not configured for this location");

  // Use OAuth2 transport
  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: creds.email,
      accessToken: creds.accessToken,
    },
  });

  const info = await transport.sendMail({
    from: creds.email,
    to,
    subject,
    html,
    text: html.replace(/<[^>]+>/g, ""),
  });

  return info.messageId as string;
}

/**
 * POST /api/notify/email
 *
 * Called by n8n to send an email on behalf of a specific location, using
 * that location's configured email channel (SMTP or Gmail).
 *
 * Body: { locationId, to, subject, html }
 */
export async function POST(request: NextRequest) {
  if (!validateSecret(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    locationId?: string;
    to?: string;
    subject?: string;
    html?: string;
    text?: string;
  };

  const { locationId, to, subject } = body;
  const html = body.html ?? body.text ?? "";

  if (!locationId || !to || !subject) {
    return NextResponse.json(
      { message: "Missing required fields: locationId, to, subject" },
      { status: 400 }
    );
  }

  try {
    // Try Gmail first, fall back to SMTP
    let messageId: string | undefined;
    let provider: string;

    const gmailCreds = await getGmailCredentials(locationId);
    if (gmailCreds) {
      messageId = await sendViaGmail(locationId, to, subject, html);
      provider = "gmail";
    } else {
      messageId = await sendViaSmtp(locationId, to, subject, html);
      provider = "smtp";
    }

    return NextResponse.json({ ok: true, messageId, provider });
  } catch (error) {
    console.error("[notify/email] error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to send email" },
      { status: 500 }
    );
  }
}
