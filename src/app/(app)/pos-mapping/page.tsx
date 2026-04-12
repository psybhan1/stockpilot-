import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { StatusBadge } from "@/components/app/status-badge";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { getPosMappingData } from "@/modules/dashboard/queries";

export default async function PosMappingPage() {
  const session = await requireSession(Role.MANAGER);
  const mappings = await getPosMappingData(session.locationId);

  const readyCount = mappings.filter((m) => m.mappingStatus === "READY").length;
  const reviewCount = mappings.filter((m) => m.mappingStatus === "NEEDS_REVIEW").length;
  const draftCount = mappings.filter((m) => m.mappingStatus === "RECIPE_DRAFT").length;

  return (
    <div className="space-y-10">
      {/* Header */}
      <section>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          POS Mapping
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {mappings.length} mappings
        </h1>
        <p className="mt-2 text-muted-foreground">
          Connect Square items to internal menu variants and recipes.
        </p>
      </section>

      {/* Metrics */}
      <section className="grid grid-cols-3 gap-3">
        <MetricCard label="Ready" value={readyCount} />
        <MetricCard label="Needs review" value={reviewCount} highlight={reviewCount > 0 ? "warning" : undefined} />
        <MetricCard label="Recipe draft" value={draftCount} />
      </section>

      {/* Mapping list */}
      <section className="grid gap-3 lg:grid-cols-2">
        {mappings.map((mapping) => (
          <Link
            key={mapping.id}
            href={`/pos-mapping/${mapping.id}`}
            className="group rounded-xl border border-border/50 bg-card p-4 transition-colors hover:bg-muted/30"
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
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${highlight === "warning" ? "text-amber-500" : ""}`}>{value}</p>
    </div>
  );
}
