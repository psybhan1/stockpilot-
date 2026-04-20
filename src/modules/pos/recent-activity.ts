/**
 * Recent POS sales for the dashboard activity feed. Gives the owner
 * a live "yes, my integration is firing" signal — a card showing
 * the last N sale lines that came through the webhook in the last
 * 7 days, with product name + quantity + inventory deplete target
 * when mapped, or an "unmapped" chip when not.
 *
 * We read from PosSaleLine joined to PosSaleEvent + PosSimpleMapping
 * + InventoryItem. Only webhook-backed lines (not Square's mapping
 * chain) show up here — Square sales already surface through the
 * Money Pulse + Running Low paths.
 *
 * The row-shaping logic lives in ./parsing so the edge cases
 * (null rawData, whitespace-only names, missing integrationId)
 * can be exercised without a DB.
 */

import { db } from "@/lib/db";
import {
  buildRecentPosSaleRows,
  type RecentPosSaleRow,
} from "./parsing";

export type RecentPosSale = RecentPosSaleRow;

export async function getRecentPosSales(
  locationId: string,
  limit = 8
): Promise<RecentPosSale[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [lines, mappings] = await Promise.all([
    db.posSaleLine.findMany({
      where: {
        saleEvent: {
          locationId,
          occurredAt: { gte: sevenDaysAgo },
          integration: {
            provider: {
              notIn: ["SQUARE", "MANUAL"],
            },
          },
        },
      },
      select: {
        id: true,
        quantity: true,
        rawData: true,
        saleEvent: {
          select: {
            id: true,
            occurredAt: true,
            integrationId: true,
            integration: { select: { provider: true } },
          },
        },
      },
      orderBy: { saleEvent: { occurredAt: "desc" } },
      take: limit,
    }),
    db.posSimpleMapping.findMany({
      where: { locationId },
      select: {
        integrationId: true,
        externalProductId: true,
        quantityPerSaleBase: true,
        inventoryItem: {
          select: {
            id: true,
            name: true,
            displayUnit: true,
          },
        },
      },
    }),
  ]);

  return buildRecentPosSaleRows(lines, mappings);
}
