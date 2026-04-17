/**
 * GET /api/variance/[itemId]?days=7
 *
 * Per-item movement detail for the /variance page's expand-row
 * view. Returns every StockMovement for the item in the range so
 * the UI can show "here's every correction / waste / count-
 * adjustment that added up to the reported loss."
 *
 * Scoped to the caller's location — cross-tenant ids 404.
 */
import { NextResponse } from "next/server";

import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { getItemVarianceDetail } from "@/modules/variance/report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const session = await requireSession(Role.SUPERVISOR);
  const { itemId } = await params;
  const url = new URL(req.url);
  const daysRaw = Number(url.searchParams.get("days") ?? "7");
  const days = Number.isFinite(daysRaw) && daysRaw >= 1 && daysRaw <= 90
    ? Math.round(daysRaw)
    : 7;

  const detail = await getItemVarianceDetail(session.locationId, itemId, { days });
  if (!detail) {
    return NextResponse.json({ message: "Item not found." }, { status: 404 });
  }
  return NextResponse.json({
    from: detail.from.toISOString(),
    to: detail.to.toISOString(),
    item: detail.item,
    movements: detail.movements,
  });
}
