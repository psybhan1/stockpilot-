import { importInventoryCsvAction } from "@/app/actions/operations";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

export default async function ImportInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  await requireSession(Role.MANAGER);
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Inventory · import
        </p>
        <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Bulk-import items from a spreadsheet.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Paste CSV content below. Missing suppliers get created automatically. Bad rows are skipped with a warning — your existing data is untouched.
        </p>
      </div>

      {params.done ? (
        <Card className="rounded-3xl border-emerald-200 bg-emerald-50/80">
          <CardContent className="p-4 text-sm text-emerald-800">
            Import complete. Head to{" "}
            <a href="/inventory" className="underline font-medium">
              Inventory
            </a>{" "}
            to review what was created.
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-[28px] border-border/60 bg-card">
        <CardContent className="space-y-4 p-6">
          <div>
            <h2 className="text-lg font-semibold">Expected columns</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Header row required. Column order doesn&apos;t matter. Extra columns are ignored.
            </p>
            <div className="mt-3 overflow-x-auto rounded-xl border border-border/60 bg-muted/40">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <Th>name</Th>
                    <Th>sku</Th>
                    <Th>category</Th>
                    <Th>baseUnit</Th>
                    <Th>displayUnit</Th>
                    <Th>packSize</Th>
                    <Th>par</Th>
                    <Th>onHand</Th>
                    <Th>supplierName</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="text-xs text-muted-foreground">
                    <Td>Oat Milk</Td>
                    <Td>OAT-1L</Td>
                    <Td>ALT_DAIRY</Td>
                    <Td>MILLILITER</Td>
                    <Td>LITER</Td>
                    <Td>1000</Td>
                    <Td>12</Td>
                    <Td>8</Td>
                    <Td>DairyFlow</Td>
                  </tr>
                  <tr className="text-xs text-muted-foreground">
                    <Td>Ground Coffee</Td>
                    <Td>GND-1KG</Td>
                    <Td>COFFEE</Td>
                    <Td>GRAM</Td>
                    <Td>KILOGRAM</Td>
                    <Td>1000</Td>
                    <Td>8</Td>
                    <Td>2</Td>
                    <Td>BeanCo</Td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Valid <code>category</code>: COFFEE · DAIRY · ALT_DAIRY · SYRUP · BAKERY_INGREDIENT · PACKAGING · CLEANING · PAPER_GOODS · RETAIL · SEASONAL · SUPPLY.
              Valid <code>baseUnit</code>: GRAM · MILLILITER · COUNT.
              Valid <code>displayUnit</code>: GRAM · KILOGRAM · MILLILITER · LITER · COUNT · CASE · BOTTLE · BAG · BOX.
            </p>
          </div>

          <form action={importInventoryCsvAction.bind(null)} className="space-y-4">
            <textarea
              name="csv"
              rows={12}
              required
              placeholder={`name,sku,category,baseUnit,displayUnit,packSize,par,onHand,supplierName\nOat Milk,OAT-1L,ALT_DAIRY,MILLILITER,LITER,1000,12,8,DairyFlow`}
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 font-mono text-[13px] leading-relaxed outline-none focus:border-foreground/40"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Tip: in Excel / Sheets → File → Download → CSV (comma-separated) → paste here.
              </p>
              <Button type="submit" className="rounded-full">
                Import items
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </th>
  );
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-1.5 font-mono">{children}</td>;
}
