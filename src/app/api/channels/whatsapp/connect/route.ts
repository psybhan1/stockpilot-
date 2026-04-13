import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/modules/auth/session";
import { Role } from "@/lib/prisma";
import { startWhatsAppChannelPairing } from "@/modules/channels/service";

/**
 * POST /api/channels/whatsapp/connect
 *
 * Generates a 15-min pairing code for this location's WhatsApp channel.
 * Manager sends the code (e.g. "SB-AB1234") to the WhatsApp bot number
 * to link it as the location's notification channel.
 */
export async function POST(_request: NextRequest) {
  const session = await requireSession(Role.MANAGER);

  const { code, expiresAt } = await startWhatsAppChannelPairing(session.locationId);

  return NextResponse.json({ code, expiresAt });
}
