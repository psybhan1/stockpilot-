/**
 * GET /api/menu-items/[variantId]/margin
 *
 * Per-variant margin breakdown used by the /margins page's expand-
 * row detail. Scoped to the session's location so one business
 * can't fetch another's recipe costs.
 */
import { NextResponse } from "next/server";

import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { getVariantMarginBreakdown } from "@/modules/recipes/margin-dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ variantId: string }> }
) {
  const session = await requireSession(Role.SUPERVISOR);
  const { variantId } = await params;

  const breakdown = await getVariantMarginBreakdown(session.locationId, variantId);
  if (!breakdown) {
    return NextResponse.json({ message: "Variant not found." }, { status: 404 });
  }
  return NextResponse.json({ breakdown });
}
