"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Package,
  Search,
  Sparkles,
  TrendingDown,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type InventoryBrowserItem = {
  id: string;
  name: string;
  imageUrl: string | null;
  categoryLabel: string;
  categoryKey: string;
  onHandLabel: string;
  daysLeftLabel: string;
  supplierName: string;
  urgency: "CRITICAL" | "WARNING" | "INFO";
  /** Percentage of par level currently in stock (0-100+) */
  stockPercent: number;
};

type InventoryBrowserProps = {
  items: InventoryBrowserItem[];
};

const statusFilters = [
  { key: "ALL", label: "All" },
  { key: "ATTENTION", label: "Needs attention" },
  { key: "CRITICAL", label: "Critical" },
  { key: "HEALTHY", label: "Healthy" },
] as const;

type StatusFilterKey = (typeof statusFilters)[number]["key"];

function matchesStatus(item: InventoryBrowserItem, filter: StatusFilterKey) {
  if (filter === "ALL") return true;
  if (filter === "ATTENTION") return item.urgency === "CRITICAL" || item.urgency === "WARNING";
  if (filter === "CRITICAL") return item.urgency === "CRITICAL";
  return item.urgency === "INFO";
}

export function InventoryBrowser({ items }: InventoryBrowserProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");

  // Build category list from what actually exists.
  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      if (!map.has(item.categoryKey)) {
        map.set(item.categoryKey, item.categoryLabel);
      }
    }
    return Array.from(map.entries()).map(([key, label]) => ({ key, label }));
  }, [items]);

  const counts = useMemo(
    () => ({
      total: items.length,
      attention: items.filter(
        (item) => item.urgency === "CRITICAL" || item.urgency === "WARNING"
      ).length,
      critical: items.filter((item) => item.urgency === "CRITICAL").length,
      healthy: items.filter((item) => item.urgency === "INFO").length,
    }),
    [items]
  );

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      const hay = [item.name, item.categoryLabel, item.supplierName, item.daysLeftLabel]
        .join(" ")
        .toLowerCase();
      const inSearch = !query || hay.includes(query);
      const inStatus = matchesStatus(item, statusFilter);
      const inCategory = categoryFilter === "ALL" || item.categoryKey === categoryFilter;
      return inSearch && inStatus && inCategory;
    });
  }, [items, search, statusFilter, categoryFilter]);

  return (
    <div className="space-y-6">
      {/* ── Summary tiles (editorial numbered grid) ───────────────────────── */}
      <div className="grid gap-6 border-y border-border/50 py-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile index="01" icon={<Package className="size-4" />} label="All items" value={counts.total} />
        <StatTile index="02" icon={<AlertTriangle className="size-4" />} label="Needs attention" value={counts.attention} tone="amber" />
        <StatTile index="03" icon={<TrendingDown className="size-4" />} label="Critical now" value={counts.critical} tone="rose" />
        <StatTile index="04" icon={<CheckCircle2 className="size-4" />} label="Looking healthy" value={counts.healthy} tone="emerald" />
      </div>

      {/* ── Search + status filters ──────────────────────────────────────── */}
      <div className="rounded-3xl border border-border/60 bg-card/90 p-4 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_24px_60px_-24px_rgba(0,0,0,0.15)] backdrop-blur">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-xl flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by item, category, or supplier"
              className="h-11 rounded-2xl border-border/60 pl-10"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {statusFilters.map((option) => (
              <FilterPill
                key={option.key}
                label={option.label}
                active={statusFilter === option.key}
                onClick={() => setStatusFilter(option.key)}
              />
            ))}
          </div>
        </div>

        {/* Category chip row — only if there are any categories */}
        {categories.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <FilterPill
              label="All categories"
              active={categoryFilter === "ALL"}
              onClick={() => setCategoryFilter("ALL")}
              subtle
            />
            {categories.map((cat) => (
              <FilterPill
                key={cat.key}
                label={cat.label}
                active={categoryFilter === cat.key}
                onClick={() => setCategoryFilter(cat.key)}
                subtle
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Item grid ────────────────────────────────────────────────────── */}
      {visibleItems.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visibleItems.map((item) => (
            <InventoryCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-border bg-card/50 p-10 text-center">
          <Sparkles className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No items match those filters.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try clearing the search or asking StockBuddy to add something new.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────
function InventoryCard({ item }: { item: InventoryBrowserItem }) {
  const urgencyMeta = urgencyTone(item.urgency);
  const stockPct = Math.min(100, Math.max(0, item.stockPercent));

  return (
    <Link
      href={`/inventory/${item.id}`}
      className="group relative flex flex-col overflow-hidden rounded-3xl border border-border/60 bg-card/95 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_20px_50px_-24px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_28px_70px_-20px_rgba(0,0,0,0.25)]"
    >
      {/* ── Image area ───────────────────────────────────────────────────── */}
      <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-muted/80 to-muted/40">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-5xl font-semibold text-muted-foreground/60">
              {item.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}

        {/* Subtle gradient at the bottom for legibility if we ever overlay text */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background/70 to-transparent" />

        {/* Category chip — top left */}
        <span className="absolute left-3 top-3 rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-foreground/80 shadow-sm backdrop-blur">
          {item.categoryLabel}
        </span>

        {/* Urgency chip — top right */}
        <span
          className={cn(
            "absolute right-3 top-3 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur",
            urgencyMeta.chip
          )}
        >
          <span className={cn("size-1.5 rounded-full", urgencyMeta.dot)} />
          {urgencyMeta.label}
        </span>

        {/* Arrow affordance */}
        <span className="absolute bottom-3 right-3 flex size-8 items-center justify-center rounded-full bg-background/90 text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
          <ArrowUpRight className="size-4" />
        </span>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <p className="truncate font-display text-2xl leading-tight tracking-[-0.02em]">
            {item.name}
          </p>
          <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            from · {item.supplierName}
          </p>
        </div>

        {/* Stock progress bar */}
        <div className="mt-auto space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] tabular-nums text-foreground/90">
              {item.onHandLabel}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {item.daysLeftLabel}
            </span>
          </div>
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-all", urgencyMeta.bar)}
              style={{ width: `${stockPct}%` }}
            />
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── Bits ─────────────────────────────────────────────────────────────────────
function FilterPill({
  label,
  active,
  onClick,
  subtle = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : subtle
          ? "border-border/60 bg-transparent text-muted-foreground hover:border-foreground/40 hover:text-foreground"
          : "border-border bg-transparent text-muted-foreground hover:border-foreground/40 hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

function StatTile({
  index,
  icon,
  label,
  value,
  tone = "neutral",
}: {
  index: string;
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "neutral" | "amber" | "rose" | "emerald";
}) {
  const toneClass = {
    neutral: "text-foreground",
    amber: "text-amber-600 dark:text-amber-400",
    rose: "text-rose-600 dark:text-rose-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
  }[tone];

  return (
    <div className="group relative">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.26em] text-muted-foreground">
          {index} — {label}
        </span>
        <span className={cn("opacity-70", toneClass)}>{icon}</span>
      </div>
      <p
        className={cn(
          "mt-3 font-display text-5xl tabular-nums leading-none tracking-[-0.02em]",
          toneClass
        )}
      >
        {value.toString().padStart(2, "0")}
      </p>
    </div>
  );
}

function urgencyTone(urgency: InventoryBrowserItem["urgency"]) {
  if (urgency === "CRITICAL") {
    return {
      label: "Urgent",
      chip: "bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/25",
      dot: "bg-rose-500",
      bar: "bg-rose-500",
    };
  }
  if (urgency === "WARNING") {
    return {
      label: "Watch",
      chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-500/25",
      dot: "bg-amber-500",
      bar: "bg-amber-500",
    };
  }
  return {
    label: "Good",
    chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/25",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
  };
}
