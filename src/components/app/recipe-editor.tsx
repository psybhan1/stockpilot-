"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, Plus, Save, Trash2 } from "lucide-react";

import {
  addRecipeComponentAction,
  removeRecipeComponentAction,
  saveRecipeEditsAction,
} from "@/app/actions/recipe-edit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { computeRecipeCost, formatCents } from "@/modules/recipes/cost";

type InventoryOption = {
  id: string;
  name: string;
  displayUnit: string;
  category: string;
  supplierItems: Array<{
    lastUnitCostCents: number | null;
    packSizeBase: number;
  }>;
};

type InitialComponent = {
  id: string;
  quantityBase: number;
  displayUnit: string;
  inventoryItem: {
    id: string;
    name: string;
    supplierItems: Array<{
      lastUnitCostCents: number | null;
      packSizeBase: number;
    }>;
  };
};

export function RecipeEditor({
  recipeId,
  initialSummary,
  initialComponents,
  inventoryOptions,
  canEdit,
}: {
  recipeId: string;
  initialSummary: string;
  initialComponents: InitialComponent[];
  inventoryOptions: InventoryOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState(initialSummary);
  const [qtys, setQtys] = useState<Record<string, number>>(() =>
    Object.fromEntries(initialComponents.map((c) => [c.id, c.quantityBase])),
  );
  const [addingInventoryId, setAddingInventoryId] = useState("");
  const [addingQty, setAddingQty] = useState<number>(10);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  // Cost rows recompute locally from edited quantities — gives live
  // "if I change this to 25g, the total is now $0.41" feedback.
  const costSummary = useMemo(
    () =>
      computeRecipeCost(
        initialComponents.map((c) => ({
          id: c.id,
          quantityBase: qtys[c.id] ?? c.quantityBase,
          displayUnit: c.displayUnit,
          inventoryItem: c.inventoryItem,
        })),
      ),
    [initialComponents, qtys],
  );

  function bump(componentId: string, delta: number) {
    setQtys((prev) => ({
      ...prev,
      [componentId]: Math.max(0, (prev[componentId] ?? 0) + delta),
    }));
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveRecipeEditsAction({
        recipeId,
        summary,
        componentQuantities: initialComponents.map((c) => ({
          id: c.id,
          quantityBase: qtys[c.id] ?? c.quantityBase,
        })),
      });
      if (!result.ok) {
        setMessage(result.reason);
        return;
      }
      setMessage("Saved.");
      router.refresh();
    });
  }

  function remove(componentId: string) {
    startTransition(async () => {
      const result = await removeRecipeComponentAction({ componentId });
      if (!result.ok) setMessage(result.reason);
      else router.refresh();
    });
  }

  function addComponent() {
    if (!addingInventoryId) return;
    const inv = inventoryOptions.find((i) => i.id === addingInventoryId);
    if (!inv) return;
    startTransition(async () => {
      const result = await addRecipeComponentAction({
        recipeId,
        inventoryItemId: addingInventoryId,
        quantityBase: addingQty,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        displayUnit: inv.displayUnit as any,
      });
      if (!result.ok) {
        setMessage(result.reason);
        return;
      }
      setAddingInventoryId("");
      setAddingQty(10);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Summary
        </p>
        {canEdit ? (
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="One-line description of the drink"
            className="mt-2 w-full resize-none rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30"
          />
        ) : (
          <p className="mt-2 text-sm">{summary || "—"}</p>
        )}
      </section>

      <section className="rounded-2xl border border-border/60 bg-card shadow-sm">
        <div className="flex items-baseline justify-between border-b border-border/60 px-5 py-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Components · {costSummary.rows.length}
          </p>
          <p className="font-mono text-sm font-semibold tabular-nums">
            Total {formatCents(costSummary.totalCostCents)}
          </p>
        </div>
        {costSummary.rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No components yet. Add one below.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {costSummary.rows.map((row) => (
              <li
                key={row.componentId}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {row.inventoryItemName}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {row.costPerUnitCents !== null ? (
                      <>
                        {formatCents(Math.round(row.costPerUnitCents * 100) / 100)}
                        <span className="mx-1">per</span>
                        {row.displayUnit.toLowerCase()}
                      </>
                    ) : (
                      <span className="text-amber-600">No supplier cost yet</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {canEdit ? (
                    <>
                      <button
                        type="button"
                        onClick={() => bump(row.componentId, -1)}
                        className="flex size-7 items-center justify-center rounded-md border border-border hover:bg-muted"
                        aria-label="Decrease"
                      >
                        <Minus className="size-3" />
                      </button>
                      <Input
                        type="number"
                        value={qtys[row.componentId] ?? row.quantityBase}
                        onChange={(e) =>
                          setQtys((p) => ({
                            ...p,
                            [row.componentId]: Math.max(
                              0,
                              Math.round(Number(e.target.value) || 0),
                            ),
                          }))
                        }
                        className="h-8 w-16 rounded-md text-center font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => bump(row.componentId, 1)}
                        className="flex size-7 items-center justify-center rounded-md border border-border hover:bg-muted"
                        aria-label="Increase"
                      >
                        <Plus className="size-3" />
                      </button>
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        {row.displayUnit.toLowerCase()}
                      </span>
                    </>
                  ) : (
                    <span className="font-mono text-sm">
                      {row.quantityBase} {row.displayUnit.toLowerCase()}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    {formatCents(row.componentCostCents)}
                  </span>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => remove(row.componentId)}
                      disabled={isPending}
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                      aria-label="Remove"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {costSummary.missingCostCount > 0 ? (
          <p className="border-t border-border/60 px-5 py-2 text-[11px] text-amber-600">
            {costSummary.missingCostCount} component(s) are missing supplier
            cost — total is under-counted. Add a supplier + invoice to fix.
          </p>
        ) : null}
      </section>

      {canEdit ? (
        <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Add component
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
            <select
              value={addingInventoryId}
              onChange={(e) => setAddingInventoryId(e.target.value)}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="">Pick inventory item…</option>
              {inventoryOptions
                .filter(
                  (i) =>
                    !initialComponents.some((c) => c.inventoryItem.id === i.id),
                )
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
            </select>
            <Input
              type="number"
              value={addingQty}
              min={1}
              onChange={(e) =>
                setAddingQty(Math.max(1, Math.round(Number(e.target.value) || 1)))
              }
              className="h-10 rounded-xl text-center font-mono"
            />
            <Button
              type="button"
              onClick={addComponent}
              disabled={!addingInventoryId || isPending}
              className="h-10 rounded-xl"
            >
              <Plus className="mr-1 size-4" />
              Add
            </Button>
          </div>
        </section>
      ) : null}

      {canEdit ? (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {message ??
              "Changes to quantities save as a batch. Remove uses single-click delete."}
          </p>
          <Button
            type="button"
            onClick={save}
            disabled={isPending}
            className="gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-500/90"
          >
            {message === "Saved." ? (
              <Check className="size-4" />
            ) : (
              <Save className="size-4" />
            )}
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
