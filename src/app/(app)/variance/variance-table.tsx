"use client";

/**
 * Client island: sortable + filterable variance table with a lazy
 * expandable "every movement that contributed to this number"
 * detail row. Worst-offenders-first by dollar loss.
 */

import { useMemo, useState, useEffect } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { VarianceRow } from "@/modules/variance/report";

type Filter = "all" | "review" | "watch" | "shrinkage-only";

export function VarianceTable({
  rows,
  days,
}: {
  rows: VarianceRow[];
  days: number;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.itemName.toLowerCase().includes(q) && !(r.category ?? "").toLowerCase().includes(q)) {
        return false;
      }
      if (filter === "review" && r.severity !== "review") return false;
      if (filter === "watch" && r.severity !== "watch") return false;
      if (filter === "shrinkage-only" && (r.shrinkageCents ?? 0) === 0) return false;
      return true;
    });
  }, [rows, filter, search]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 p-4">
        <input
          type="search"
          placeholder="Search item or category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 min-w-[180px] flex-1 rounded-xl border border-border/60 bg-background px-3 text-sm focus:border-primary focus:outline-none"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          className="h-9 rounded-xl border border-border/60 bg-background px-3 text-sm"
          aria-label="Filter"
        >
          <option value="all">All items with activity</option>
          <option value="review">Review (&gt; 5% shrinkage or &gt; $50 loss)</option>
          <option value="watch">Watch (2–5% shrinkage or $15+)</option>
          <option value="shrinkage-only">Only items with shrinkage</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="w-8"></th>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3 text-right">Theoretical usage</th>
              <th className="px-4 py-3 text-right">Tracked waste</th>
              <th className="px-4 py-3 text-right">Shrinkage</th>
              <th className="px-4 py-3 text-right">Loss $</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No items match this filter.
                </td>
              </tr>
            ) : null}
            {filtered.map((r) => (
              <Row
                key={r.inventoryItemId}
                row={r}
                days={days}
                expanded={expanded === r.inventoryItemId}
                onToggle={() =>
                  setExpanded((cur) => (cur === r.inventoryItemId ? null : r.inventoryItemId))
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
  days,
  expanded,
  onToggle,
}: {
  row: VarianceRow;
  days: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const lossCents =
    (row.shrinkageCents ?? 0) + (row.trackedWasteCents ?? 0);
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
          <div className="font-medium">{row.itemName}</div>
          {row.category ? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {row.category}
            </div>
          ) : null}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
          {row.theoreticalUsageBase > 0
            ? `${fmtQuantity(row.theoreticalUsageBase, row.displayUnit)}${
                row.theoreticalUsageCents != null
                  ? ` · ${fmtCents(row.theoreticalUsageCents)}`
                  : ""
              }`
            : "—"}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {row.trackedWasteBase > 0 ? (
            <span>
              {fmtQuantity(row.trackedWasteBase, row.displayUnit)}
              {row.trackedWasteCents != null ? (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({fmtCents(row.trackedWasteCents)})
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {row.shrinkageBase !== 0 ? (
            <span>
              {row.shrinkageBase > 0 ? "" : "−"}
              {fmtQuantity(Math.abs(row.shrinkageBase), row.displayUnit)}
              {row.shrinkagePct != null ? (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({(row.shrinkagePct * 100).toFixed(1)}%)
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-right tabular-nums font-medium">
          {lossCents > 0 ? fmtCents(lossCents) : "—"}
        </td>
        <td className="px-4 py-3">
          <SeverityPill severity={row.severity} />
        </td>
      </tr>
      {expanded ? (
        <DetailRow itemId={row.inventoryItemId} days={days} row={row} />
      ) : null}
    </>
  );
}

function SeverityPill({ severity }: { severity: VarianceRow["severity"] }) {
  const base =
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs";
  if (severity === "review") {
    return (
      <span
        className={`${base} border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300`}
      >
        Review
      </span>
    );
  }
  if (severity === "watch") {
    return (
      <span
        className={`${base} border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200`}
      >
        Watch
      </span>
    );
  }
  return (
    <span
      className={`${base} border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300`}
    >
      Clean
    </span>
  );
}

type DetailResponse = {
  from: string;
  to: string;
  item: {
    id: string;
    name: string;
    displayUnit: string;
    packSizeBase: number;
    unitCostCents: number | null;
  };
  movements: Array<{
    id: string;
    type: string;
    deltaBase: number;
    notes: string | null;
    performedAt: string;
    sourceType: string;
    sourceId: string;
  }>;
};

function DetailRow({
  itemId,
  days,
  row,
}: {
  itemId: string;
  days: number;
  row: VarianceRow;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; data: DetailResponse }
    | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/variance/${encodeURIComponent(itemId)}?days=${days}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            message?: string;
          };
          throw new Error(body.message || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as DetailResponse;
        if (!cancelled) setState({ status: "ready", data });
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
  }, [itemId, days]);

  return (
    <tr className="bg-muted/20">
      <td colSpan={7} className="px-4 py-4">
        {state.status === "loading" ? (
          <div className="text-xs text-muted-foreground">Loading every movement…</div>
        ) : state.status === "error" ? (
          <div className="text-xs text-red-700 dark:text-red-300">
            Couldn&apos;t load breakdown: {state.message}
          </div>
        ) : (
          <DetailTable data={state.data} row={row} />
        )}
      </td>
    </tr>
  );
}

function DetailTable({
  data,
  row,
}: {
  data: DetailResponse;
  row: VarianceRow;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-xl border border-border/60 bg-card p-3 text-xs sm:grid-cols-4">
        <BreakdownStat
          label="Received"
          value={fmtQuantity(row.receivedBase, row.displayUnit)}
          tone="neutral"
        />
        <BreakdownStat
          label="POS depleted (theoretical)"
          value={fmtQuantity(row.theoreticalUsageBase, row.displayUnit)}
          tone="neutral"
        />
        <BreakdownStat
          label="Tracked waste"
          value={fmtQuantity(row.trackedWasteBase, row.displayUnit)}
          tone={row.trackedWasteBase > 0 ? "warn" : "neutral"}
        />
        <BreakdownStat
          label="Shrinkage"
          value={`${row.shrinkageBase > 0 ? "" : "−"}${fmtQuantity(Math.abs(row.shrinkageBase), row.displayUnit)}`}
          tone={row.shrinkageBase < 0 ? "bad" : row.shrinkageBase > 0 ? "warn" : "neutral"}
        />
      </div>

      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        Every movement in this window ({data.movements.length}):
      </div>
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1">When</th>
              <th className="py-1">Type</th>
              <th className="py-1 text-right">Δ</th>
              <th className="py-1">Notes</th>
            </tr>
          </thead>
          <tbody>
            {data.movements.map((m) => (
              <tr key={m.id} className="border-b border-border/30 last:border-0">
                <td className="py-1 text-muted-foreground">
                  {new Date(m.performedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </td>
                <td className="py-1">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${movementTypeClass(m.type)}`}
                  >
                    {humanizeType(m.type)}
                  </span>
                </td>
                <td className="py-1 text-right tabular-nums">
                  {m.deltaBase > 0 ? "+" : ""}
                  {fmtQuantity(Math.abs(m.deltaBase), row.displayUnit)}
                </td>
                <td className="py-1 text-xs text-muted-foreground">
                  {m.notes ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BreakdownStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "warn" | "bad";
}) {
  const color =
    tone === "bad"
      ? "text-red-700 dark:text-red-300"
      : tone === "warn"
        ? "text-amber-800 dark:text-amber-200"
        : "text-foreground";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-0.5 text-sm font-medium tabular-nums ${color}`}>
        {value}
      </div>
    </div>
  );
}

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtQuantity(base: number, displayUnit: string): string {
  // Base units are GRAM / MILLILITER / COUNT. Render in display
  // unit if possible, else raw.
  if (base === 0) return `0 ${displayUnit.toLowerCase()}`;
  if (displayUnit === "KILOGRAM") return `${(base / 1000).toFixed(2)} kg`;
  if (displayUnit === "LITER") return `${(base / 1000).toFixed(2)} L`;
  if (displayUnit === "POUND") return `${(base / 454).toFixed(2)} lb`;
  if (displayUnit === "GRAM") return `${base} g`;
  if (displayUnit === "MILLILITER") return `${base} ml`;
  return `${base} ${displayUnit.toLowerCase()}`;
}

function humanizeType(t: string): string {
  return t
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function movementTypeClass(t: string): string {
  switch (t) {
    case "POS_DEPLETION":
    case "RECEIVING":
    case "RETURN":
      return "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
    case "WASTE":
    case "BREAKAGE":
    case "TRANSFER":
      return "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200";
    case "MANUAL_COUNT_ADJUSTMENT":
    case "CORRECTION":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    default:
      return "border-border bg-card text-muted-foreground";
  }
}
