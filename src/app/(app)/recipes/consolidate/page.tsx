import Link from "next/link";
import { notFound } from "next/navigation";

import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { planConsolidation } from "@/modules/recipes/consolidation";
import { ConsolidatePreview } from "@/components/app/consolidate-preview";

/**
 * Recipe-consolidation preview. Takes ?ids=a,b,c in the query and
 * asks Groq for a unified recipe + modifier tree. Shows a before/
 * after diff so the manager can eyeball it before hitting Confirm.
 */
export default async function ConsolidatePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const session = await requireSession(Role.MANAGER);
  const { ids } = await searchParams;

  const recipeIds = (ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (recipeIds.length < 2) notFound();

  const planResult = await planConsolidation({
    locationId: session.locationId,
    recipeIds,
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-500 dark:text-violet-400">
          Consolidate recipes
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {"error" in planResult ? "Planner error" : planResult.displayLabel}
        </h1>
        {"error" in planResult ? (
          <p className="mt-3 text-sm text-red-500">{planResult.error}</p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground max-w-2xl">
            {planResult.summary}
          </p>
        )}
      </header>

      {"error" in planResult ? (
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm font-medium text-violet-600 hover:underline"
        >
          ← Back to dashboard
        </Link>
      ) : (
        <ConsolidatePreview plan={planResult} />
      )}
    </div>
  );
}
