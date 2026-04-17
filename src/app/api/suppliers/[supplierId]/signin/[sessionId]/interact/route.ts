/**
 * POST /api/suppliers/[supplierId]/signin/[sessionId]/interact
 *
 * Forwards a mouse click, keystroke, or typed text to the server-
 * side Chrome. Body shape:
 *   { kind: "click", x: 123, y: 456 }
 *   { kind: "type", text: "hello" }
 *   { kind: "key", key: "Enter" }
 */

import { NextResponse } from "next/server";

import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import {
  assertOwner,
  forwardClick,
  forwardKey,
  forwardType,
  getSession,
} from "@/modules/automation/signin-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type InteractBody =
  | { kind: "click"; x: number; y: number }
  | { kind: "type"; text: string }
  | { kind: "key"; key: string };

export async function POST(
  request: Request,
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

  const body = (await request.json().catch(() => null)) as InteractBody | null;
  if (!body) {
    return NextResponse.json({ message: "Invalid body" }, { status: 400 });
  }

  try {
    if (body.kind === "click") {
      if (
        typeof body.x !== "number" ||
        typeof body.y !== "number" ||
        body.x < 0 ||
        body.x > 2000 ||
        body.y < 0 ||
        body.y > 2000
      ) {
        return NextResponse.json({ message: "Invalid coordinates" }, { status: 400 });
      }
      await forwardClick(sessionId, body.x, body.y);
    } else if (body.kind === "type") {
      if (typeof body.text !== "string" || body.text.length > 500) {
        return NextResponse.json({ message: "Invalid text" }, { status: 400 });
      }
      await forwardType(sessionId, body.text);
    } else if (body.kind === "key") {
      if (typeof body.key !== "string" || body.key.length > 20) {
        return NextResponse.json({ message: "Invalid key" }, { status: 400 });
      }
      await forwardKey(sessionId, body.key);
    } else {
      return NextResponse.json({ message: "Unknown interaction kind" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message: message.slice(0, 200) }, { status: 500 });
  }
}
