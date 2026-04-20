import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createBlankRecipeFormAction } from "@/app/actions/recipe-edit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { getMenuPickerData } from "@/modules/dashboard/queries";

export default async function NewRecipePage() {
  const session = await requireSession(Role.MANAGER);
  const { menuItemVariants } = await getMenuPickerData(session.locationId);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link
        href="/recipes"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to menu
      </Link>

      <header>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-500 dark:text-amber-300">
          New recipe
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Start from scratch
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick the menu item this recipe is for, give it a short description,
          then add components on the next screen.
        </p>
      </header>

      {menuItemVariants.length === 0 ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          Every menu item already has a recipe. Sync a POS catalog first to
          pick up new drinks, or edit an existing recipe from{" "}
          <Link href="/recipes" className="underline">
            the menu
          </Link>
          .
        </div>
      ) : (
        <form action={createBlankRecipeFormAction} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="menuItemVariantId"
              className="text-xs font-medium text-muted-foreground"
            >
              Menu item
            </label>
            <select
              id="menuItemVariantId"
              name="menuItemVariantId"
              required
              className="h-11 w-full rounded-2xl border border-input bg-background px-3 text-sm"
            >
              <option value="">Select a menu item…</option>
              {menuItemVariants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.menuItem.name === v.name
                    ? v.name
                    : `${v.menuItem.name} · ${v.name}`}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="summary"
              className="text-xs font-medium text-muted-foreground"
            >
              One-line summary (optional)
            </label>
            <Input
              id="summary"
              name="summary"
              maxLength={120}
              placeholder="Iced oat latte with vanilla"
              className="h-11 rounded-2xl"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="rounded-2xl">
              Create recipe
            </Button>
            <Link
              href="/recipes"
              className="inline-flex h-10 items-center justify-center rounded-2xl border border-input bg-background px-4 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
