import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { upsertSupplierAction } from "@/app/actions/operations";
import { PageHero } from "@/components/app/page-hero";
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
      <PageHero
        eyebrow="Suppliers"
        title={suppliers.length === 1 ? "One supplier" : `${suppliers.length} suppliers`}
        subtitle="in your network."
        description="Manage contacts, lead times, and delivery schedules."
      />

      {/* Add supplier form */}
      <section className="brutal-card p-5 space-y-4">
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
      {suppliers.length === 0 ? (
        <section className="brutal-card p-8 text-center">
          <p className="text-base font-medium">No suppliers yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Add your first above. You can start with just a name and an
            ordering mode — fill in lead times, delivery days, and items
            later as you use them.
          </p>
        </section>
      ) : null}
      <section className="grid gap-3 lg:grid-cols-2">
        {suppliers.map((supplier, i) => (
          <Link
            key={supplier.id}
            href={`/suppliers/${supplier.id}`}
            className="brutal-card group p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span className="brutal-number text-xs text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="brutal-chip-outline">
                    {supplier.orderingMode === "WEBSITE"
                      ? "Website"
                      : supplier.orderingMode === "EMAIL"
                      ? "Email"
                      : "Manual"}
                  </span>
                </div>
                <p className="mt-2 text-base font-bold uppercase tracking-[-0.02em]">
                  {supplier.name}
                </p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {supplier.contactName ?? "No contact"}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span>{supplier.leadTimeDays}d lead</span>
              <span>{supplier.supplierItems.length} item{supplier.supplierItems.length !== 1 ? "s" : ""}</span>
              <span>{supplier.email ?? supplier.phone ?? "No contact"}</span>
              <span>{formatDeliveryDays(supplier.deliveryDays)}</span>
            </div>

            {supplier.purchaseOrders.length > 0 && (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {supplier.purchaseOrders.length} recent order{supplier.purchaseOrders.length !== 1 ? "s" : ""}
              </p>
            )}

            <div className="mt-3 flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground group-hover:text-foreground">
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
