/**
 * GET /api/suppliers/[supplierId]/signin/[sessionId]/screenshot
 *
 * Returns the current Chrome viewport as a JPEG. Client polls this
 * ~once a second so the user sees what's happening on the
 * supplier's real login page.
 */

import { NextResponse } from "next/server";

import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import {
  assertOwner,
  currentUrl,
  getSession,
  refreshScreenshot,
} from "@/modules/automation/signin-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ supplierId: string; sessionId: string }> }
) {
  const { sessionId } = await params;
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

  const buffer = await refreshScreenshot(sessionId);
  if (!buffer) {
    return NextResponse.json({ message: "Screenshot unavailable" }, { status: 500 });
  }

  // Embed the URL as a custom header so the client can detect when
  // the user lands on the logged-in page (URL no longer the
  // sign-in page) without a separate request.
  const url = currentUrl(sessionId) ?? "";
  return new Response(Buffer.from(buffer), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store",
      "X-Current-Url": url,
    },
  });
}
