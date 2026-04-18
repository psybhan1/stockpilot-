/**
 * Surface every external POS product that's fired a sale through the
 * generic webhook but doesn't yet have a PosSimpleMapping → inventory
 * item row. Used on /pos-mapping so the café owner sees, in one
 * place, every "Large Latte" / "caffe_latte_16oz" the POS keeps
 * sending and can wire each of them to an inventory item with one
 * form submit.
 *
 * We grab the last 500 webhook sale lines (~ a few days for a busy
 * café), group by (integrationId, externalProductId), count
 * occurrences, carry forward the last-seen externalProductName and
 * last-seen unitPriceCents, and filter out anything that already
 * has a mapping. Everything else shows up as a todo row for the
 * owner.
 */

import { db } from "@/lib/db";

export type UnmappedPosProduct = {
  integrationId: string;
  provider: string;
  externalProductId: string;
  externalProductName: string | null;
  lastUnitPriceCents: number | null;
  occurrences: number;
  lastSeenAt: Date;
};

type RawLineBlob = {
  externalProductId?: unknown;
  externalProductName?: unknown;
};

export async function getUnmappedPosProducts(
  locationId: string
): Promise<UnmappedPosProduct[]> {
  const [existingMappings, recentLines] = await Promise.all([
    db.posSimpleMapping.findMany({
      where: { locationId },
      select: { integrationId: true, externalProductId: true },
    }),
    db.posSaleLine.findMany({
      where: {
        saleEvent: {
          locationId,
          integration: {
            provider: {
              notIn: ["SQUARE", "MANUAL"],
            },
          },
        },
      },
      select: {
        rawData: true,
        unitPriceCents: true,
        saleEvent: {
          select: {
            integrationId: true,
            occurredAt: true,
            integration: { select: { provider: true } },
          },
        },
      },
      orderBy: { saleEvent: { occurredAt: "desc" } },
      take: 500,
    }),
  ]);

  const mappedKeys = new Set(
    existingMappings.map((m) => `${m.integrationId}:${m.externalProductId}`)
  );

  const agg = new Map<string, UnmappedPosProduct>();

  for (const line of recentLines) {
    const raw = (line.rawData ?? null) as RawLineBlob | null;
    const externalProductId =
      typeof raw?.externalProductId === "string"
        ? raw.externalProductId.trim()
        : null;
    const externalProductName =
      typeof raw?.externalProductName === "string" && raw.externalProductName.trim()
        ? raw.externalProductName.trim()
        : null;
    const integrationId = line.saleEvent.integrationId;
    const provider = line.saleEvent.integration?.provider ?? "UNKNOWN";
    if (!externalProductId || !integrationId) continue;

    const key = `${integrationId}:${externalProductId}`;
    if (mappedKeys.has(key)) continue;

    const existing = agg.get(key);
    if (existing) {
      existing.occurrences += 1;
      // keep the earliest-sorted lastSeenAt (we iterate DESC so the
      // first one we see IS the most recent)
      if (!existing.externalProductName && externalProductName) {
        existing.externalProductName = externalProductName;
      }
      if (existing.lastUnitPriceCents == null && line.unitPriceCents != null) {
        existing.lastUnitPriceCents = line.unitPriceCents;
      }
    } else {
      agg.set(key, {
        integrationId,
        provider,
        externalProductId,
        externalProductName,
        lastUnitPriceCents: line.unitPriceCents ?? null,
        occurrences: 1,
        lastSeenAt: line.saleEvent.occurredAt,
      });
    }
  }

  return [...agg.values()].sort((a, b) => b.occurrences - a.occurrences);
}
