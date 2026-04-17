/**
 * POST /api/pricing/history
 *
 * Batch price-history fetch used by the variance + margins pages
 * to render inline sparklines lazily. Body:
 *   { inventoryItemIds: string[], days?: number }
 *
 * Response:
 *   { history: Record<itemId, PriceHistory>, summaries: Record<itemId, PriceChangeSummary> }
 *
 * Capped at 100 ids per request. Scoped to the caller's location.
 */
import { NextResponse } from "next/server";

import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import {
  getPriceHistoryBatch,
  summarizePriceChange,
} from "@/modules/pricing/history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_IDS = 100;

export async function POST(req: Request) {
  const session = await requireSession(Role.SUPERVISOR);
  const body = (await req.json().catch(() => null)) as {
    inventoryItemIds?: unknown;
    days?: unknown;
  } | null;
  if (!body || !Array.isArray(body.inventoryItemIds)) {
    return NextResponse.json(
      { message: "Body must be { inventoryItemIds: string[], days?: number }" },
      { status: 400 }
    );
  }
  const ids = body.inventoryItemIds
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .slice(0, MAX_IDS);
  const daysRaw = typeof body.days === "number" ? body.days : 90;
  const days = Number.isFinite(daysRaw) && daysRaw >= 1 && daysRaw <= 365
    ? Math.round(daysRaw)
    : 90;

  if (ids.length === 0) {
    return NextResponse.json({ history: {}, summaries: {} });
  }

  const map = await getPriceHistoryBatch(session.locationId, ids, { days });
  const history: Record<string, ReturnType<typeof asPlain>> = {};
  const summaries: Record<string, ReturnType<typeof summarizePriceChange>> = {};
  for (const [id, h] of map.entries()) {
    history[id] = asPlain(h);
    summaries[id] = summarizePriceChange(h.points);
  }
  return NextResponse.json({ history, summaries });
}

function asPlain(h: { inventoryItemId: string; points: unknown[] }) {
  return h;
}
