import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { upsertSupplierAction } from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Role } from "@/lib/domain-enums";
import { formatDeliveryDays } from "@/lib/delivery-days";
import { requireSession } from "@/modules/auth/session";
import { getSuppliersPageData } from "@/modules/dashboard/queries";

export default async function SuppliersPage() {
  const session = await requireSession(Role.MANAGER);
  const suppliers = await getSuppliersPageData(session.locationId);

  return (
    <div className="space-y-10">
      {/* Header */}
      <section>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Suppliers
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {suppliers.length} supplier{suppliers.length !== 1 ? "s" : ""}
        </h1>
        <p className="mt-2 text-muted-foreground">
          Manage contacts, lead times, and delivery schedules.
        </p>
      </section>

      {/* Add supplier form */}
      <section className="rounded-xl border border-border/50 bg-card p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Add supplier</h2>
          <p className="text-sm text-muted-foreground">Set up ordering mode, contacts, and delivery rhythm</p>
        </div>

        <form action={upsertSupplierAction} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input name="name" placeholder="Supplier name" className="h-9 text-sm" required />
            <Input name="contactName" placeholder="Contact name" className="h-9 text-sm" />
            <Input name="email" type="email" placeholder="orders@supplier.com" className="h-9 text-sm" />
            <Input name="phone" placeholder="Phone" className="h-9 text-sm" />
            <Input name="website" placeholder="https://supplier.com" className="h-9 text-sm sm:col-span-2" />
            <select
              name="orderingMode"
              defaultValue="EMAIL"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="EMAIL">Email</option>
              <option value="WEBSITE">Website</option>
              <option value="MANUAL">Manual</option>
            </select>
            <Input name="leadTimeDays" type="number" min="0" placeholder="Lead time (days)" className="h-9 text-sm" />
            <Input name="minimumOrderQuantity" type="number" min="1" defaultValue={1} placeholder="MOQ" className="h-9 text-sm" />
          </div>

          <div className="flex flex-wrap gap-2">
            {weekdayOptions.map((day) => (
              <label key={day.value} className="inline-flex items-center gap-1.5 rounded-md border border-border/50 px-2.5 py-1.5 text-xs">
                <input type="checkbox" name="deliveryDay" value={day.value} className="size-3.5" />
                {day.label}
              </label>
            ))}
          </div>

          <Textarea name="notes" placeholder="Ordering notes or preferences" className="min-h-20 text-sm" />

          <Button type="submit" size="sm" className="h-8 text-xs">
            Save supplier
          </Button>
        </form>
      </section>

      {/* Supplier list */}
      <section className="grid gap-3 lg:grid-cols-2">
        {suppliers.map((supplier) => (
          <Link
            key={supplier.id}
            href={`/suppliers/${supplier.id}`}
            className="group rounded-xl border border-border/50 bg-card p-4 transition-colors hover:bg-muted/30"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{supplier.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {supplier.contactName ?? "No contact"}
                </p>
              </div>
              <StatusBadge
                label={supplier.orderingMode === "WEBSITE" ? "Website" : supplier.orderingMode === "EMAIL" ? "Email" : "Manual"}
                tone={supplier.orderingMode === "WEBSITE" ? "info" : "neutral"}
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{supplier.leadTimeDays}d lead time</span>
              <span>{supplier.supplierItems.length} item{supplier.supplierItems.length !== 1 ? "s" : ""}</span>
              <span>{supplier.email ?? supplier.phone ?? "No contact info"}</span>
              <span>{formatDeliveryDays(supplier.deliveryDays)}</span>
            </div>

            {supplier.purchaseOrders.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {supplier.purchaseOrders.length} recent order{supplier.purchaseOrders.length !== 1 ? "s" : ""}
              </p>
            )}

            <div className="mt-3 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              View supplier
              <ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          </Link>
        ))}
      </section>
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
