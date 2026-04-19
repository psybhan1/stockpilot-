import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { updatePosMappingAction } from "@/app/actions/operations";
import { MenuChatPanel } from "@/components/app/menu-chat-panel";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { getPosMappingDetail } from "@/modules/dashboard/queries";

export default async function PosMappingDetailPage({
  params,
}: {
  params: Promise<{ mappingId: string }>;
}) {
  const session = await requireSession(Role.MANAGER);
  const { mappingId } = await params;
  const data = await getPosMappingDetail(session.locationId, mappingId).catch(() => null);

  if (!data) {
    notFound();
  }

  const { mapping, variants, recipes } = data;

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border-border/60 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(255,255,255,0.92))] shadow-xl shadow-black/5 dark:bg-[linear-gradient(135deg,rgba(68,64,60,0.98),rgba(28,25,23,0.94))]">
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm uppercase tracking-[0.22em] text-amber-600 dark:text-amber-300">
                POS mapping
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                {mapping.posVariation.name}
              </h1>
              <p className="mt-3 text-base text-muted-foreground sm:text-lg">
                Square item {mapping.posVariation.catalogItem.name} - internal variant{" "}
                {mapping.menuItemVariant.name}
              </p>
            </div>
            <StatusBadge
              label={mapping.mappingStatus === "READY" ? "Ready" : "Needs review"}
              tone={mapping.mappingStatus === "READY" ? "success" : "warning"}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <InfoPill label="Service mode" value={mapping.posVariation.serviceMode ?? "Unknown"} />
            <InfoPill label="Size label" value={mapping.posVariation.sizeLabel ?? "Not provided"} />
            <InfoPill label="Packaging mode" value={mapping.packagingMode ?? "Use variation service mode"} />
          </div>
        </CardContent>
      </Card>

      {/* AI draft CTA — the fastest path to a working recipe. One-
          click, then a chat loop to tweak. Lives above the manual form
          so new users land on the easy path first. */}
      <Link
        href={`/pos-mapping/${mapping.id}/draft`}
        className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-orange-500/5 p-5 hover:from-amber-500/20 hover:to-orange-500/10"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xl">
            ✨
          </span>
          <div>
            <p className="font-semibold">Draft this recipe with AI</p>
            <p className="text-xs text-muted-foreground">
              StockBuddy picks components from your inventory, then you
              tweak by chat — &ldquo;use oat milk&rdquo;, &ldquo;add paper straw&rdquo;.
            </p>
          </div>
        </div>
        <span className="font-mono text-xs">draft →</span>
      </Link>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="notif-card border-none shadow-none bg-transparent">
          <CardContent className="space-y-5 p-5">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Mapping control</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Reassign the internal variant, attach a recipe, and move the mapping into a safe
                state when the depletion logic is ready.
              </p>
            </div>

            <form action={updatePosMappingAction} className="space-y-5">
              <input type="hidden" name="mappingId" value={mapping.id} />

              <Field label="Internal menu variant">
                <select
                  name="menuItemVariantId"
                  defaultValue={mapping.menuItemVariantId}
                  className="h-11 rounded-2xl border border-input bg-transparent px-3 text-sm"
                >
                  {variants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.menuItem.name} - {variant.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Recipe version">
                <select
                  name="recipeId"
                  defaultValue={mapping.recipeId ?? ""}
                  className="h-11 rounded-2xl border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">No recipe assigned yet</option>
                  {recipes.map((recipe) => (
                    <option key={recipe.id} value={recipe.id}>
                      {recipe.menuItemVariant.menuItem.name} - {recipe.menuItemVariant.name} - v
                      {recipe.version} - {recipe.status}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Mapping status">
                  <select
                    name="mappingStatus"
                    defaultValue={mapping.mappingStatus}
                    className="h-11 rounded-2xl border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="UNMAPPED">Unmapped</option>
                    <option value="NEEDS_REVIEW">Needs review</option>
                    <option value="RECIPE_DRAFT">Recipe draft</option>
                    <option value="READY">Ready for depletion</option>
                  </select>
                </Field>

                <Field label="Packaging mode">
                  <select
                    name="packagingMode"
                    defaultValue={mapping.packagingMode ?? ""}
                    className="h-11 rounded-2xl border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="">Use variation service mode</option>
                    <option value="TO_GO">To-go</option>
                    <option value="DINE_IN">Dine-in</option>
                  </select>
                </Field>
              </div>

              <Field label="Manager notes">
                <Textarea
                  name="notes"
                  rows={4}
                  defaultValue={mapping.notes ?? ""}
                  placeholder="Document why this mapping is safe, incomplete, or waiting on more recipe work."
                  className="rounded-2xl"
                />
              </Field>

              <Button type="submit" className="rounded-2xl">
                Save mapping
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="notif-card border-none shadow-none bg-transparent">
            <CardContent className="space-y-4 p-5">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Source variation</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Normalized Square data stays separate from recipe logic.
                </p>
              </div>

              <InfoPill label="Square item" value={mapping.posVariation.catalogItem.name} />
              <InfoPill label="Variation name" value={mapping.posVariation.name} />
              <InfoPill label="Service mode" value={mapping.posVariation.serviceMode ?? "Unknown"} />
            </CardContent>
          </Card>

          <Card className="notif-card border-none shadow-none bg-transparent">
            <CardContent className="space-y-4 p-5">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Linked recipe</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ready mappings should always point to an approved recipe version.
                </p>
              </div>

              {mapping.recipe ? (
                <div className="rounded-[24px] border border-border/60 bg-background/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {mapping.recipe.menuItemVariant.menuItem.name} -{" "}
                        {mapping.recipe.menuItemVariant.name}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Version {mapping.recipe.version} - {mapping.recipe.status}
                      </p>
                    </div>
                    <Link href={`/recipes/${mapping.recipe.id}`} className="text-sm hover:underline">
                      Open recipe
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="rounded-[24px] border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
                  No recipe is attached yet. Keep this mapping out of ready until the recipe work is approved.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <MenuChatPanel />
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-border/60 bg-background/80 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-medium">{value}</p>
    </div>
  );
}
