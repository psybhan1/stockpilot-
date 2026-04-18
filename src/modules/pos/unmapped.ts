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
 *
 * The aggregation logic lives in ./parsing, pure and tested.
 */

import { db } from "@/lib/db";
import {
  aggregateUnmappedPosProducts,
  posMappingKey,
  type UnmappedPosProduct,
} from "./parsing";

export type { UnmappedPosProduct };

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

  const mappedKeys = existingMappings.map((m) =>
    posMappingKey(m.integrationId, m.externalProductId)
  );

  return aggregateUnmappedPosProducts(recentLines, mappedKeys);
}
