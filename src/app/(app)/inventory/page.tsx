import Link from "next/link";

import { Role } from "@/lib/domain-enums";

import { addInventoryItemAction } from "@/app/actions/operations";
import { InventoryBrowser } from "@/components/app/inventory-browser";
import { PageHero } from "@/components/app/page-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/db";
import { formatRelativeDays } from "@/lib/format";
import { requireSession } from "@/modules/auth/session";
import { getInventoryList } from "@/modules/dashboard/queries";
import { buildInventoryImageUrl } from "@/modules/inventory/image-resolver";
import { formatQuantityBase } from "@/modules/inventory/units";

export default async function InventoryPage() {
  const session = await requireSession(Role.SUPERVISOR);
  const items = await getInventoryList(session.locationId);
  const suppliers = await db.supplier.findMany({
    where: { locationId: session.locationId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Compute missing image URLs synchronously from whatever we
  // already have on the row (supplier website for Clearbit logo,
  // productUrl pasted into notes for direct image URLs, otherwise
  // letter avatar). Page renders instantly.
  //
  // Why no AI generation anymore: the old Pollinations.ai pipeline
  // produced "very random" product shots (user feedback) — Coke
  // can for oat milk, random branded packaging for generic names.
  // Honest letter avatars beat hallucinated products every time.
  const missing = items.filter((item) => !item.imageUrl);
  if (missing.length > 0) {
    for (const item of missing) {
      const brandMatch = item.notes?.match(/brand:\s*([^|]+)/i);
      const brand = brandMatch?.[1]?.trim() ?? null;
      const urlMatch = item.notes?.match(/(?:Product URL|URL):\s*(https?:\/\/\S+)/i);
      const productUrl = urlMatch?.[1] ?? null;
      const url = buildInventoryImageUrl({
        name: item.name,
        brand,
        category: item.category,
        productUrl,
        supplierWebsite: item.primarySupplier?.website ?? null,
      });
      item.imageUrl = url;
      // Persist only NON-data-URL results — letter avatars are cheap
      // to regenerate and we don't want to bloat the DB with ~600-
      // byte SVGs per item. Real og:images / logos stick.
      if (!url.startsWith("data:")) {
        void db.inventoryItem
          .update({ where: { id: item.id }, data: { imageUrl: url } })
          .catch(() => {});
      }
    }
  }

  const totalItems = items.length;
  const criticalCount = items.filter((i) => i.snapshot?.urgency === "CRITICAL").length;
  const watchCount = items.filter((i) => i.snapshot?.urgency === "WARNING").length;
  const suppliersTracked = new Set(
    items.map((i) => i.primarySupplier?.id).filter(Boolean)
  ).size;

  return (
    <div className="space-y-10">
      <PageHero
        eyebrow={`Inventory · ${session.locationName}`}
        title="Inventory"
        description="Every item you track, with live stock levels, categories, and supplier links."
        stats={[
          { label: "Items", value: totalItems },
          { label: "Critical", value: criticalCount, highlight: criticalCount > 0 },
          { label: "Watch", value: watchCount },
          { label: "Suppliers", value: suppliersTracked },
        ]}
      />

      {/* Add-item form — always visible, becomes the primary CTA when
          inventory is empty (which is every brand-new café's first
          impression). Five fields kept intentionally short: name,
          category, base unit, par level, optional supplier + price.
          Price stamps onto the SupplierItem so auto-approve works. */}
      <section className="brutal-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              {totalItems === 0 ? "Add your first item" : "Add an item"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {totalItems === 0
                ? "Name + par level is enough to start. Link a supplier with a price so the bot can auto-order later."
                : "Quick-add — rename, adjust stock, or edit details from the item page."}
            </p>
          </div>
          <Link
            href="/inventory/import"
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Bulk CSV import →
          </Link>
        </div>

        <form action={addInventoryItemAction} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              name="name"
              placeholder="Oat Milk 1L"
              className="h-9 text-sm"
              required
              maxLength={120}
            />
            <select
              name="category"
              defaultValue="SUPPLY"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="COFFEE">Coffee</option>
              <option value="DAIRY">Dairy</option>
              <option value="ALT_DAIRY">Alt-dairy</option>
              <option value="SYRUP">Syrup</option>
              <option value="BAKERY_INGREDIENT">Bakery</option>
              <option value="PACKAGING">Packaging</option>
              <option value="CLEANING">Cleaning</option>
              <option value="PAPER_GOODS">Paper goods</option>
              <option value="RETAIL">Retail</option>
              <option value="SEASONAL">Seasonal</option>
              <option value="SUPPLY">Other supply</option>
            </select>
            <select
              name="baseUnit"
              defaultValue="COUNT"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="COUNT">Count (each)</option>
              <option value="GRAM">Grams</option>
              <option value="MILLILITER">Milliliters</option>
            </select>
            <Input
              name="parLevelBase"
              type="number"
              min="1"
              defaultValue={10}
              placeholder="Par level"
              className="h-9 text-sm"
              required
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              name="stockOnHandBase"
              type="number"
              min="0"
              defaultValue={0}
              placeholder="Current stock"
              className="h-9 text-sm"
            />
            <select
              name="supplierId"
              defaultValue=""
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">No supplier yet</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <Input
              name="unitPriceDollars"
              type="number"
              step="0.01"
              min="0"
              placeholder="$ unit price (optional)"
              className="h-9 text-sm"
            />
          </div>

          {/* Product URL — the one field that unlocks a real
              branded product photo. Paste an Amazon / Costco / LCBO
              / manufacturer page URL and we fetch the product's own
              image. Skip → letter avatar with category color. */}
          <Input
            name="productUrl"
            type="url"
            placeholder="Product URL (optional — paste for a real product photo)"
            className="h-9 text-sm"
            pattern="https?://.+"
          />
          <Button type="submit" size="sm" className="h-9 text-xs">
            Add item
          </Button>
        </form>
      </section>

      <InventoryBrowser
        items={items.map((item) => {
          const par = item.parLevelBase > 0 ? item.parLevelBase : 1;
          const stockPercent = Math.round((item.stockOnHandBase / par) * 100);
          return {
            id: item.id,
            name: item.name,
            imageUrl: item.imageUrl,
            categoryKey: item.category,
            categoryLabel: item.category.replaceAll("_", " ").toLowerCase(),
            onHandLabel: formatQuantityBase(
              item.stockOnHandBase,
              item.displayUnit,
              item.packSizeBase
            ),
            daysLeftLabel: formatRelativeDays(item.snapshot?.daysLeft),
            supplierName: item.primarySupplier?.name ?? "Unassigned",
            urgency: item.snapshot?.urgency ?? "INFO",
            stockPercent,
          };
        })}
      />
    </div>
  );
}
