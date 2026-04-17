/**
 * POST /api/suppliers/[supplierId]/signin/start
 *
 * Spins up a server-side Chrome session pointed at the supplier's
 * login URL. Returns a session id + the first screenshot as base64.
 * The client then polls /screenshot, forwards clicks/keys via
 * /interact, and finishes with /capture to persist the cookies.
 */

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { startSigninSession } from "@/modules/automation/signin-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Known supplier login URLs + the URL pattern that indicates a
 * successful sign-in (so the client can offer "Save my login" the
 * moment detection fires).
 */
const LOGIN_URLS: Array<{
  match: RegExp;
  loginUrl: (site: string) => string;
  loggedInUrlMatcher: RegExp;
}> = [
  {
    match: /amazon\.com/i,
    loginUrl: () => "https://www.amazon.com/ap/signin?openid.return_to=https%3A%2F%2Fwww.amazon.com%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=usflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0",
    loggedInUrlMatcher: /amazon\.com\/(?:\?|$|ref=|gp\/yourstore)/i,
  },
  {
    match: /amazon\.ca/i,
    loginUrl: () => "https://www.amazon.ca/ap/signin",
    loggedInUrlMatcher: /amazon\.ca\/(?:\?|$|ref=|gp\/yourstore)/i,
  },
  {
    match: /costco/i,
    loginUrl: () => "https://www.costco.com/LogonForm",
    loggedInUrlMatcher: /costco\.com\/(?!.*LogonForm)/i,
  },
  {
    match: /lcbo\.com/i,
    loginUrl: () => "https://www.lcbo.com/account/login",
    loggedInUrlMatcher: /lcbo\.com\/(?!.*login)/i,
  },
];

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ supplierId: string }> }
) {
  const { supplierId } = await params;
  const session = await requireSession(Role.MANAGER);

  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, locationId: session.locationId },
    select: { id: true, name: true, website: true, locationId: true },
  });
  if (!supplier) {
    return NextResponse.json(
      { message: "Supplier not found at this location" },
      { status: 404 }
    );
  }
  if (!supplier.website) {
    return NextResponse.json(
      { message: "Supplier has no website configured" },
      { status: 400 }
    );
  }

  const preset = LOGIN_URLS.find((p) => p.match.test(supplier.website ?? ""));
  const loginUrl = preset?.loginUrl(supplier.website) ?? supplier.website;
  const loggedInUrlMatcher = preset?.loggedInUrlMatcher ?? /.*/;

  try {
    const { sessionId, screenshot } = await startSigninSession({
      supplierId: supplier.id,
      locationId: supplier.locationId,
      loginUrl,
      loggedInUrlMatcher,
    });
    return NextResponse.json({
      sessionId,
      loginUrl,
      screenshot: screenshot.toString("base64"),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { message: `Couldn't start sign-in session: ${message.slice(0, 200)}` },
      { status: 500 }
    );
  }
}
