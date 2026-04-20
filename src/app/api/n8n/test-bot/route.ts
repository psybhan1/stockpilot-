/**
 * Internal test endpoint — sends a message through the bot agent
 * and returns the raw response WITHOUT sending anything to Telegram.
 * Used for verifying bot behavior before telling the user to test.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyN8nRequest } from "@/modules/automation/n8n-auth";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  const auth = await verifyN8nRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ message: auth.reason }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    message?: string;
    locationId?: string;
  } | null;
  const message = body?.message?.trim();
  if (!message) {
    return NextResponse.json({ message: "Missing message" }, { status: 400 });
  }

  // Find the first location + user to use as context.
  const location = body?.locationId
    ? await db.location.findUnique({ where: { id: body.locationId }, select: { id: true } })
    : await db.location.findFirst({ select: { id: true } });
  if (!location) {
    return NextResponse.json({ message: "No location" }, { status: 404 });
  }
  const user = await db.user.findFirst({
    where: { roles: { some: { locationId: location.id } } },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ message: "No user" }, { status: 404 });
  }

  try {
    const { runBotAgent } = await import("@/modules/operator-bot/agent");
    const result = await runBotAgent({
      locationId: location.id,
      userId: user.id,
      channel: "TELEGRAM",
      senderId: "test",
      sourceMessageId: null,
      conversation: [{ role: "user", content: message }],
    });
    return NextResponse.json({
      ok: true,
      reply: result.reply,
      replyScenario: result.replyScenario ?? null,
      purchaseOrderId: result.purchaseOrderId ?? null,
      orderNumber: result.orderNumber ?? null,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
