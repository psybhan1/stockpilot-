/**
 * Café starter pack — seeded on signup so a brand-new user lands on
 * a dashboard with ~16 typical items already tracked instead of an
 * empty table. The owner adjusts quantities and par levels from the
 * inventory page; items they don't need they delete.
 *
 * Pure data + row-building math live in ./starter-pack-data so the
 * tests can exercise them without dragging in Prisma. This file is
 * the thin tx wrapper.
 */

import type { Prisma } from "@/lib/prisma";

import { buildStarterInventoryRows } from "./starter-pack-data";

export {
  buildStarterInventoryRows,
  ESPRESSO_BAR_STARTER,
  type StarterBaseUnit,
  type StarterCategory,
  type StarterInventoryRow,
  type StarterItem,
} from "./starter-pack-data";

/**
 * Transaction-safe variant that the signup flow calls inline so the
 * whole account (business + location + user + starter inventory)
 * lands atomically. Failures roll back the signup.
 */
export async function seedStarterPackTx(
  tx: Prisma.TransactionClient,
  locationId: string
) {
  await tx.inventoryItem.createMany({
    data: buildStarterInventoryRows(locationId),
    skipDuplicates: true,
  });
}
