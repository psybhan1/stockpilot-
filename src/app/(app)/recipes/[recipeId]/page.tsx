import { notFound } from "next/navigation";
import { ChefHat, PackageCheck, Sparkles } from "lucide-react";

import { approveRecipeAction } from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { getRecipeDetail } from "@/modules/dashboard/queries";

export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ recipeId: string }>;
}) {
  const session = await requireSession(Role.SUPERVISOR);
  const { recipeId } = await params;
  const recipe = await getRecipeDetail(session.locationId, recipeId).catch(() => null);

  if (!recipe) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border-border/60 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(255,255,255,0.92))] shadow-xl shadow-black/5 dark:bg-[linear-gradient(135deg,rgba(68,64,60,0.98),rgba(28,25,23,0.94))]">
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm uppercase tracking-[0.22em] text-amber-600 dark:text-amber-300">
                Recipe review
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                {recipe.menuItemVariant.name}
              </h1>
              <p className="mt-3 text-base text-muted-foreground sm:text-lg">
                {recipe.aiSummary ||
                  "Review the ingredients and packaging below, then approve when the quantities look right."}
              </p>
            </div>

            <StatusBadge
              label={recipe.status === "APPROVED" ? "Approved" : "Needs review"}
              tone={recipe.status === "APPROVED" ? "success" : "warning"}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard icon={ChefHat} label="Components" value={String(recipe.components.length)} />
            <MetricCard
              icon={Sparkles}
              label="Confidence"
              value={`${Math.round(recipe.confidenceScore * 100)}%`}
            />
            <MetricCard
              icon={PackageCheck}
              label="Completeness"
              value={`${Math.round(recipe.completenessScore * 100)}%`}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-[28px] border-border/60 bg-card/88 shadow-lg shadow-black/5">
        <CardContent className="p-5">
          <form action={approveRecipeAction} className="flex flex-col gap-4">
            <input type="hidden" name="recipeId" value={recipe.id} />

            {recipe.components.map((component) => (
              <div
                key={component.id}
                className="grid gap-4 rounded-[24px] border border-border/60 bg-background/80 p-4 lg:grid-cols-[minmax(0,1fr)_140px_120px]"
              >
                <div>
                  <p className="font-medium">{component.inventoryItem.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {component.componentType.toLowerCase()} -{" "}
                    {component.conditionServiceMode ?? "all service modes"}
                  </p>
                </div>
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Approved quantity
                  </p>
                  <Input
                    name={`component-${component.id}`}
                    type="number"
                    defaultValue={component.quantityBase}
                    className="h-11 rounded-2xl"
                  />
                </div>
                <div className="flex items-end">
                  <div className="w-full rounded-2xl border border-border/60 bg-card px-3 py-3 text-sm text-muted-foreground">
                    {component.displayUnit.toLowerCase()}
                  </div>
                </div>
              </div>
            ))}

            <div className="flex justify-end">
              {session.role === Role.MANAGER ? (
                <Button type="submit" className="rounded-2xl">
                  Approve recipe
                </Button>
              ) : (
                <div className="rounded-[24px] border border-border/60 bg-background/75 px-4 py-3 text-sm text-muted-foreground">
                  A manager still needs to approve this recipe before it can drive depletion.
                </div>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ChefHat;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[24px] border border-border/60 bg-background/85 p-4 shadow-lg shadow-black/5">
      <Icon className="size-5 text-amber-600 dark:text-amber-300" />
      <p className="mt-4 text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}
