"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@/lib/domain-enums";

import { db } from "@/lib/db";
import { requireSession } from "@/modules/auth/session";
import {
  applyCalibrationSuggestion,
  backfillCalibrationWeeks,
  deriveCalibrationSuggestions,
  dismissCalibrationSuggestion,
} from "@/modules/recipes/calibration";

export async function applyCalibrationSuggestionAction(
  suggestionId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const session = await requireSession(Role.MANAGER);
  const result = await applyCalibrationSuggestion({
    suggestionId,
    userId: session.userId,
    locationId: session.locationId,
  });
  revalidatePath("/dashboard");
  revalidatePath("/recipes");
  return result;
}

export async function dismissCalibrationSuggestionAction(
  suggestionId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const session = await requireSession(Role.MANAGER);
  const result = await dismissCalibrationSuggestion({
    suggestionId,
    locationId: session.locationId,
  });
  revalidatePath("/dashboard");
  return result;
}

/**
 * Admin-only: one-shot backfill of calibration weeks for the past 8
 * weeks + derive any suggestions. Used to kickstart the feature
 * before the Sunday cron has a chance to run.
 */
export async function kickstartCalibrationAction(): Promise<
  | { ok: true; weeksProcessed: number; suggestionsCreated: number }
  | { ok: false; reason: string }
> {
  const session = await requireSession(Role.MANAGER);
  try {
    const rollup = await backfillCalibrationWeeks({
      locationId: session.locationId,
      weeksBack: 8,
    });
    const derive = await deriveCalibrationSuggestions(session.locationId);
    revalidatePath("/dashboard");
    return {
      ok: true,
      weeksProcessed: rollup.weeksProcessed,
      suggestionsCreated: derive.suggestionsCreated,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Kickstart failed.",
    };
  }
}
