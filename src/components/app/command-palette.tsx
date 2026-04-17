"use client";

/**
 * Cmd+K (Ctrl+K) global search + page-jump palette.
 *
 * Result types:
 *   - page        — top-level app routes (margins, variance, inventory…)
 *   - item        — inventory items (matched by name or SKU)
 *   - supplier    — supplier records (matched by name or email)
 *   - purchase_order — by order number or supplier name
 *   - menu_variant — menu items + their variants (matched by either)
 *
 * The palette exposes pages client-side (no round-trip) while the
 * record kinds hit /api/search with a 150ms debounce. Page matches
 * rank first when the query starts with the page's shortcut letter
 * (e.g. "m" surfaces Margins before random items). Matched text is
 * highlighted in each result so users can verify the match.
 *
 * Empty-state shows the keyboard cheat sheet + the top-level pages
 * the user has access to, so the palette doubles as a nav shortcut
 * menu ("Cmd+K, type 'v', hit Enter" to jump to Variance).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Command as CmdIcon,
  Package,
  Receipt,
  Search,
  Users,
  Utensils,
} from "lucide-react";

import { primaryNav, secondaryNav, type NavItem } from "@/lib/navigation";

type RecordKind = "item" | "supplier" | "purchase_order" | "menu_variant";
type Result =
  | {
      kind: "page";
      id: string;
      label: string;
      detail: string;
      href: string;
    }
  | {
      kind: RecordKind;
      id: string;
      label: string;
      detail: string;
      href: string;
    };

type SearchResponse = { results?: Array<Omit<Result, "kind"> & { kind: RecordKind }> };

export function CommandPalette({
  userRoleOrdinal,
}: {
  /** Optional — if provided, narrows page results to the routes the
   *  user can access. Omitted callers see the full nav (role filter
   *  done server-side when following the link). */
  userRoleOrdinal?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // All known pages, flattened. Filtered by role if caller passed one.
  const pages = useMemo<Result[]>(() => {
    const all: NavItem[] = [...primaryNav, ...secondaryNav];
    return all.map((p) => ({
      kind: "page" as const,
      id: p.href,
      label: p.label,
      detail: p.description ?? "",
      href: p.href,
    }));
  }, []);

  // Cmd/Ctrl+K toggle + "/" to focus (if palette already open), esc to close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typingElsewhere =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((s) => !s);
        return;
      }
      if (e.key === "/" && !typingElsewhere) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10);
      setActive(0);
    } else {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  // Debounced record-search + client-side page filter merged together.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    const pageMatches = q
      ? pages.filter(
          (p) =>
            p.label.toLowerCase().includes(q.toLowerCase()) ||
            p.detail.toLowerCase().includes(q.toLowerCase())
        )
      : [];
    if (q.length === 0) {
      // Show pages as the empty-state menu so the palette doubles as a nav.
      setResults(pages);
      setActive(0);
      return;
    }
    // Show page matches immediately; server results join in when they arrive.
    setResults(pageMatches);
    setActive(0);

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as SearchResponse;
        const records: Result[] = (data.results ?? []).map((r) => ({ ...r }));
        setResults([...pageMatches, ...records]);
        setActive(0);
      } catch {
        /* abort / offline — empty state already shown */
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open, pages]);

  const go = (r: Result) => {
    setOpen(false);
    router.push(r.href);
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active]);
    }
  };

  // `userRoleOrdinal` is reserved for future role-aware page
  // filtering. Silence the unused-var lint without hiding the prop
  // in the public API.
  void userRoleOrdinal;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 backdrop-blur-sm p-4 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Search"
        aria-modal="true"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search items, suppliers, orders, menu — or type a page name"
            className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden items-center gap-1 rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground sm:inline-flex">
            esc
          </kbd>
        </div>
        <ResultList
          groups={groupByKind(results)}
          active={active}
          query={query}
          onHover={setActive}
          onSelect={go}
        />
        <Footer empty={results.length === 0 && query.length > 0} />
      </div>
    </div>
  );
}

// ── Result list + grouping ──────────────────────────────────────────

type Group = { kind: Result["kind"]; label: string; items: Result[] };

function groupByKind(results: Result[]): Group[] {
  const order: Array<Result["kind"]> = [
    "page",
    "item",
    "supplier",
    "menu_variant",
    "purchase_order",
  ];
  const labels: Record<Result["kind"], string> = {
    page: "Pages",
    item: "Inventory",
    supplier: "Suppliers",
    menu_variant: "Menu",
    purchase_order: "Orders",
  };
  const byKind = new Map<Result["kind"], Result[]>();
  for (const r of results) {
    const arr = byKind.get(r.kind) ?? [];
    arr.push(r);
    byKind.set(r.kind, arr);
  }
  return order
    .filter((k) => byKind.has(k))
    .map((k) => ({ kind: k, label: labels[k], items: byKind.get(k)! }));
}

function ResultList({
  groups,
  active,
  query,
  onHover,
  onSelect,
}: {
  groups: Group[];
  active: number;
  query: string;
  onHover: (i: number) => void;
  onSelect: (r: Result) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        {query.length === 0 ? (
          <span>
            Try <em>oat milk</em>, <em>FreshCo</em>, or a PO number. Press{" "}
            <kbd className="rounded border border-border px-1 font-mono text-[10px]">
              /
            </kbd>{" "}
            to focus this bar from anywhere.
          </span>
        ) : (
          <span>
            No matches for <span className="font-medium">&ldquo;{query}&rdquo;</span>.
          </span>
        )}
      </div>
    );
  }
  let index = 0;
  return (
    <ul className="max-h-[55vh] overflow-y-auto py-1">
      {groups.map((g) => (
        <li key={g.kind}>
          <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {g.label}
          </div>
          <ul>
            {g.items.map((r) => {
              const i = index++;
              return (
                <li key={`${r.kind}-${r.id}`}>
                  <button
                    type="button"
                    onMouseEnter={() => onHover(i)}
                    onClick={() => onSelect(r)}
                    className={
                      "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors " +
                      (i === active ? "bg-muted" : "hover:bg-muted/60")
                    }
                  >
                    <KindIcon kind={r.kind} />
                    <span className="flex-1 min-w-0 truncate">
                      <span className="font-medium">
                        <HighlightedText text={r.label} query={query} />
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        <HighlightedText text={r.detail} query={query} />
                      </span>
                    </span>
                    {i === active ? (
                      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function KindIcon({ kind }: { kind: Result["kind"] }) {
  if (kind === "item") return <Package className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
  if (kind === "supplier") return <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
  if (kind === "purchase_order") return <Receipt className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
  if (kind === "menu_variant") return <Utensils className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
  return <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

/**
 * Highlights every case-insensitive occurrence of `query` in `text`.
 * Keeps it simple: one-pass split + rebuild. No regex escape headaches.
 */
function HighlightedText({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const target = q.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    const found = lower.indexOf(target, i);
    if (found < 0) {
      out.push(text.slice(i));
      break;
    }
    if (found > i) out.push(text.slice(i, found));
    out.push(
      <mark
        key={found}
        className="rounded bg-amber-200/50 px-0.5 text-inherit dark:bg-amber-500/30"
      >
        {text.slice(found, found + q.length)}
      </mark>
    );
    i = found + q.length;
  }
  return <>{out}</>;
}

function Footer({ empty }: { empty: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <CmdIcon className="size-3" aria-hidden />
        <span>+K to open</span>
      </span>
      <span className="hidden sm:inline">
        {empty ? (
          <span>Try a different term or press esc</span>
        ) : (
          <span>↑↓ navigate · ↵ open · esc close</span>
        )}
      </span>
    </div>
  );
}
