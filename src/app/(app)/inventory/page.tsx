import { Role } from "@/lib/domain-enums";

import { InventoryBrowser } from "@/components/app/inventory-browser";
import {
  EditorialBackground,
  Eyebrow,
  LiveDot,
  MarqueeStrip,
  RevealText,
  ScrollReveal,
} from "@/components/app/editorial";
import { db } from "@/lib/db";
import { formatRelativeDays } from "@/lib/format";
import { requireSession } from "@/modules/auth/session";
import { getInventoryList } from "@/modules/dashboard/queries";
import { buildInventoryImageUrl } from "@/modules/inventory/image-resolver";
import { formatQuantityBase } from "@/modules/inventory/units";

// Optional: set STOCKPILOT_HERO_VIDEO_URL to point at any public mp4 to
// layer a moving background video behind the hero. The gradient mesh +
// grain overlay is always on.
const heroVideoUrl = process.env.STOCKPILOT_HERO_VIDEO_URL;

export default async function InventoryPage() {
  const session = await requireSession(Role.SUPERVISOR);
  const items = await getInventoryList(session.locationId);

  const missing = items.filter((item) => !item.imageUrl);
  if (missing.length > 0) {
    await Promise.all(
      missing.map(async (item) => {
        const brandMatch = item.notes?.match(/brand:\s*([^|]+)/i);
        const brand = brandMatch?.[1]?.trim() ?? null;
        const url = buildInventoryImageUrl({
          name: item.name,
          brand,
          category: item.category,
        });
        item.imageUrl = url;
        await db.inventoryItem.update({
          where: { id: item.id },
          data: { imageUrl: url },
        });
      })
    );
  }

  const totalItems = items.length;
  const criticalCount = items.filter((i) => i.snapshot?.urgency === "CRITICAL").length;
  const watchCount = items.filter((i) => i.snapshot?.urgency === "WARNING").length;
  const suppliersTracked = new Set(
    items.map((i) => i.primarySupplier?.id).filter(Boolean)
  ).size;

  const marqueeLines = [
    `${totalItems.toString().padStart(3, "0")} items`,
    `${criticalCount.toString().padStart(2, "0")} critical`,
    `${watchCount.toString().padStart(2, "0")} watching`,
    `${suppliersTracked.toString().padStart(2, "0")} suppliers`,
    "live inventory",
    "ai-assisted",
    "voice + chat",
  ];

  return (
    <div className="space-y-10">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden rounded-[36px] border border-border/60 bg-card/40 backdrop-blur">
        <EditorialBackground videoSrc={heroVideoUrl} vignette />

        <div className="relative z-10 flex min-h-[420px] flex-col justify-between p-8 sm:p-12">
          <div className="flex items-center justify-between">
            <Eyebrow>Inventory · {session.locationName}</Eyebrow>
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              <LiveDot />
              Live
            </div>
          </div>

          <div className="mt-16">
            <RevealText
              as="h1"
              className="font-display text-[clamp(3rem,9vw,7.5rem)] leading-[0.95] tracking-[-0.04em]"
            >
              {totalItems === 1 ? "One item" : `${totalItems} items`}
            </RevealText>
            <RevealText
              as="p"
              startDelay={400}
              stagger={14}
              className="mt-2 font-display italic text-[clamp(1.5rem,4vw,3rem)] leading-tight text-muted-foreground"
            >
              under your watch.
            </RevealText>
          </div>

          <ScrollReveal delay={600}>
            <div className="mt-12 grid gap-6 sm:grid-cols-3">
              <HeroStat label="Needs attention" value={criticalCount + watchCount} />
              <HeroStat label="Critical now" value={criticalCount} highlight />
              <HeroStat label="Suppliers" value={suppliersTracked} />
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ── Marquee strip ─────────────────────────────────────────────── */}
      <MarqueeStrip items={marqueeLines} speed="slow" />

      {/* ── The actual browser ────────────────────────────────────────── */}
      <ScrollReveal>
        <InventoryBrowser
          items={items.map((item) => {
            const par = item.parLevelBase > 0 ? item.parLevelBase : 1;
            const stockPercent = Math.round((item.stockOnHandBase / par) * 100);
            return {
              id: item.id,
              name: item.name,
              imageUrl: item.imageUrl,
              categoryKey: item.category,
              categoryLabel: item.category.replaceAll("_", " ").toLowerCase(),
              onHandLabel: formatQuantityBase(
                item.stockOnHandBase,
                item.displayUnit,
                item.packSizeBase
              ),
              daysLeftLabel: formatRelativeDays(item.snapshot?.daysLeft),
              supplierName: item.primarySupplier?.name ?? "Unassigned",
              urgency: item.snapshot?.urgency ?? "INFO",
              stockPercent,
            };
          })}
        />
      </ScrollReveal>
    </div>
  );
}

function HeroStat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="group relative">
      <div className="rule-thin mb-4" />
      <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-muted-foreground">
        {label}
      </p>
      <p
        className={
          "mt-3 font-display text-6xl tabular-nums leading-none " +
          (highlight ? "text-destructive" : "text-foreground")
        }
      >
        {value.toString().padStart(2, "0")}
      </p>
    </div>
  );
}
