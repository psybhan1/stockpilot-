/**
 * POST /api/suppliers/[supplierId]/signin/[sessionId]/capture
 *
 * Pulls the current Chrome session's cookies, encrypts + saves them
 * on the Supplier row, tears down the Chrome instance. Called when
 * the user indicates they're signed in (or automatically once the
 * session URL matches the loggedInUrlMatcher).
 */

import { NextResponse } from "next/server";

import { createAuditLogTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import {
  assertOwner,
  captureCookies,
  closeSession,
  getSession,
} from "@/modules/automation/signin-session";
import { encryptSupplierCredentials } from "@/modules/suppliers/website-credentials";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ supplierId: string; sessionId: string }> }
) {
  const { supplierId, sessionId } = await params;
  const session = await requireSession(Role.MANAGER);

  const signinSession = getSession(sessionId);
  if (!signinSession) {
    return NextResponse.json({ message: "Session expired or not found" }, { status: 404 });
  }
  try {
    assertOwner(signinSession, session.locationId);
  } catch {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }
  if (signinSession.supplierId !== supplierId) {
    return NextResponse.json({ message: "Supplier mismatch" }, { status: 400 });
  }

  try {
    const cookies = await captureCookies(sessionId);
    if (cookies.length === 0) {
      return NextResponse.json(
        {
          message:
            "No cookies found — make sure you're actually signed in before tapping Save.",
        },
        { status: 400 }
      );
    }
    const encrypted = encryptSupplierCredentials({
      kind: "cookies",
      cookies,
    });
    await db.$transaction(async (tx) => {
      await tx.supplier.update({
        where: { id: supplierId },
        data: {
          websiteCredentials: encrypted,
          credentialsConfigured: true,
        },
      });
      await createAuditLogTx(tx, {
        locationId: session.locationId,
        userId: session.userId,
        action: "supplier.credentials_set_via_remote_signin",
        entityType: "supplier",
        entityId: supplierId,
        details: { cookieCount: cookies.length },
      });
    });
    await closeSession(sessionId);
    return NextResponse.json({
      ok: true,
      cookieCount: cookies.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await closeSession(sessionId).catch(() => null);
    return NextResponse.json({ message: message.slice(0, 200) }, { status: 500 });
  }
}
