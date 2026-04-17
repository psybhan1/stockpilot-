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
import { hasMinimumRole } from "@/lib/permissions";
import { linkExtensionSession } from "@/modules/auth/extension-session";
import { getSession } from "@/modules/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  // Explicit getSession + manual role check. requireSession would
  // redirect on failure, and fetch() follows redirects by default —
  // the caller would receive a 200 HTML page and think the link
  // succeeded when it didn't.
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { message: "Sign in to StockPilot first." },
      { status: 401 }
    );
  }
  if (!hasMinimumRole(session.role, Role.MANAGER)) {
    return NextResponse.json(
      { message: "Manager role required to connect the browser." },
      { status: 403 }
    );
  }

  try {
    await linkExtensionSession();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message: message.slice(0, 200) }, { status: 500 });
  }

  // Best-effort audit — don't fail the link if the audit insert
  // fails, because the user IS linked (cookie is set).
  await db
    .$transaction((tx) =>
      createAuditLogTx(tx, {
        locationId: session.locationId,
        userId: session.userId,
        action: "extension.session_linked",
        entityType: "user",
        entityId: session.userId,
        details: {},
      })
    )
    .catch(() => null);

  return NextResponse.json({ ok: true });
}
