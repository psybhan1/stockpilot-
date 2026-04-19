import Link from "next/link";
import { Plus } from "lucide-react";

import { StatusBadge } from "@/components/app/status-badge";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import {
  getArchivedRecipeCount,
  getRecipesPageData,
} from "@/modules/dashboard/queries";

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const session = await requireSession(Role.SUPERVISOR);
  const { archived } = await searchParams;
  const showArchived = archived === "1";
  const [recipes, archivedCount] = await Promise.all([
    getRecipesPageData(session.locationId, { includeArchived: showArchived }),
    getArchivedRecipeCount(session.locationId),
  ]);

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
    </div>
  );
}
