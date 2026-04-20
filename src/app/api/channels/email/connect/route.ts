import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/modules/auth/session";
import { Role } from "@/lib/prisma";
import { connectSmtpEmailChannel, type SmtpCredentials } from "@/modules/channels/service";
import nodemailer from "nodemailer";

/**
 * POST /api/channels/email/connect
 *
 * Body: { host, port, secure, user, pass, fromName, fromEmail }
 *
 * Validates SMTP credentials by attempting a connection, then stores them
 * encrypted in LocationChannel.
 */
export async function POST(request: NextRequest) {
  const session = await requireSession(Role.MANAGER);

  const body = (await request.json()) as Partial<SmtpCredentials>;
  const { host, port, secure, user, pass, fromName, fromEmail } = body;

  if (!host || !port || !user || !pass || !fromEmail) {
    return NextResponse.json(
      { message: "Missing required fields: host, port, user, pass, fromEmail" },
      { status: 400 }
    );
  }

  // Verify credentials by actually connecting
  try {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: secure ?? port === 465,
      auth: { user, pass },
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
    });
    await transport.verify();
  } catch (error) {
    return NextResponse.json(
      {
        message: `SMTP connection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 422 }
    );
  }

  await connectSmtpEmailChannel(session.locationId, {
    host,
    port,
    secure: secure ?? port === 465,
    user,
    pass,
    fromName: fromName ?? fromEmail,
    fromEmail,
  });

  return NextResponse.json({ ok: true, provider: "smtp", address: fromEmail });
}
