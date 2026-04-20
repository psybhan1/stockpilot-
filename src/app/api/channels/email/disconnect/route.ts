import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/modules/auth/session";
import { ChannelType, Role } from "@/lib/prisma";
import { disconnectEmailChannel } from "@/modules/channels/service";

/**
 * POST /api/channels/email/disconnect
 * Body: { provider: "smtp" | "gmail" }
 */
export async function POST(request: NextRequest) {
  const session = await requireSession(Role.MANAGER);

  const body = (await request.json().catch(() => ({}))) as { provider?: string };
  const channel =
    body.provider === "gmail" ? ChannelType.EMAIL_GMAIL : ChannelType.EMAIL_SMTP;

  await disconnectEmailChannel(session.locationId, channel);

  return NextResponse.json({ ok: true });
}
