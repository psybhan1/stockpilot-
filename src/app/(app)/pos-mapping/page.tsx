import Link from "next/link";
import { ArrowRightLeft, Link2, ShieldCheck } from "lucide-react";

import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { getPosMappingData } from "@/modules/dashboard/queries";

export default async function PosMappingPage() {
  const session = await requireSession(Role.MANAGER);
  const mappings = await getPosMappingData(session.locationId);

  const readyCount = mappings.filter((mapping) => mapping.mappingStatus === "READY").length;
  const reviewCount = mappings.filter((mapping) => mapping.mappingStatus === "NEEDS_REVIEW").length;
  const draftCount = mappings.filter((mapping) => mapping.mappingStatus === "RECIPE_DRAFT").length;

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border-border/60 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(255,255,255,0.92))] shadow-xl shadow-black/5 dark:bg-[linear-gradient(135deg,rgba(68,64,60,0.98),rgba(28,25,23,0.94))]">
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.22em] text-amber-600 dark:text-amber-300">
              POS mapping
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Keep Square names cleanly connected to the internal menu and recipe model.
            </h1>
            <p className="mt-3 text-base text-muted-foreground sm:text-lg">
              A sale should only touch inventory when its mapping is safe. This page shows which
              variations are ready and which ones still need recipe or review work.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard label="Ready" value={readyCount} />
            <MetricCard label="Needs review" value={reviewCount} />
            <MetricCard label="Recipe draft" value={draftCount} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {mappings.map((mapping) => (
          <Link
            key={mapping.id}
            href={`/pos-mapping/${mapping.id}`}
            className="rounded-[28px] border border-border/60 bg-card/88 p-5 shadow-lg shadow-black/5 transition-all hover:-translate-y-0.5 hover:border-primary/30"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{mapping.posVariation.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {mapping.posVariation.catalogItem.name}
                </p>
              </div>
              <StatusBadge
                label={
                  mapping.mappingStatus === "READY"
                    ? "Ready"
                    : mapping.mappingStatus === "NEEDS_REVIEW"
                      ? "Needs review"
                      : mapping.mappingStatus === "RECIPE_DRAFT"
                        ? "Recipe draft"
                        : "Unmapped"
                }
                tone={mapping.mappingStatus === "READY" ? "success" : "warning"}
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <InfoPill
                icon={Link2}
                label="Internal variant"
                value={mapping.menuItemVariant.name}
              />
              <InfoPill
                icon={ArrowRightLeft}
                label="Recipe"
                value={mapping.recipe?.status ?? "No recipe"}
              />
              <InfoPill
                icon={ShieldCheck}
                label="Service mode"
                value={mapping.posVariation.serviceMode ?? "Unknown"}
              />
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
  icon: typeof Link2;
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
