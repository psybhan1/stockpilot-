/**
 * Returns Telegram chat ids of all paired managers, by location.
 * Used during n8n setup to find the MANAGER_TELEGRAM_CHAT_ID env
 * value without needing direct DB access. Protected by the same
 * webhook secret as every other /api/n8n/* endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyN8nRequest } from "@/modules/automation/n8n-auth";

export async function GET(request: NextRequest) {
  const auth = await verifyN8nRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ message: auth.reason }, { status: 401 });
  }

  try {
    const users = await db.user.findMany({
      where: { telegramChatId: { not: null } },
      select: {
        id: true,
        name: true,
        email: true,
        telegramChatId: true,
        telegramUsername: true,
        roles: {
          select: {
            location: { select: { id: true, name: true } },
            role: true,
          },
        },
      },
      take: 50,
    });

    return NextResponse.json({
      ok: true,
      managers: users.map((u) => ({
        userId: u.id,
        name: u.name,
        email: u.email,
        telegramChatId: u.telegramChatId,
        telegramUsername: u.telegramUsername,
        locations: u.roles.map((r) => ({
          locationId: r.location.id,
          locationName: r.location.name,
          role: r.role,
        })),
      })),
    });
  } catch (error) {
    console.error("[managers] error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
