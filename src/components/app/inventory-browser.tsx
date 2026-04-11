"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";

import { StatusBadge } from "@/components/app/status-badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type InventoryBrowserItem = {
  id: string;
  name: string;
  imageUrl: string | null;
  categoryLabel: string;
  onHandLabel: string;
  daysLeftLabel: string;
  supplierName: string;
  urgency: "CRITICAL" | "WARNING" | "INFO";
};

type InventoryBrowserProps = {
  items: InventoryBrowserItem[];
};

const filters = [
  { key: "ALL", label: "All" },
  { key: "ATTENTION", label: "Needs attention" },
  { key: "CRITICAL", label: "Critical" },
  { key: "HEALTHY", label: "Healthy" },
] as const;

type FilterKey = (typeof filters)[number]["key"];

function urgencyTone(urgency: InventoryBrowserItem["urgency"]) {
  if (urgency === "CRITICAL") {
    return "critical" as const;
  }

  if (urgency === "WARNING") {
    return "warning" as const;
  }

  return "success" as const;
}

function matchesFilter(item: InventoryBrowserItem, filter: FilterKey) {
  if (filter === "ALL") {
    return true;
  }

  if (filter === "ATTENTION") {
    return item.urgency === "CRITICAL" || item.urgency === "WARNING";
  }

  if (filter === "CRITICAL") {
    return item.urgency === "CRITICAL";
  }

  return item.urgency === "INFO";
}

export function InventoryBrowser({ items }: InventoryBrowserProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("ALL");

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
      const searchableText = [
        item.name,
        item.categoryLabel,
        item.supplierName,
        item.daysLeftLabel,
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(query) && matchesFilter(item, filter);
    });
  }, [filter, items, search]);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="All items" value={counts.total} />
        <SummaryCard label="Needs attention" value={counts.attention} />
        <SummaryCard label="Critical now" value={counts.critical} />
        <SummaryCard label="Looking healthy" value={counts.healthy} />
      </div>

      <div className="rounded-[28px] border border-border/60 bg-card/88 p-4 shadow-lg shadow-black/5 backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-xl flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by item, category, or supplier"
              className="h-11 rounded-2xl pl-10"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {filters.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setFilter(option.key)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                  filter === option.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {visibleItems.length ? (
            visibleItems.map((item) => (
              <Link
                key={item.id}
                href={`/inventory/${item.id}`}
                className="group rounded-[26px] border border-border/60 bg-background/90 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-black/5"
              >
                <div className="flex items-start gap-3">
                  <div className="relative size-16 shrink-0 overflow-hidden rounded-2xl border border-border/60 bg-muted">
                    {item.imageUrl ? (
                      <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-lg font-semibold text-muted-foreground">
                        {item.name.charAt(0)}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold">{item.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {item.categoryLabel}
                        </p>
                      </div>
                      <StatusBadge
                        label={
                          item.urgency === "INFO"
                            ? "Good"
                            : item.urgency === "WARNING"
                            ? "Watch"
                            : "Urgent"
                        }
                        tone={urgencyTone(item.urgency)}
                      />
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <InfoPair label="On hand" value={item.onHandLabel} />
                      <InfoPair label="Days left" value={item.daysLeftLabel} />
                      <InfoPair
                        label="Supplier"
                        value={item.supplierName}
                        className="col-span-2"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between text-sm font-medium text-muted-foreground group-hover:text-foreground">
                  Open item
                  <ChevronRight className="size-4" />
                </div>
              </Link>
            ))
          ) : (
            <div className="rounded-[24px] border border-dashed border-border p-8 text-center text-sm text-muted-foreground md:col-span-2 2xl:col-span-3">
              No items match that search yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[24px] border border-border/60 bg-card/84 p-4 shadow-lg shadow-black/5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function InfoPair({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-border/60 bg-card px-3 py-2", className)}>
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}
