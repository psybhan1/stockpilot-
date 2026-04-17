/**
 * POST /api/suppliers/[supplierId]/signin/[sessionId]/abort
 *
 * Tears down the Chrome session without saving cookies. Called
 * when the user closes the page or cancels the sign-in flow.
 */

import { NextResponse } from "next/server";

import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { assertOwner, closeSession, getSession } from "@/modules/automation/signin-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ supplierId: string; sessionId: string }> }
) {
  const { sessionId } = await params;
  const session = await requireSession(Role.MANAGER);

  const signinSession = getSession(sessionId);
  if (!signinSession) {
    return NextResponse.json({ ok: true, alreadyClosed: true });
  }
  try {
    assertOwner(signinSession, session.locationId);
  } catch {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }
  await closeSession(sessionId);
  return NextResponse.json({ ok: true });
}
