import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { PageHero } from "@/components/app/page-hero";
import { StatusBadge } from "@/components/app/status-badge";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { getRecipesPageData } from "@/modules/dashboard/queries";

export default async function RecipesPage() {
  const session = await requireSession(Role.SUPERVISOR);
  const recipes = await getRecipesPageData(session.locationId);

  const approvedCount = recipes.filter((r) => r.status === "APPROVED").length;
  const draftCount = recipes.filter((r) => r.status !== "APPROVED").length;

  return (
    <div className="space-y-10">
      <PageHero
        eyebrow="Recipes"
        title={recipes.length === 1 ? "One recipe" : `${recipes.length} recipes`}
        subtitle="driving stock depletion."
        description="Manage ingredient mappings that drive stock depletion."
        stats={[
          { label: "Total", value: String(recipes.length).padStart(2, "0") },
          { label: "Approved", value: String(approvedCount).padStart(2, "0") },
          { label: "Needs review", value: String(draftCount).padStart(2, "0"), highlight: draftCount > 0 },
        ]}
      />

      {/* Recipe list */}
      {recipes.length === 0 ? (
        <section className="brutal-card p-8 text-center">
          <p className="text-base font-medium">No recipes yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Recipes appear here once you sync a POS catalog or import menu
            items. Connect Square from the{" "}
            <Link href="/pos-mapping" className="underline">
              Sales link
            </Link>{" "}
            page to bootstrap recipes for every item you sell.
          </p>
        </section>
      ) : null}
      <section className="grid gap-3 lg:grid-cols-2">
        {recipes.map((recipe) => (
          <Link
            key={recipe.id}
            href={`/recipes/${recipe.id}`}
            className="brutal-card group p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{recipe.menuItemVariant.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {recipe.menuItemVariant.menuItem.name}
                </p>
              </div>
              <StatusBadge
                label={recipe.status === "APPROVED" ? "Approved" : "Review"}
                tone={recipe.status === "APPROVED" ? "success" : "warning"}
              />
            </div>

            <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
              <span>{recipe.components.length} component{recipe.components.length !== 1 ? "s" : ""}</span>
              <span>{Math.round(recipe.confidenceScore * 100)}% confidence</span>
              <span>{Math.round(recipe.completenessScore * 100)}% complete</span>
            </div>

            {recipe.aiSummary && (
              <p className="mt-2 text-xs text-muted-foreground line-clamp-1">{recipe.aiSummary}</p>
            )}

            <div className="mt-3 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              Open recipe
              <ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: "warning";
}) {
  return (
    <div className="brutal-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${highlight === "warning" ? "text-amber-500" : ""}`}>{value}</p>
    </div>
  );
}
