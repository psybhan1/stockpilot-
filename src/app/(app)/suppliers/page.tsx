import Link from "next/link";
import { Globe, Mail, Package, Truck } from "lucide-react";

import { upsertSupplierAction } from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Role } from "@/lib/domain-enums";
import { formatDeliveryDays } from "@/lib/delivery-days";
import { requireSession } from "@/modules/auth/session";
import { getSuppliersPageData } from "@/modules/dashboard/queries";

export default async function SuppliersPage() {
  const session = await requireSession(Role.MANAGER);
  const suppliers = await getSuppliersPageData(session.locationId);

  const emailSuppliers = suppliers.filter((supplier) => supplier.orderingMode === "EMAIL").length;
  const websiteSuppliers = suppliers.filter(
    (supplier) => supplier.orderingMode === "WEBSITE"
  ).length;
  const manualSuppliers = suppliers.filter((supplier) => supplier.orderingMode === "MANUAL").length;

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border-border/60 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(255,255,255,0.92))] shadow-xl shadow-black/5 dark:bg-[linear-gradient(135deg,rgba(68,64,60,0.98),rgba(28,25,23,0.94))]">
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.22em] text-amber-600 dark:text-amber-300">
              Suppliers
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Keep supplier relationships easy to scan and even easier to act on.
            </h1>
            <p className="mt-3 text-base text-muted-foreground sm:text-lg">
              Every supplier keeps its own ordering mode, lead time, delivery cadence, and order
              history so the team knows what to expect without digging.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard label="Email suppliers" value={emailSuppliers} />
            <MetricCard label="Website suppliers" value={websiteSuppliers} />
            <MetricCard label="Manual suppliers" value={manualSuppliers} />
          </div>

          <form action={upsertSupplierAction} className="rounded-[28px] border border-border/60 bg-background/80 p-5">
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-lg font-semibold">Add a supplier</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Keep supplier setup lightweight: capture the ordering mode, contact path, and delivery rhythm.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Input name="name" placeholder="Supplier name" className="h-11 rounded-2xl" />
                <Input name="contactName" placeholder="Contact name" className="h-11 rounded-2xl" />
                <Input name="email" type="email" placeholder="orders@supplier.com" className="h-11 rounded-2xl" />
                <Input name="phone" placeholder="Phone" className="h-11 rounded-2xl" />
                <Input name="website" placeholder="https://supplier.com" className="h-11 rounded-2xl md:col-span-2" />
                <select
                  name="orderingMode"
                  defaultValue="EMAIL"
                  className="h-11 rounded-2xl border border-input bg-background px-3 text-sm"
                >
                  <option value="EMAIL">Email orders</option>
                  <option value="WEBSITE">Website ordering</option>
                  <option value="MANUAL">Manual / internal workflow</option>
                </select>
                <Input name="leadTimeDays" type="number" min="0" placeholder="Lead time (days)" className="h-11 rounded-2xl" />
                <Input
                  name="minimumOrderQuantity"
                  type="number"
                  min="1"
                  defaultValue={1}
                  placeholder="MOQ"
                  className="h-11 rounded-2xl"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {weekdayOptions.map((day) => (
                  <label
                    key={day.value}
                    className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-2 text-sm"
                  >
                    <input type="checkbox" name="deliveryDay" value={day.value} className="size-4" />
                    {day.label}
                  </label>
                ))}
                <label className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-2 text-sm">
                  <input type="checkbox" name="credentialsConfigured" className="size-4" />
                  Credentials configured
                </label>
              </div>

              <Textarea
                name="notes"
                placeholder="Ordering notes, website quirks, or contact preferences"
                className="min-h-24 rounded-[24px]"
              />

              <div className="flex justify-end">
                <Button type="submit" className="rounded-2xl">
                  Save supplier
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {suppliers.map((supplier) => (
          <Link
            key={supplier.id}
            href={`/suppliers/${supplier.id}`}
            className="rounded-[28px] border border-border/60 bg-card/88 p-5 shadow-lg shadow-black/5 transition-all hover:-translate-y-0.5 hover:border-primary/30"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{supplier.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {supplier.contactName ?? "No primary contact yet"}
                </p>
              </div>
              <StatusBadge
                label={
                  supplier.orderingMode === "WEBSITE"
                    ? "Website"
                    : supplier.orderingMode === "EMAIL"
                      ? "Email"
                      : "Manual"
                }
                tone={supplier.orderingMode === "WEBSITE" ? "info" : "neutral"}
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <InfoRow icon={Truck} label="Lead time" value={`${supplier.leadTimeDays} days`} />
              <InfoRow
                icon={Package}
                label="Tracked items"
                value={String(supplier.supplierItems.length)}
              />
              <InfoRow
                icon={Mail}
                label="Contact"
                value={supplier.email ?? supplier.phone ?? "No contact info"}
              />
              <InfoRow
                icon={Globe}
                label="Delivery days"
                value={formatDeliveryDays(supplier.deliveryDays)}
              />
            </div>

            <div className="mt-4 rounded-[24px] border border-border/60 bg-background/80 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Recent order activity
              </p>
              <p className="mt-2 font-medium">
                {supplier.purchaseOrders.length
                  ? `${supplier.purchaseOrders.length} recent order${supplier.purchaseOrders.length === 1 ? "" : "s"}`
                  : "No recent purchase orders"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {supplier.notes?.trim() || "Open the supplier to review its catalog, communications, and tasks."}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

const weekdayOptions = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[24px] border border-border/60 bg-background/85 p-4 shadow-lg shadow-black/5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Truck;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/80 p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <p className="text-xs uppercase tracking-[0.16em]">{label}</p>
      </div>
      <p className="mt-2 font-medium">{value}</p>
    </div>
  );
}
