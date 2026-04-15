"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Loader2, RotateCcw, Sparkles, X } from "lucide-react";

import { applyPhotoCountsAction } from "@/app/actions/operations";

export type PhotoCountItem = {
  id: string;
  name: string;
  displayUnit: string;
  stockOnHandBase: number;
  parLevelBase: number;
  packSizeBase: number;
  baseUnit: string;
};

type VisionCount = {
  inventoryItemId: string;
  name: string;
  count: number | null;
  confidence: "high" | "medium" | "low";
  rationale: string;
};

type PendingResult = VisionCount & {
  edited?: number | null;
  accepted?: boolean;
};

export function PhotoCountClient({ items }: { items: PhotoCountItem[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [imageData, setImageData] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PendingResult[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [filter, setFilter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items.slice(0, 40);
    return items.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 40);
  }, [items, filter]);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setImageData(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const analyse = async () => {
    if (!imageData || selected.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/vision/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: imageData, itemIds: selected }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        counts?: VisionCount[];
      };
      if (!res.ok || !data.ok) {
        setError(data.message ?? `Vision error (${res.status})`);
        return;
      }
      setResults((data.counts ?? []).map((c) => ({ ...c })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setImageData(null);
    setResults(null);
    setSelected([]);
    setError(null);
  };

  const apply = async () => {
    if (!results) return;
    setApplying(true);
    try {
      const toApply = results.filter(
        (r) => r.accepted && r.edited != null && Number.isFinite(r.edited) && r.edited >= 0
      );
      if (toApply.length === 0) {
        setError("Tick at least one count to apply.");
        setApplying(false);
        return;
      }
      const fd = new FormData();
      fd.append(
        "counts",
        JSON.stringify(
          toApply.map((r) => ({ inventoryItemId: r.inventoryItemId, count: r.edited }))
        )
      );
      await applyPhotoCountsAction(fd);
      router.push("/inventory?photo-count=applied");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
      setApplying(false);
    }
  };

  // STAGE 1 — pick items + take photo
  if (!results) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <section className="rounded-[28px] border border-border/60 bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">1. Which items are in frame?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Tap the ones you&apos;re photographing. Shortlist stays small so the AI stays accurate.
              </p>
            </div>
            <span className="rounded-full border border-border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {selected.length} selected
            </span>
          </div>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter — e.g. milk"
            className="mt-4 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
          />
          <ul className="mt-3 max-h-[420px] space-y-1 overflow-y-auto pr-1">
            {filtered.map((item) => {
              const isSelected = selected.includes(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setSelected((prev) =>
                        prev.includes(item.id)
                          ? prev.filter((x) => x !== item.id)
                          : [...prev, item.id]
                      )
                    }
                    className={
                      "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors " +
                      (isSelected
                        ? "bg-foreground text-background"
                        : "bg-card hover:bg-muted")
                    }
                  >
                    <span className="truncate">{item.name}</span>
                    {isSelected ? (
                      <Check className="size-4 shrink-0" aria-hidden />
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        {item.stockOnHandBase}/{item.parLevelBase} {item.displayUnit.toLowerCase()}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-[28px] border border-border/60 bg-card p-5">
          <h2 className="text-lg font-semibold">2. Snap a photo</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Rear camera, daylight if possible. Hold steady so labels are legible.
          </p>

          <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-muted">
            {imageData ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageData}
                alt="Preview"
                className="max-h-[360px] w-full object-contain"
              />
            ) : (
              <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-muted-foreground">
                <Camera className="size-10" aria-hidden />
                <p className="text-sm">No photo yet</p>
              </div>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPickFile}
            className="hidden"
          />
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-medium hover:bg-muted"
            >
              <Camera className="size-4" aria-hidden />
              {imageData ? "Retake" : "Take photo"}
            </button>
            <button
              type="button"
              onClick={analyse}
              disabled={!imageData || selected.length === 0 || loading}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition disabled:opacity-40 hover:bg-foreground/90"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="size-4" aria-hidden />
              )}
              {loading ? "Counting…" : "Count with AI"}
            </button>
          </div>

          {error ? (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </section>
      </div>
    );
  }

  // STAGE 2 — show AI counts + let user confirm/edit
  return (
    <section className="rounded-[28px] border border-border/60 bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">3. Confirm the counts</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tick the ones that look right, edit numbers if needed, then apply. Untouched rows aren&apos;t changed.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
        >
          <RotateCcw className="size-3" aria-hidden />
          Start over
        </button>
      </div>

      <ul className="mt-4 space-y-2">
        {results.map((r, idx) => {
          const item = items.find((i) => i.id === r.inventoryItemId);
          const confidenceColor =
            r.confidence === "high"
              ? "bg-emerald-100 text-emerald-800"
              : r.confidence === "medium"
              ? "bg-amber-100 text-amber-800"
              : "bg-red-100 text-red-800";
          return (
            <li
              key={r.inventoryItemId}
              className={
                "flex items-center gap-3 rounded-2xl border p-3 transition-colors " +
                (r.accepted ? "border-emerald-300 bg-emerald-50/40" : "border-border/60 bg-card")
              }
            >
              <button
                type="button"
                onClick={() =>
                  setResults((prev) =>
                    prev
                      ? prev.map((x, i) =>
                          i === idx
                            ? {
                                ...x,
                                accepted: !x.accepted,
                                edited: x.edited ?? x.count ?? 0,
                              }
                            : x
                        )
                      : prev
                  )
                }
                className={
                  "grid size-8 shrink-0 place-items-center rounded-full border transition-colors " +
                  (r.accepted
                    ? "border-emerald-400 bg-emerald-500 text-white"
                    : "border-border bg-card text-muted-foreground hover:bg-muted")
                }
                aria-label={r.accepted ? "Unselect" : "Select"}
              >
                {r.accepted ? <Check className="size-4" /> : null}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{r.name}</p>
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                      confidenceColor
                    }
                  >
                    {r.confidence}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  AI: {r.count == null ? "not visible" : `${r.count} ${item?.displayUnit.toLowerCase() ?? ""}`}
                  {r.rationale ? ` · ${r.rationale}` : ""}
                </p>
              </div>
              <input
                type="number"
                min={0}
                value={r.edited ?? r.count ?? 0}
                disabled={!r.accepted}
                onChange={(e) =>
                  setResults((prev) =>
                    prev
                      ? prev.map((x, i) =>
                          i === idx ? { ...x, edited: Number(e.target.value) } : x
                        )
                      : prev
                  )
                }
                className="w-20 rounded-lg border border-border bg-background px-2 py-1.5 text-right font-mono text-sm tabular-nums outline-none disabled:opacity-40 focus:border-foreground/40"
              />
            </li>
          );
        })}
      </ul>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {results.filter((r) => r.accepted).length} of {results.length} to apply
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" aria-hidden />
            Discard
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={applying || results.filter((r) => r.accepted).length === 0}
            className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background transition disabled:opacity-40 hover:bg-foreground/90"
          >
            {applying ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Check className="size-4" aria-hidden />
            )}
            {applying ? "Applying…" : "Apply counts"}
          </button>
        </div>
      </div>
    </section>
  );
}
