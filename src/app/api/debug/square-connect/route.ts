import { NextResponse } from "next/server";

import { requireSession } from "@/modules/auth/session";
import { Role } from "@/lib/domain-enums";
import { ensureSquareIntegration } from "@/modules/pos/service";
import { env } from "@/lib/env";

// Temporary diagnostic endpoint. Calls the same codepath as
// connectSquareAction but returns a JSON body so we can see *which*
// error is blowing up the 503 on POST /settings. Remove after the
// root cause is fixed.
export async function GET() {
  const steps: Array<{ step: string; ok: boolean; detail?: unknown }> = [];

  try {
    const session = await requireSession(Role.MANAGER);
    steps.push({ step: "session", ok: true, detail: { locationId: session.locationId } });

    try {
      const result = await ensureSquareIntegration(
        session.locationId,
        session.userId
      );
      steps.push({
        step: "ensureSquareIntegration",
        ok: true,
        detail: {
          requiresRedirect: result.requiresRedirect,
          integrationId: result.integration?.id,
          integrationStatus: result.integration?.status,
          externalMerchantId: result.integration?.externalMerchantId,
        },
      });
    } catch (err) {
      steps.push({
        step: "ensureSquareIntegration",
        ok: false,
        detail: {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack?.split("\n").slice(0, 8) : undefined,
          code: (err as { code?: string })?.code,
          name: err instanceof Error ? err.name : undefined,
        },
      });
    }

    return NextResponse.json({
      ok: steps.every((s) => s.ok),
      provider: env.DEFAULT_POS_PROVIDER,
      squareEnvironment: env.SQUARE_ENVIRONMENT,
      hasAccessToken: Boolean(env.SQUARE_ACCESS_TOKEN),
      hasClientId: Boolean(env.SQUARE_CLIENT_ID),
      hasClientSecret: Boolean(env.SQUARE_CLIENT_SECRET),
      steps,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        topLevelError: {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack?.split("\n").slice(0, 8) : undefined,
          code: (err as { code?: string })?.code,
        },
        steps,
      },
      { status: 500 }
    );
  }
}
