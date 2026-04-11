import Link from "next/link";
import { ChefHat, PackageCheck, Sparkles } from "lucide-react";

import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { getRecipesPageData } from "@/modules/dashboard/queries";

export default async function RecipesPage() {
  const session = await requireSession(Role.SUPERVISOR);
  const recipes = await getRecipesPageData(session.locationId);

  const approvedCount = recipes.filter((recipe) => recipe.status === "APPROVED").length;
  const draftCount = recipes.filter((recipe) => recipe.status !== "APPROVED").length;
  const highConfidenceCount = recipes.filter((recipe) => recipe.confidenceScore >= 0.8).length;

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border-border/60 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(255,255,255,0.92))] shadow-xl shadow-black/5 dark:bg-[linear-gradient(135deg,rgba(68,64,60,0.98),rgba(28,25,23,0.94))]">
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.22em] text-amber-600 dark:text-amber-300">
              Recipes
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Keep recipe approvals simple so depletion stays trustworthy.
            </h1>
            <p className="mt-3 text-base text-muted-foreground sm:text-lg">
              AI can suggest the ingredients and packaging, but the approved recipe is still what
              drives stock math in production.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard label="Approved" value={approvedCount} />
            <MetricCard label="Needs review" value={draftCount} />
            <MetricCard label="High confidence" value={highConfidenceCount} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {recipes.map((recipe) => (
          <Link
            key={recipe.id}
            href={`/recipes/${recipe.id}`}
            className="rounded-[28px] border border-border/60 bg-card/88 p-5 shadow-lg shadow-black/5 transition-all hover:-translate-y-0.5 hover:border-primary/30"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{recipe.menuItemVariant.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {recipe.menuItemVariant.menuItem.name}
                </p>
              </div>
              <StatusBadge
                label={recipe.status === "APPROVED" ? "Approved" : "Needs review"}
                tone={recipe.status === "APPROVED" ? "success" : "warning"}
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <InfoPill icon={ChefHat} label="Components" value={String(recipe.components.length)} />
              <InfoPill
                icon={Sparkles}
                label="Confidence"
                value={`${Math.round(recipe.confidenceScore * 100)}%`}
              />
              <InfoPill
                icon={PackageCheck}
                label="Completeness"
                value={`${Math.round(recipe.completenessScore * 100)}%`}
              />
            </div>

            <div className="mt-4 rounded-[24px] border border-border/60 bg-background/80 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Approval summary
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {recipe.aiSummary || "Open this recipe to review quantities and packaging rules."}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[24px] border border-border/60 bg-background/85 p-4 shadow-lg shadow-black/5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function InfoPill({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ChefHat;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/80 p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <p className="text-xs uppercase tracking-[0.16em]">{label}</p>
      </div>
      <p className="mt-2 font-medium">{value}</p>
    </div>
  );
}
