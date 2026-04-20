import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/modules/auth/session";
import { Role } from "@/lib/prisma";
import { disconnectWhatsAppChannel } from "@/modules/channels/service";

/**
 * POST /api/channels/whatsapp/disconnect
 *
 * Removes the WhatsApp phone link for this location.
 */
export async function POST(_request: NextRequest) {
  const session = await requireSession(Role.MANAGER);

  await disconnectWhatsAppChannel(session.locationId);

  return NextResponse.json({ ok: true });
}
