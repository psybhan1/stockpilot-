"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, MapPin } from "lucide-react";

export type LocationSwitcherItem = {
  id: string;
  name: string;
};

export function LocationSwitcher({
  activeId,
  activeLabel,
  locations,
}: {
  activeId: string;
  activeLabel: string;
  locations: LocationSwitcherItem[];
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const router = useRouter();

  if (locations.length <= 1) {
    return (
      <div className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <MapPin className="size-3.5" aria-hidden />
        <span className="font-medium text-foreground/85">{activeLabel}</span>
      </div>
    );
  }

  const switchTo = async (id: string) => {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setLoading(id);
    try {
      const res = await fetch("/api/session/switch-location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setOpen(false);
      router.refresh();
    } catch {
      setLoading(null);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 text-[13px] font-medium text-foreground/85 shadow-sm hover:bg-card/80"
      >
        <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="max-w-[140px] truncate">{activeLabel}</span>
        <ChevronsUpDown className="size-3 text-muted-foreground" aria-hidden />
      </button>
      {open ? (
        <div
          role="listbox"
          className="absolute right-0 top-[calc(100%+6px)] z-40 w-56 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xl"
        >
          <div className="border-b border-border/60 px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            Switch location
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {locations.map((loc) => (
              <li key={loc.id}>
                <button
                  type="button"
                  onClick={() => switchTo(loc.id)}
                  disabled={loading === loc.id}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                >
                  <span className="flex items-center gap-2">
                    <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
                    <span className="truncate">{loc.name}</span>
                  </span>
                  {loc.id === activeId ? (
                    <Check className="size-4 text-emerald-600" aria-hidden />
                  ) : loading === loc.id ? (
                    <span className="text-xs text-muted-foreground">…</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
