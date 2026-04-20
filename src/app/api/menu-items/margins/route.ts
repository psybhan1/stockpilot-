/**
 * POST /api/menu-items/margins
 *
 * Batch version of /api/menu-items/[variantId]/margin. Takes
 * a list of up to 50 variant ids and returns the full breakdown
 * for each. The margin table uses this when a user expands their
 * first row: it proactively fetches the next 10 variants so the
 * second, third, etc. expands feel instant (no round-trip).
 *
 * We cap at 50 so a malicious client can't DDoS the join-heavy
 * breakdown query. Real menus never need more than that in one
 * shot — the table's page-visible set is smaller than 50 in the
 * default filter.
 *
 * Body: { variantIds: string[] }
 * Response: { breakdowns: Record<variantId, MarginBreakdown> }
 */
import { NextResponse } from "next/server";

import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { getVariantMarginBreakdown } from "@/modules/recipes/margin-dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_IDS = 50;

export async function POST(req: Request) {
  const session = await requireSession(Role.SUPERVISOR);
  const body = (await req.json().catch(() => null)) as {
    variantIds?: unknown;
  } | null;
  if (!body || !Array.isArray(body.variantIds)) {
    return NextResponse.json(
      { message: "Body must be { variantIds: string[] }" },
      { status: 400 }
    );
  }
  const ids = body.variantIds
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .slice(0, MAX_IDS);
  if (ids.length === 0) {
    return NextResponse.json({ breakdowns: {} });
  }

  // Run the per-variant query in parallel. Each call is already
  // one SQL round-trip with a big include, so Promise.all keeps
  // the wall-clock latency to roughly one query worth.
  const settled = await Promise.allSettled(
    ids.map((id) => getVariantMarginBreakdown(session.locationId, id))
  );
  const breakdowns: Record<string, unknown> = {};
  for (let i = 0; i < ids.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled" && r.value) {
      breakdowns[ids[i]] = r.value;
    }
  }
  return NextResponse.json({ breakdowns });
}
