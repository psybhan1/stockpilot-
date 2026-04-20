import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/modules/auth/session";
import { Role } from "@/lib/prisma";
import { disconnectTelegramChannel } from "@/modules/channels/service";

/**
 * POST /api/channels/telegram/disconnect
 *
 * Removes the Telegram chat link for this location.
 */
export async function POST(_request: NextRequest) {
  const session = await requireSession(Role.MANAGER);

  await disconnectTelegramChannel(session.locationId);

  return NextResponse.json({ ok: true });
}
