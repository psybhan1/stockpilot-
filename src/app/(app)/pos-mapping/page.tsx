import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { saveSimpleMappingAction } from "@/app/actions/operations";
import { PageHero } from "@/components/app/page-hero";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/db";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { getPosMappingData } from "@/modules/dashboard/queries";
import { getUnmappedPosProducts } from "@/modules/pos/unmapped";

export default async function PosMappingPage() {
  const session = await requireSession(Role.MANAGER);
  const [mappings, unmappedProducts, inventoryItems, simpleMappings] =
    await Promise.all([
      getPosMappingData(session.locationId),
      getUnmappedPosProducts(session.locationId),
      db.inventoryItem.findMany({
        where: { locationId: session.locationId },
        select: { id: true, name: true, baseUnit: true, displayUnit: true },
        orderBy: { name: "asc" },
      }),
      db.posSimpleMapping.findMany({
        where: { locationId: session.locationId },
        include: {
          inventoryItem: {
            select: { id: true, name: true, displayUnit: true },
          },
          integration: { select: { provider: true } },
        },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

  const readyCount = mappings.filter((m) => m.mappingStatus === "READY").length;
  const reviewCount = mappings.filter((m) => m.mappingStatus === "NEEDS_REVIEW").length;
  const draftCount = mappings.filter((m) => m.mappingStatus === "RECIPE_DRAFT").length;

  return (
    <div className="space-y-10">
      <PageHero
        eyebrow="POS Mapping"
        title={mappings.length === 1 ? "One mapping" : `${mappings.length} mappings`}
        subtitle="menu meets inventory."
        description="Connect Square items to internal menu variants and recipes."
        stats={[
          { label: "Ready", value: String(readyCount).padStart(2, "0") },
          { label: "Needs review", value: String(reviewCount).padStart(2, "0"), highlight: reviewCount > 0 },
          { label: "Recipe draft", value: String(draftCount).padStart(2, "0") },
        ]}
      />

      {/* Unmapped POS products — every external product id the
          generic webhook has received a sale for that doesn't yet
          have an inventory mapping. One-click inline form per row;
          saving writes a PosSimpleMapping and resolves the
          matching "Map this POS product" alert so it stops
          nagging. */}
      {unmappedProducts.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Unmapped POS products</h2>
              <p className="text-sm text-muted-foreground">
                Sales that came in via webhook but aren&apos;t wired to an
                inventory item yet. Map each once — every future sale
                auto-depletes.
              </p>
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {unmappedProducts.length} todo
            </span>
          </div>
          <div className="space-y-2">
            {unmappedProducts.map((p) => (
              <form
                key={`${p.integrationId}:${p.externalProductId}`}
                action={saveSimpleMappingAction}
                className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3"
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
                  <div className="min-w-0">
                    <p className="font-medium">
                      {p.externalProductName ?? p.externalProductId}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {p.provider} · id: {p.externalProductId}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-900 dark:text-amber-200">
                    {p.occurrences} sale{p.occurrences === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
                  <select
                    name="inventoryItemId"
                    required
                    defaultValue=""
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
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
                    className="h-9 text-sm"
                    placeholder="Qty/sale"
                    required
                  />
                  <Button type="submit" size="sm" className="h-9 text-xs">
                    Save mapping
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Qty per sale is in the inventory item&apos;s base unit.
                  e.g., 1 latte = 240 ml whole milk.
                </p>
              </form>
            ))}
          </div>
        </section>
      ) : null}

      {/* Active webhook mappings — once linked, show a tiny summary so
          the admin can audit / re-link. */}
      {simpleMappings.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Active POS mappings</h2>
          <div className="space-y-2">
            {simpleMappings.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-card/60 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {m.externalProductName ?? m.externalProductId}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {m.integration.provider} · → {m.inventoryItem.name} ·{" "}
                    {m.quantityPerSaleBase}{" "}
                    {m.inventoryItem.displayUnit.toLowerCase()} / sale
                  </p>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                  LIVE
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Mapping list */}
      <section className="grid gap-3 lg:grid-cols-2">
        {mappings.map((mapping) => (
          <Link
            key={mapping.id}
            href={`/pos-mapping/${mapping.id}`}
            className="brutal-card group p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{mapping.posVariation.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {mapping.posVariation.catalogItem.name}
                </p>
              </div>
              <StatusBadge
                label={
                  mapping.mappingStatus === "READY" ? "Ready"
                    : mapping.mappingStatus === "NEEDS_REVIEW" ? "Review"
                    : mapping.mappingStatus === "RECIPE_DRAFT" ? "Draft"
                    : "Unmapped"
                }
                tone={mapping.mappingStatus === "READY" ? "success" : "warning"}
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Variant: {mapping.menuItemVariant.name}</span>
              <span>Recipe: {mapping.recipe?.status ?? "None"}</span>
              <span>Service: {mapping.posVariation.serviceMode ?? "Unknown"}</span>
            </div>

            <div className="mt-3 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              Open mapping
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
