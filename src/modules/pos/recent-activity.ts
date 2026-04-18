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
 */

import { db } from "@/lib/db";

export type RecentPosSale = {
  id: string;
  saleEventId: string;
  provider: string;
  occurredAt: Date;
  externalProductId: string;
  externalProductName: string | null;
  quantity: number;
  inventoryItemName: string | null;
  inventoryDeltaBase: number | null;
  inventoryDeltaUnit: string | null;
  mapped: boolean;
};

type RawLineBlob = {
  externalProductId?: unknown;
  externalProductName?: unknown;
};

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

  const mapByKey = new Map(
    mappings.map((m) => [`${m.integrationId}:${m.externalProductId}`, m])
  );

  return lines.map((line) => {
    const raw = (line.rawData ?? null) as RawLineBlob | null;
    const externalProductId =
      typeof raw?.externalProductId === "string"
        ? raw.externalProductId.trim()
        : "";
    const externalProductName =
      typeof raw?.externalProductName === "string" && raw.externalProductName.trim()
        ? raw.externalProductName.trim()
        : null;
    const integrationId = line.saleEvent.integrationId ?? "";
    const mapping = mapByKey.get(`${integrationId}:${externalProductId}`);

    return {
      id: line.id,
      saleEventId: line.saleEvent.id,
      provider: line.saleEvent.integration?.provider ?? "UNKNOWN",
      occurredAt: line.saleEvent.occurredAt,
      externalProductId,
      externalProductName,
      quantity: line.quantity,
      inventoryItemName: mapping?.inventoryItem.name ?? null,
      inventoryDeltaBase: mapping
        ? mapping.quantityPerSaleBase * line.quantity
        : null,
      inventoryDeltaUnit: mapping?.inventoryItem.displayUnit ?? null,
      mapped: Boolean(mapping),
    };
  });
}
