import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Liveness + readiness probe. Returns 200 when everything required to
 * serve traffic is working; 503 otherwise, with a JSON body that tells
 * ops which check failed.
 *
 * This is the first page to open after a Railway deploy — it catches
 * the class of bug where a schema migration was authored locally but
 * didn't run on the deploy target, leaving the app booting but broken
 * the moment a user triggers the new column.
 *
 * Check list:
 *   1. DB connectivity — SELECT 1.
 *   2. Schema has the columns the current code expects (spot-check the
 *      most recently added one so missed migrations surface loudly).
 *   3. A bare-minimum set of env vars is present.
 */

export async function GET() {
  const checks: Record<
    string,
    { ok: boolean; detail?: string; ms?: number }
  > = {};

  // 1. Database.
  {
    const t0 = Date.now();
    try {
      await db.$queryRaw`SELECT 1`;
      checks.database = { ok: true, ms: Date.now() - t0 };
    } catch (err) {
      checks.database = {
        ok: false,
        detail:
          err instanceof Error ? err.message.slice(0, 200) : "unknown db error",
        ms: Date.now() - t0,
      };
    }
  }

  // 2. Schema match — probing the most recently added column. If the
  //    migration for `Location.autoApproveEmailUnderCents` hasn't run
  //    on this environment, Prisma will throw when we reference it.
  if (checks.database.ok) {
    const t0 = Date.now();
    try {
      await db.location.findFirst({
        select: { id: true, autoApproveEmailUnderCents: true },
      });
      checks.schema = { ok: true, ms: Date.now() - t0 };
    } catch (err) {
      checks.schema = {
        ok: false,
        detail:
          err instanceof Error
            ? `migration likely missing: ${err.message.slice(0, 200)}`
            : "unknown schema error",
        ms: Date.now() - t0,
      };
    }
  } else {
    checks.schema = { ok: false, detail: "skipped — db down" };
  }

  // 3. Environment. Not every var is required — we only flag the ones
  //    whose absence leaves critical user-facing paths broken. Optional
  //    vars (SENTRY_DSN, N8N_*) are allowed to be empty.
  const requiredVars = [
    "DATABASE_URL",
    "SESSION_SECRET",
    "APP_URL",
    "TELEGRAM_BOT_TOKEN",
  ];
  const missing = requiredVars.filter((v) => !process.env[v]?.trim());
  checks.env = missing.length === 0
    ? { ok: true }
    : { ok: false, detail: `missing: ${missing.join(", ")}` };

  const allOk = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    {
      ok: allOk,
      checks,
      commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
      deployedAt: process.env.RAILWAY_DEPLOYMENT_CREATED_AT ?? null,
    },
    { status: allOk ? 200 : 503 }
  );
}
