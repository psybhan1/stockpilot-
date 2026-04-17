"use client";

/**
 * Client island: sortable / filterable margin table with an
 * expandable per-row ingredient breakdown.
 *
 * Server renders once; this island handles the interactive bits
 * (sort, filter, expand) without needing a separate round-trip.
 * The detail breakdown is fetched lazily on expand so we don't
 * ship a huge initial payload for restaurants with 200+ variants.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";

import type {
  MarginRow,
  MarginBreakdown,
} from "@/modules/recipes/margin-dashboard";
import { downloadCsv, isoDateForFilename, toCsv } from "@/lib/csv";

type SortKey = "margin-asc" | "margin-desc" | "cogs-desc" | "name-asc";
type Filter = "all" | "review" | "watch" | "unpriced" | "missing-data";

export function MarginTable({ rows }: { rows: MarginRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("margin-asc");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.menuItemName.toLowerCase().includes(q) && !(r.variantName ?? "").toLowerCase().includes(q)) {
        return false;
      }
      if (filter === "review" && r.severity !== "review") return false;
      if (filter === "watch" && r.severity !== "watch") return false;
      if (filter === "unpriced" && r.severity !== "unpriced") return false;
      if (filter === "missing-data" && r.componentsMissing === 0) return false;
      return true;
    });
  }, [rows, filter, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (sortKey === "name-asc") {
        return a.menuItemName.localeCompare(b.menuItemName);
      }
      if (sortKey === "cogs-desc") {
        return b.cogsCents - a.cogsCents;
      }
      // margin sort puts nulls (unpriced) last
      const am = a.marginPct;
      const bm = b.marginPct;
      if (am == null && bm == null) return 0;
      if (am == null) return 1;
      if (bm == null) return -1;
      return sortKey === "margin-asc" ? am - bm : bm - am;
    });
    return arr;
  }, [filtered, sortKey]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 p-4">
        <input
          type="search"
          placeholder="Search menu items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 min-w-[180px] flex-1 rounded-xl border border-border/60 bg-background px-3 text-sm focus:border-primary focus:outline-none"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          className="h-9 rounded-xl border border-border/60 bg-background px-3 text-sm"
          aria-label="Filter by status"
        >
          <option value="all">All variants</option>
          <option value="review">Needs review (margin &lt; 60%)</option>
          <option value="watch">Watch (60–70%)</option>
          <option value="unpriced">Unpriced</option>
          <option value="missing-data">Missing ingredient costs</option>
        </select>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="h-9 rounded-xl border border-border/60 bg-background px-3 text-sm"
          aria-label="Sort by"
        >
          <option value="margin-asc">Sort: worst margin first</option>
          <option value="margin-desc">Sort: best margin first</option>
          <option value="cogs-desc">Sort: highest cost first</option>
          <option value="name-asc">Sort: A → Z</option>
        </select>
        <button
          type="button"
          onClick={() =>
            downloadCsv(
              `stockpilot-margins-${isoDateForFilename()}.csv`,
              toCsv(sorted, [
                { header: "Menu item", value: (r) => r.menuItemName },
                { header: "Variant", value: (r) => r.variantName ?? "" },
                { header: "Category", value: (r) => r.category ?? "" },
                { header: "Price $", value: (r) => r.sellPriceCents != null ? (r.sellPriceCents / 100).toFixed(2) : "" },
                { header: "Cost $", value: (r) => r.cogsCents > 0 ? (r.cogsCents / 100).toFixed(2) : "" },
                { header: "Margin $", value: (r) => r.marginCents != null ? (r.marginCents / 100).toFixed(2) : "" },
                { header: "Margin %", value: (r) => r.marginPct != null ? (r.marginPct * 100).toFixed(1) : "" },
                { header: "Severity", value: (r) => r.severity },
                { header: "Ingredient confidence", value: (r) => (r.confidence * 100).toFixed(0) + "%" },
                { header: "Recipe status", value: (r) => r.recipeStatus },
                { header: "Components costed", value: (r) => r.componentsCosted },
                { header: "Components missing", value: (r) => r.componentsMissing },
              ])
            )
          }
          disabled={sorted.length === 0}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/60 bg-background px-3 text-sm transition hover:bg-muted disabled:opacity-50"
          title="Download the current filtered view as CSV"
        >
          <Download className="h-3.5 w-3.5" />
          CSV
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="w-8"></th>
              <th className="px-4 py-3">Menu item</th>
              <th className="px-4 py-3 text-right">Price</th>
              <th className="px-4 py-3 text-right">Cost / serving</th>
              <th className="px-4 py-3 text-right">Margin</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No variants match this filter.
                </td>
              </tr>
            ) : null}
            {sorted.map((r) => (
              <Row
                key={r.variantId}
                row={r}
                expanded={expanded === r.variantId}
                onToggle={() =>
                  setExpanded((cur) => (cur === r.variantId ? null : r.variantId))
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  row,
  expanded,
  onToggle,
}: {
  row: MarginRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-border/40 transition hover:bg-muted/40"
        onClick={onToggle}
      >
        <td className="px-2 py-3 text-muted-foreground">
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </td>
        <td className="px-4 py-3">
          <div className="font-medium">
            {row.menuItemName}
            {row.variantName ? (
              <span className="text-muted-foreground"> · {row.variantName}</span>
            ) : null}
          </div>
          {row.warnings.length > 0 ? (
            <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">
              {row.warnings[0]}
              {row.warnings.length > 1 ? ` (+${row.warnings.length - 1} more)` : ""}
            </div>
          ) : null}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {row.sellPriceCents != null ? `$${(row.sellPriceCents / 100).toFixed(2)}` : "—"}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {row.cogsCents > 0 ? `$${(row.cogsCents / 100).toFixed(2)}` : "—"}
        </td>
        <td className="px-4 py-3 text-right">
          {row.marginPct != null ? (
            <span className="flex items-center justify-end gap-1 tabular-nums">
              <span className="font-medium">{Math.round(row.marginPct * 100)}%</span>
              <span className="text-xs text-muted-foreground">
                (${((row.marginCents ?? 0) / 100).toFixed(2)})
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          <SeverityPill row={row} />
        </td>
      </tr>
      {expanded ? <BreakdownRow variantId={row.variantId} /> : null}
    </>
  );
}

function SeverityPill({ row }: { row: MarginRow }) {
  const base = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs";
  if (row.severity === "unpriced") {
    return (
      <span className={`${base} border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200`}>
        No price
      </span>
    );
  }
  if (row.severity === "review") {
    return (
      <span className={`${base} border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300`}>
        Review
      </span>
    );
  }
  if (row.severity === "watch") {
    return (
      <span className={`${base} border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200`}>
        Watch
      </span>
    );
  }
  return (
    <span className={`${base} border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300`}>
      Healthy
    </span>
  );
}

/**
 * Fetch per-variant breakdown on expand. Cached by variantId in
 * component state so expand/collapse is free after the first fetch.
 */
function BreakdownRow({ variantId }: { variantId: string }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; data: MarginBreakdown }
    | { status: "error"; message: string }
  >({ status: "loading" });

  useMemo(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/menu-items/${encodeURIComponent(variantId)}/margin`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { breakdown: MarginBreakdown };
        if (!cancelled) setState({ status: "ready", data: data.breakdown });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // variantId is the only input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantId]);

  return (
    <tr className="bg-muted/20">
      <td colSpan={6} className="px-4 py-4">
        {state.status === "loading" ? (
          <BreakdownSkeleton />
        ) : state.status === "error" ? (
          <div className="text-xs text-red-700 dark:text-red-300">
            Couldn&apos;t load the ingredient breakdown ({state.message}). Close
            and reopen this row to retry.
          </div>
        ) : (
          <BreakdownTable data={state.data} />
        )}
      </td>
    </tr>
  );
}

function BreakdownSkeleton() {
  // Shimmers 3 ingredient rows + a total. Matches the real table's
  // shape so the page doesn't jump layout when data arrives.
  return (
    <div className="space-y-3">
      <div className="h-3 w-32 animate-pulse rounded bg-muted/70" />
      <div className="space-y-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-3 w-40 animate-pulse rounded bg-muted/60" />
            <div className="h-3 w-24 animate-pulse rounded bg-muted/50" />
            <div className="ml-auto h-3 w-16 animate-pulse rounded bg-muted/60" />
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3 border-t border-border/40 pt-2">
        <div className="h-3 w-24 animate-pulse rounded bg-muted/70" />
        <div className="ml-auto h-3 w-20 animate-pulse rounded bg-muted/70" />
      </div>
    </div>
  );
}

function BreakdownTable({ data }: { data: MarginBreakdown }) {
  const required = data.components.filter((c) => !c.optional && !c.modifierKey);
  const optional = data.components.filter((c) => c.optional || c.modifierKey);
  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        Ingredient cost breakdown
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1">Ingredient</th>
            <th className="py-1">Per-serving amount</th>
            <th className="py-1 text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {required.map((c) => (
            <tr key={c.componentId} className="border-b border-border/30 last:border-0">
              <td className="py-1">{c.inventoryItemName}</td>
              <td className="py-1 text-muted-foreground">
                {c.quantityBase} {c.displayUnit.toLowerCase()}
              </td>
              <td className="py-1 text-right tabular-nums">
                {c.costCents != null ? (
                  `$${(c.costCents / 100).toFixed(2)}`
                ) : (
                  <span className="text-amber-700 dark:text-amber-300">no data</span>
                )}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-border font-medium">
            <td className="py-2" colSpan={2}>
              Total cost per serving
            </td>
            <td className="py-2 text-right tabular-nums">
              ${(data.cogsCents / 100).toFixed(2)}
            </td>
          </tr>
        </tbody>
      </table>
      {optional.length > 0 ? (
        <div>
          <div className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">
            Optional modifiers (not in base cost)
          </div>
          <table className="w-full text-sm">
            <tbody>
              {optional.map((c) => (
                <tr key={c.componentId}>
                  <td className="py-1">
                    {c.inventoryItemName}
                    {c.modifierKey ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({c.modifierKey})
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1 text-muted-foreground">
                    {c.quantityBase} {c.displayUnit.toLowerCase()}
                  </td>
                  <td className="py-1 text-right tabular-nums text-muted-foreground">
                    {c.costCents != null
                      ? `+$${(c.costCents / 100).toFixed(2)}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data.warnings.length > 0 ? (
        <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">
          {data.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
