"use client";

import Image from "next/image";
import { useMemo, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";

import { submitCountAction } from "@/app/actions/operations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type SwipeItem = {
  id: string;
  name: string;
  imageUrl: string | null;
  expectedBase: number;
  lowStockBase: number;
  unitLabel: string;
  expectedLabel: string;
  lastCountLabel: string;
  supplierName: string | null;
  daysLeftLabel: string;
};

export function StockSwipe({ items }: { items: SwipeItem[] }) {
  const [index, setIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const item = useMemo(() => items[index], [items, index]);
  const progress = items.length ? ((index + 1) / items.length) * 100 : 0;

  function clampIndex(next: number) {
    if (items.length === 0) return 0;
    if (next < 0) return 0;
    if (next > items.length - 1) return items.length - 1;
    return next;
  }

  function submit(
    countedBase: number,
    notes: string,
    entryMode: "COUNT" | "WASTE" | "SKIP",
    note: string
  ) {
    if (!item) return;

    const formData = new FormData();
    formData.set("inventoryItemId", item.id);
    formData.set("countedBase", String(countedBase));
    formData.set("notes", [notes, note].filter(Boolean).join(" | "));
    formData.set("entryMode", entryMode);

    startTransition(async () => {
      await submitCountAction(formData);
      setIndex((current) => clampIndex(current + 1));
    });
  }

  if (!item) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          No items are available for swipe count yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden rounded-[30px] border-border/60 bg-card/90 shadow-xl shadow-black/5 backdrop-blur">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>
              Item {index + 1} of {items.length}
            </CardTitle>
            <CardDescription>
              Tap the big action if the expected number looks right. Save a custom number only if
              it doesn&apos;t.
            </CardDescription>
          </div>
          <div className="rounded-full border border-border/60 px-3 py-1 text-sm text-muted-foreground">
            {Math.round(progress)}% through
          </div>
        </div>
        <div className="mt-4 h-2 rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <SwipeCard key={item.id} item={item} pending={pending} onSubmit={submit} />

        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => setIndex((current) => clampIndex(current - 1))}
            className="rounded-2xl"
          >
            <ArrowLeft data-icon="inline-start" />
            Previous
          </Button>
          <Button
            variant="ghost"
            onClick={() => setIndex((current) => clampIndex(current + 1))}
            className="rounded-2xl"
          >
            Next
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SwipeCard({
  item,
  pending,
  onSubmit,
}: {
  item: SwipeItem;
  pending: boolean;
  onSubmit: (
    countedBase: number,
    notes: string,
    entryMode: "COUNT" | "WASTE" | "SKIP",
    note: string
  ) => void;
}) {
  const [countValue, setCountValue] = useState(String(item.expectedBase));
  const [note, setNote] = useState("");

  function parsedCountValue() {
    const parsed = Number(countValue);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : item.expectedBase;
  }

  return (
    <>
      <div className="relative overflow-hidden rounded-[30px] border border-border/60 bg-gradient-to-br from-stone-100 via-background to-amber-100 p-6 dark:from-stone-900 dark:to-stone-800">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <div className="relative size-20 overflow-hidden rounded-[24px] border border-border/60 bg-background">
              {item.imageUrl ? (
                <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-2xl font-semibold text-muted-foreground">
                  {item.name.charAt(0)}
                </div>
              )}
            </div>

            <div>
              <p className="text-sm text-muted-foreground">Swipe count</p>
              <h3 className="text-2xl font-semibold tracking-tight">{item.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">Does this still look right?</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <InfoBlock label="Expected" value={item.expectedLabel} />
            <InfoBlock label="Last count" value={item.lastCountLabel} />
            <InfoBlock label="Days left" value={item.daysLeftLabel} />
            <InfoBlock
              label="Supplier"
              value={item.supplierName ?? "Unassigned"}
              className="sm:col-span-3"
            />
          </div>

          <Button
            onClick={() =>
              onSubmit(item.expectedBase, "Confirmed expected stock from swipe flow", "COUNT", note)
            }
            disabled={pending}
            className="h-12 rounded-2xl text-base"
          >
            <CheckCircle2 data-icon="inline-start" />
            Looks right
          </Button>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              variant="outline"
              onClick={() => onSubmit(0, "Marked out in swipe flow", "COUNT", note)}
              disabled={pending}
              className="h-11 rounded-2xl"
            >
              Out of stock
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                onSubmit(
                  Math.min(parsedCountValue(), item.lowStockBase),
                  "Marked low in swipe flow",
                  "COUNT",
                  note
                )
              }
              disabled={pending}
              className="h-11 rounded-2xl"
            >
              Running low
            </Button>
          </div>

          <div className="grid gap-3 rounded-[24px] border border-border/60 bg-background/70 p-4 md:grid-cols-[1fr_1fr_auto]">
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Counted quantity ({item.unitLabel})
              </p>
              <Input
                value={countValue}
                onChange={(event) => setCountValue(event.target.value)}
                inputMode="numeric"
                type="number"
              />
            </div>

            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Note
              </p>
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional note for the audit trail"
              />
            </div>

            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() =>
                  onSubmit(
                    parsedCountValue(),
                    "Saved edited quantity from swipe flow",
                    "COUNT",
                    note
                  )
                }
                disabled={pending}
                className="h-10 w-full rounded-2xl md:w-auto"
              >
                Save custom count
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Button
          variant="outline"
          onClick={() => onSubmit(parsedCountValue(), "Logged waste in swipe flow", "WASTE", note)}
          disabled={pending}
          className="h-11 rounded-2xl"
        >
          Log waste
        </Button>
        <Button
          variant="outline"
          onClick={() => onSubmit(item.expectedBase, "Skipped in swipe flow", "SKIP", note)}
          disabled={pending}
          className="h-11 rounded-2xl"
        >
          Skip for now
        </Button>
      </div>
    </>
  );
}

function InfoBlock({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={["rounded-2xl border border-border/60 bg-background/80 p-4", className]
      .filter(Boolean)
      .join(" ")}
    >
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  );
}
