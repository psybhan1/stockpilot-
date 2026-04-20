import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { approveRecipeAction } from "@/app/actions/operations";
import { RecipeChatPanel } from "@/components/app/recipe-chat-panel";
import { RecipeEditor } from "@/components/app/recipe-editor";
import { RecipePricing } from "@/components/app/recipe-pricing";
import { RecipeRepairButton } from "@/components/app/recipe-repair-button";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import {
  getMenuPickerData,
  getRecipeDetail,
} from "@/modules/dashboard/queries";
import { computeRecipeCost } from "@/modules/recipes/cost";

export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ recipeId: string }>;
}) {
  const session = await requireSession(Role.SUPERVISOR);
  const { recipeId } = await params;
  const recipe = await getRecipeDetail(session.locationId, recipeId).catch(
    () => null,
  );
  if (!recipe) notFound();

  const { inventoryItems } = await getMenuPickerData(session.locationId);
  const canEdit = session.role === Role.MANAGER;
  const location = await db.location.findUnique({
    where: { id: session.locationId },
    select: { defaultMarginPercent: true },
  });
  const cost = computeRecipeCost(
    recipe.components.map((c) => ({
      id: c.id,
      quantityBase: c.quantityBase,
      displayUnit: String(c.displayUnit),
      inventoryItem: c.inventoryItem,
    })),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/recipes"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to menu
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="relative size-20 overflow-hidden rounded-2xl bg-gradient-to-br from-amber-50 to-orange-100 dark:from-stone-800 dark:to-stone-900">
            {recipe.menuItemVariant.menuItem.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={recipe.menuItemVariant.menuItem.imageUrl}
                alt={recipe.menuItemVariant.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-amber-500/40">
                {recipe.menuItemVariant.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-500 dark:text-amber-300">
              Recipe
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              {recipe.menuItemVariant.name}
            </h1>
            {recipe.menuItemVariant.menuItem.name !==
            recipe.menuItemVariant.name ? (
              <p className="text-sm text-muted-foreground">
                {recipe.menuItemVariant.menuItem.name}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge
            label={
              recipe.status === "APPROVED"
                ? "Approved"
                : recipe.status === "ARCHIVED"
                  ? "Archived"
                  : "Draft"
            }
            tone={
              recipe.status === "APPROVED"
                ? "success"
                : recipe.status === "ARCHIVED"
                  ? "neutral"
                  : "warning"
            }
          />
        </div>
      </header>

      <RecipeEditor
        recipeId={recipe.id}
        initialSummary={recipe.aiSummary ?? ""}
        initialComponents={recipe.components.map((c) => ({
          id: c.id,
          quantityBase: c.quantityBase,
          displayUnit: c.displayUnit,
          inventoryItem: {
            id: c.inventoryItem.id,
            name: c.inventoryItem.name,
            supplierItems: c.inventoryItem.supplierItems,
          },
        }))}
        inventoryOptions={inventoryItems.map((i) => ({
          id: i.id,
          name: i.name,
          displayUnit: i.displayUnit,
          category: String(i.category),
          supplierItems: i.supplierItems,
        }))}
        canEdit={canEdit}
      />

      <RecipePricing
        recipeId={recipe.id}
        totalCostCents={cost.totalCostCents}
        missingCost={cost.missingCostCount > 0}
        initialMarginPercent={recipe.targetMarginPercent ?? null}
        locationDefaultMarginPercent={location?.defaultMarginPercent ?? 70}
        canEdit={canEdit}
        approvedSalePriceCents={recipe.salePriceCents ?? null}
        stockPilotOwnsPrice={recipe.stockPilotOwnsPrice}
        hasSquareMapping={recipe.mappings.some(
          (m) => m.posVariation !== null,
        )}
        posPriceCents={
          recipe.mappings[0]?.posVariation?.priceCents ?? null
        }
        lastPushedAt={
          recipe.lastPushedToPosAt ? recipe.lastPushedToPosAt.toISOString() : null
        }
      />

      {canEdit ? <RecipeChatPanel recipeId={recipe.id} /> : null}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
          {recipe.status !== "APPROVED" ? (
            <form action={approveRecipeAction}>
              <input type="hidden" name="recipeId" value={recipe.id} />
              {recipe.components.map((c) => (
                <input
                  key={c.id}
                  type="hidden"
                  name={`component-${c.id}`}
                  value={c.quantityBase}
                />
              ))}
              <Button type="submit" className="rounded-xl">
                Approve recipe
              </Button>
            </form>
          ) : null}
          {recipe.aiSummary?.toLowerCase().includes("consolidat") ? (
            <RecipeRepairButton recipeId={recipe.id} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
