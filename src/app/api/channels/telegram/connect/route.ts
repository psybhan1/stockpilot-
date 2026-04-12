import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/modules/auth/session";
import { Role } from "@/lib/prisma";
import { startTelegramChannelPairing } from "@/modules/channels/service";

/**
 * POST /api/channels/telegram/connect
 *
 * Generates a 15-min pairing code for this location's Telegram channel.
 * Manager sends the code to the Telegram bot to link it.
 */
export async function POST(_request: NextRequest) {
  const session = await requireSession(Role.MANAGER);

  const { code, expiresAt } = await startTelegramChannelPairing(session.locationId);

  return NextResponse.json({ code, expiresAt });
}
