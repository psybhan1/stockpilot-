/**
 * POST /api/extension/link
 *
 * Called from the signin wizard's "Use browser extension" tab to
 * mint the extension-scoped session cookie. This is what unblocks
 * the extension's cross-origin fetches — the main Lax session
 * cookie wouldn't ride cross-origin.
 *
 * Idempotent: calling it again just mints a fresh cookie; old
 * sessions expire on their own TTL.
 */
import { NextResponse } from "next/server";

import { createAuditLogTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { Role } from "@/lib/domain-enums";
import { linkExtensionSession } from "@/modules/auth/extension-session";
import { requireSession } from "@/modules/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const session = await requireSession(Role.MANAGER);
  try {
    await linkExtensionSession();
    await db.$transaction((tx) =>
      createAuditLogTx(tx, {
        locationId: session.locationId,
        userId: session.userId,
        action: "extension.session_linked",
        entityType: "user",
        entityId: session.userId,
        details: {},
      })
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message: message.slice(0, 200) }, { status: 500 });
  }
}
