import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";

import { saveSimpleMappingAction } from "@/app/actions/operations";
import { MenuChatPanel } from "@/components/app/menu-chat-panel";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/db";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import {
  getArchivedRecipeCount,
  getPosMappingData,
  getRecipesPageData,
} from "@/modules/dashboard/queries";
import { getUnmappedPosProducts } from "@/modules/pos/unmapped";

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const session = await requireSession(Role.SUPERVISOR);
  const { archived } = await searchParams;
  const showArchived = archived === "1";
  const [recipes, archivedCount, mappings, unmappedProducts, inventoryItems] =
    await Promise.all([
      getRecipesPageData(session.locationId, {
        includeArchived: showArchived,
      }),
      getArchivedRecipeCount(session.locationId),
      session.role === Role.MANAGER
        ? getPosMappingData(session.locationId)
        : Promise.resolve([]),
      session.role === Role.MANAGER
        ? getUnmappedPosProducts(session.locationId)
        : Promise.resolve([]),
      session.role === Role.MANAGER
        ? db.inventoryItem.findMany({
            where: { locationId: session.locationId },
            select: {
              id: true,
              name: true,
              baseUnit: true,
              displayUnit: true,
            },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
    ]);

  const draftMappings = mappings.filter(
    (m) =>
      m.mappingStatus === "RECIPE_DRAFT" || m.mappingStatus === "NEEDS_REVIEW",
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-500 dark:text-amber-300">
            Menu
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {recipes.length === 1
              ? "One recipe"
              : `${recipes.length} recipes`}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tap a card to see components, cost math, and edit.
          </p>
        </div>
        {session.role === Role.MANAGER ? (
          <Link
            href="/recipes/new"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-semibold text-white shadow-sm hover:bg-amber-500/90"
          >
            <Plus className="size-4" />
            New recipe
          </Link>
        ) : null}
      </header>

      {unmappedProducts.length > 0 ? (
        <section className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
                Sales arriving with no recipe
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Webhook sales fired but StockBuddy doesn&apos;t know which
                inventory to deplete. Wire each once, every future sale
                auto-depletes.
              </p>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              {unmappedProducts.length} todo
            </span>
          </div>
          <div className="space-y-2">
            {unmappedProducts.slice(0, 6).map((p) => (
              <form
                key={`${p.integrationId}:${p.externalProductId}`}
                action={saveSimpleMappingAction}
                className="rounded-xl border border-border/50 bg-background p-3"
              >
                <input
                  type="hidden"
                  name="integrationId"
                  value={p.integrationId}
                />
                <input
                  type="hidden"
                  name="externalProductId"
                  value={p.externalProductId}
                />
                {p.externalProductName ? (
                  <input
                    type="hidden"
                    name="externalProductName"
                    value={p.externalProductName}
                  />
                ) : null}
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-medium">
                    {p.externalProductName ?? p.externalProductId}
                  </p>
                  <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-900 dark:text-amber-200">
                    {p.occurrences} sale{p.occurrences === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_110px_auto]">
                  <select
                    name="inventoryItemId"
                    required
                    defaultValue=""
                    className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                  >
                    <option value="" disabled>
                      Pick an inventory item…
                    </option>
                    {inventoryItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    name="quantityPerSaleBase"
                    min={1}
                    defaultValue={1}
                    className="h-9 text-xs"
                    placeholder="Qty/sale"
                    required
                  />
                  <Button type="submit" size="sm" className="h-9 text-xs">
                    Save
                  </Button>
                </div>
              </form>
            ))}
          </div>
        </section>
      ) : null}

      {draftMappings.length > 0 ? (
        <section className="space-y-2 rounded-2xl border border-violet-500/30 bg-violet-500/[0.04] p-4">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
              POS items still need a recipe
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Catalog synced these variants but they don&apos;t deplete
              inventory yet — draft each recipe with StockBuddy.
            </p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {draftMappings.slice(0, 8).map((m) => (
              <li key={m.id}>
                <Link
                  href={`/pos-mapping/${m.id}/draft`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border/50 bg-background p-3 hover:border-violet-500/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {m.posVariation.name}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {m.posVariation.catalogItem.name}
                    </p>
                  </div>
                  <ArrowRight className="size-4 text-violet-600 dark:text-violet-300" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {archivedCount > 0 ? (
        <div className="flex items-center justify-between rounded-xl border border-muted-foreground/20 bg-muted/30 px-4 py-2 text-xs">
          <span className="text-muted-foreground">
            {archivedCount} recipe{archivedCount === 1 ? "" : "s"} archived by
            previous merges (reversible for 30 days).
          </span>
          <Link
            href={showArchived ? "/recipes" : "/recipes?archived=1"}
            className="font-medium text-violet-600 hover:underline dark:text-violet-400"
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
        </div>
      ) : null}

      {recipes.length === 0 ? (
        <section className="brutal-card p-8 text-center">
          <p className="text-base font-medium">No recipes yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Recipes appear here once you sync a POS catalog, or tap{" "}
            <span className="font-semibold">New recipe</span> to start from
            scratch.
          </p>
        </section>
      ) : (
        <section className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {recipes.map((recipe) => {
            const image = recipe.menuItemVariant.menuItem.imageUrl;
            const name = recipe.menuItemVariant.name;
            return (
              <Link
                key={recipe.id}
                href={`/recipes/${recipe.id}`}
                className="group overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-amber-50 to-orange-100 dark:from-stone-800 dark:to-stone-900">
                  {image ? (
                    // Plain img so we don't need Next image loader config for arbitrary URLs.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={image}
                      alt={name}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-4xl font-bold text-amber-500/40">
                      {name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  {recipe.status !== "APPROVED" ? (
                    <div className="absolute left-2 top-2">
                      <StatusBadge
                        label={
                          recipe.status === "ARCHIVED" ? "Archived" : "Draft"
                        }
                        tone={
                          recipe.status === "ARCHIVED" ? "neutral" : "warning"
                        }
                      />
                    </div>
                  ) : null}
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-medium">{name}</p>
                </div>
              </Link>
            );
          })}
        </section>
      )}
      {session.role === Role.MANAGER ? <MenuChatPanel /> : null}
    </div>
  );
}
