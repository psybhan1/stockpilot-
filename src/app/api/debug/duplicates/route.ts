import { NextResponse } from "next/server";

import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { findDuplicateRecipeCandidates } from "@/modules/recipes/duplicates";

/**
 * Debug endpoint to inspect the duplicate-detection pipeline in
 * production without redeploying. Returns the candidates as JSON so
 * we can see why the dashboard card is or isn't rendering.
 */
export async function GET() {
  const session = await requireSession(Role.MANAGER);
  const candidates = await findDuplicateRecipeCandidates(session.locationId);
  return NextResponse.json({
    locationId: session.locationId,
    count: candidates.length,
    candidates,
  });
}
