"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@/lib/domain-enums";

import { requireSession } from "@/modules/auth/session";
import { mergeInventoryDuplicates } from "@/modules/inventory/duplicates";

export async function mergeInventoryDuplicatesAction(input: {
  canonicalId: string;
  duplicateIds: string[];
}): Promise<
  | { ok: true; mergedCount: number }
  | { ok: false; reason: string }
> {
  const session = await requireSession(Role.MANAGER);
  const result = await mergeInventoryDuplicates({
    locationId: session.locationId,
    canonicalId: input.canonicalId,
    duplicateIds: input.duplicateIds,
  });
  revalidatePath("/dashboard");
  revalidatePath("/inventory");
  return result;
}
