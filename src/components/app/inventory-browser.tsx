"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

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
  stockPercent: number;
};

type InventoryBrowserProps = { items: InventoryBrowserItem[] };

const statusFilters = [
  { key: "ALL", label: "All" },
  { key: "ATTENTION", label: "Attention" },
  { key: "CRITICAL", label: "Critical" },
  { key: "HEALTHY", label: "Healthy" },
] as const;

type StatusKey = (typeof statusFilters)[number]["key"];

function matchesStatus(item: InventoryBrowserItem, filter: StatusKey) {
  if (filter === "ALL") return true;
  if (filter === "ATTENTION") return item.urgency !== "INFO";
  if (filter === "CRITICAL") return item.urgency === "CRITICAL";
  return item.urgency === "INFO";
}

export function InventoryBrowser({ items }: InventoryBrowserProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusKey>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of items) if (!map.has(i.categoryKey)) map.set(i.categoryKey, i.categoryLabel);
    return Array.from(map.entries()).map(([key, label]) => ({ key, label }));
  }, [items]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      const hay = `${i.name} ${i.categoryLabel} ${i.supplierName}`.toLowerCase();
      return (
        (!q || hay.includes(q)) &&
        matchesStatus(i, statusFilter) &&
        (categoryFilter === "ALL" || i.categoryKey === categoryFilter)
      );
    });
  }, [items, search, statusFilter, categoryFilter]);

  return (
    <div className="space-y-6">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items, categories, suppliers…"
            className="h-10 rounded-md border-border pl-10 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-border bg-card p-0.5">
            {statusFilters.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setStatusFilter(opt.key)}
                className={cn(
                  "rounded-[4px] px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] transition-colors",
                  statusFilter === opt.key
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Category chips ──────────────────────────────────────────── */}
      {categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <CatChip
            label="All"
            active={categoryFilter === "ALL"}
            onClick={() => setCategoryFilter("ALL")}
          />
          {categories.map((c) => (
            <CatChip
              key={c.key}
              label={c.label}
              active={categoryFilter === c.key}
              onClick={() => setCategoryFilter(c.key)}
            />
          ))}
        </div>
      )}

      {/* ── List ───────────────────────────────────────────────────── */}
      {visibleItems.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visibleItems.map((item) => (
            <InventoryCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No items match those filters.
        </div>
      )}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────
function InventoryCard({ item }: { item: InventoryBrowserItem }) {
  const urgency = urgencyMeta(item.urgency);
  const pct = Math.min(100, Math.max(0, item.stockPercent));
  return (
    <Link
      href={`/inventory/${item.id}`}
      className="group flex gap-4 rounded-md border border-border bg-card p-3 transition-colors hover:border-foreground/30"
    >
      <div className="relative size-20 shrink-0 overflow-hidden rounded bg-muted">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            sizes="80px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-2xl font-bold text-muted-foreground">
            {item.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-base font-semibold tracking-tight">{item.name}</p>
            <span
              className={cn(
                "shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em]",
                urgency.chip
              )}
            >
              {urgency.label}
            </span>
          </div>
          <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {item.categoryLabel} · {item.supplierName}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs tabular-nums">{item.onHandLabel}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {item.daysLeftLabel}
            </span>
          </div>
          <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full", urgency.bar)} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    </Link>
  );
}

function CatChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.16em] transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-transparent text-muted-foreground hover:border-foreground/40 hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

function urgencyMeta(u: InventoryBrowserItem["urgency"]) {
  if (u === "CRITICAL") {
    return {
      label: "Urgent",
      chip: "bg-accent text-accent-foreground",
      bar: "bg-accent",
    };
  }
  if (u === "WARNING") {
    return {
      label: "Watch",
      chip: "bg-foreground/80 text-background",
      bar: "bg-foreground/60",
    };
  }
  return {
    label: "Good",
    chip: "bg-muted text-muted-foreground",
    bar: "bg-muted-foreground/30",
  };
}
