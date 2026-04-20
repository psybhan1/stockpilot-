/**
 * Switches which location the authed user is viewing. We only
 * accept a locationId the user actually has a role at; anything
 * else is a silent 403. Redirects back to the referer so the
 * user lands on the same page they were on.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, setActiveLocationCookie } from "@/modules/auth/session";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    locationId?: string;
    redirectTo?: string;
  };
  const locationId = (body.locationId ?? "").trim();
  if (!locationId) {
    return NextResponse.json({ message: "Missing locationId" }, { status: 400 });
  }

  const role = await db.userLocationRole.findFirst({
    where: {
      userId: session.userId,
      locationId,
    },
    select: { id: true },
  });
  if (!role) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  await setActiveLocationCookie(locationId);

  const redirectTo = body.redirectTo || req.headers.get("referer") || "/dashboard";
  return NextResponse.json({ ok: true, redirectTo });
}
