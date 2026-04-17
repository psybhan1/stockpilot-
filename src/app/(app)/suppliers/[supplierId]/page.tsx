import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Globe, Mail, Phone, Truck } from "lucide-react";

import {
  clearSupplierCredentialsAction,
  upsertSupplierAction,
  upsertSupplierItemAction,
} from "@/app/actions/operations";
import { summariseStoredCredentials } from "@/modules/suppliers/website-credentials";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Role } from "@/lib/domain-enums";
import { formatDeliveryDays } from "@/lib/delivery-days";
import { formatDateTime, formatRelativeDays } from "@/lib/format";
import { db } from "@/lib/db";
import { getSupplierDetail } from "@/modules/dashboard/queries";
import { requireSession } from "@/modules/auth/session";

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const session = await requireSession(Role.MANAGER);
  const { supplierId } = await params;
  const supplier = await getSupplierDetail(session.locationId, supplierId).catch(() => null);
  const inventoryItems = await db.inventoryItem.findMany({
    where: {
      locationId: session.locationId,
    },
    orderBy: {
      name: "asc",
    },
    select: {
      id: true,
      name: true,
      sku: true,
    },
  });

  if (!supplier) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border-border/60 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(255,255,255,0.92))] shadow-xl shadow-black/5 dark:bg-[linear-gradient(135deg,rgba(68,64,60,0.98),rgba(28,25,23,0.94))]">
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm uppercase tracking-[0.22em] text-amber-600 dark:text-amber-300">
                Supplier
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                {supplier.name}
              </h1>
              <p className="mt-3 text-base text-muted-foreground sm:text-lg">
                Keep this supplier&apos;s ordering rules, catalog coverage, and recent activity in one
                place.
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

          <div className="grid gap-3 md:grid-cols-4">
            <MetricCard label="Lead time" value={`${supplier.leadTimeDays} days`} />
            <MetricCard
              label="Delivery days"
              value={formatDeliveryDays(supplier.deliveryDays)}
            />
            <MetricCard label="Catalog items" value={String(supplier.supplierItems.length)} />
            <MetricCard label="Recent POs" value={String(supplier.purchaseOrders.length)} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <Panel
            title="Edit supplier"
            description="Update ordering rules and contact details without leaving this page."
          >
            <form action={upsertSupplierAction} className="space-y-4">
              <input type="hidden" name="supplierId" value={supplier.id} />
              <div className="grid gap-3 md:grid-cols-2">
                <Input name="name" defaultValue={supplier.name} placeholder="Supplier name" className="h-11 rounded-2xl" />
                <Input
                  name="contactName"
                  defaultValue={supplier.contactName ?? ""}
                  placeholder="Contact name"
                  className="h-11 rounded-2xl"
                />
                <Input name="email" type="email" defaultValue={supplier.email ?? ""} placeholder="Email" className="h-11 rounded-2xl" />
                <Input name="phone" defaultValue={supplier.phone ?? ""} placeholder="Phone" className="h-11 rounded-2xl" />
                <Input
                  name="website"
                  defaultValue={supplier.website ?? ""}
                  placeholder="Website"
                  className="h-11 rounded-2xl md:col-span-2"
                />
                <select
                  name="orderingMode"
                  defaultValue={supplier.orderingMode}
                  className="h-11 rounded-2xl border border-input bg-background px-3 text-sm"
                >
                  <option value="EMAIL">Email orders</option>
                  <option value="WEBSITE">Website ordering</option>
                  <option value="MANUAL">Manual / internal workflow</option>
                </select>
                <Input
                  name="leadTimeDays"
                  type="number"
                  min="0"
                  defaultValue={supplier.leadTimeDays}
                  className="h-11 rounded-2xl"
                />
                <Input
                  name="minimumOrderQuantity"
                  type="number"
                  min="1"
                  defaultValue={supplier.minimumOrderQuantity}
                  className="h-11 rounded-2xl"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {weekdayOptions.map((day) => (
                  <label
                    key={day.value}
                    className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="deliveryDay"
                      value={day.value}
                      defaultChecked={Array.isArray(supplier.deliveryDays) && supplier.deliveryDays.includes(day.value)}
                      className="size-4"
                    />
                    {day.label}
                  </label>
                ))}
                <label className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    name="credentialsConfigured"
                    defaultChecked={supplier.credentialsConfigured}
                    className="size-4"
                  />
                  Credentials configured
                </label>
              </div>

              <Textarea
                name="notes"
                defaultValue={supplier.notes ?? ""}
                placeholder="Ordering notes"
                className="min-h-24 rounded-[24px]"
              />

              <div className="flex justify-end">
                <Button type="submit" className="rounded-2xl">
                  Save supplier changes
                </Button>
              </div>
            </form>
          </Panel>

          <WebsiteLoginPanel
            supplierId={supplier.id}
            supplierName={supplier.name}
            credentialsState={summariseStoredCredentials(supplier.websiteCredentials)}
            siteUrl={supplier.website ?? null}
          />

          <Panel
            title="Supplier catalog"
            description="Linked items with pack rules and current runway."
          >
            <div className="space-y-3">
              {supplier.supplierItems.length ? (
                supplier.supplierItems.map((item) => (
                  <div
                    key={item.id}
                    className="notif-card p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{item.inventoryItem.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Days left: {formatRelativeDays(item.inventoryItem.snapshot?.daysLeft)}
                        </p>
                      </div>
                      <Link
                        href={`/inventory/${item.inventoryItemId}`}
                        className="text-sm font-medium text-muted-foreground hover:text-foreground"
                      >
                        Open item
                      </Link>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <InfoPill label="Pack size" value={String(item.packSizeBase)} />
                      <InfoPill label="MOQ" value={String(item.minimumOrderQuantity)} />
                      <InfoPill label="Lead time" value={`${item.leadTimeDays} days`} />
                    </div>

                    <form action={upsertSupplierItemAction} className="mt-4 grid gap-3 rounded-[22px] border border-border/60 bg-card p-4 md:grid-cols-2">
                      <input type="hidden" name="supplierId" value={supplier.id} />
                      <input type="hidden" name="supplierItemId" value={item.id} />
                      <input type="hidden" name="inventoryItemId" value={item.inventoryItemId} />
                      <Input
                        name="supplierSku"
                        defaultValue={item.supplierSku ?? ""}
                        placeholder="Supplier SKU"
                        className="h-10 rounded-2xl"
                      />
                      <Input
                        name="packSizeBase"
                        type="number"
                        min="1"
                        defaultValue={item.packSizeBase}
                        className="h-10 rounded-2xl"
                      />
                      <Input
                        name="minimumOrderQuantity"
                        type="number"
                        min="1"
                        defaultValue={item.minimumOrderQuantity}
                        className="h-10 rounded-2xl"
                      />
                      <Input
                        name="leadTimeDays"
                        type="number"
                        min="0"
                        defaultValue={item.leadTimeDays ?? supplier.leadTimeDays}
                        className="h-10 rounded-2xl"
                      />
                      <Input
                        name="lastUnitCostCents"
                        type="number"
                        min="0"
                        defaultValue={item.lastUnitCostCents ?? ""}
                        placeholder="Unit cost (cents)"
                        className="h-10 rounded-2xl"
                      />
                      <Input
                        name="priceNotes"
                        defaultValue={item.priceNotes ?? ""}
                        placeholder="Price notes"
                        className="h-10 rounded-2xl"
                      />
                      <div className="md:col-span-2 flex flex-wrap gap-2">
                        {weekdayOptions.map((day) => (
                          <label
                            key={`${item.id}-${day.value}`}
                            className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              name="supplierItemDeliveryDay"
                              value={day.value}
                              defaultChecked={Array.isArray(item.deliveryDays) && item.deliveryDays.includes(day.value)}
                              className="size-4"
                            />
                            {day.label}
                          </label>
                        ))}
                        <label className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-2 text-sm">
                          <input type="checkbox" name="preferred" defaultChecked={item.preferred} className="size-4" />
                          Preferred source
                        </label>
                      </div>
                      <div className="md:col-span-2 flex justify-end">
                        <Button type="submit" variant="outline" className="rounded-2xl">
                          Save item rule
                        </Button>
                      </div>
                    </form>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="No linked items yet"
                  description="Add inventory links to start using this supplier in recommendations."
                />
              )}
            </div>

            <form action={upsertSupplierItemAction} className="notif-card grid gap-3 p-4 md:grid-cols-2">
              <input type="hidden" name="supplierId" value={supplier.id} />
              <select
                name="inventoryItemId"
                defaultValue=""
                className="h-11 rounded-2xl border border-input bg-background px-3 text-sm"
              >
                <option value="" disabled>
                  Link an inventory item
                </option>
                {inventoryItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.sku})
                  </option>
                ))}
              </select>
              <Input name="supplierSku" placeholder="Supplier SKU" className="h-11 rounded-2xl" />
              <Input name="packSizeBase" type="number" min="1" defaultValue={1} className="h-11 rounded-2xl" />
              <Input name="minimumOrderQuantity" type="number" min="1" defaultValue={1} className="h-11 rounded-2xl" />
              <Input name="leadTimeDays" type="number" min="0" defaultValue={supplier.leadTimeDays} className="h-11 rounded-2xl" />
              <Input name="lastUnitCostCents" type="number" min="0" placeholder="Unit cost (cents)" className="h-11 rounded-2xl" />
              <Input name="priceNotes" placeholder="Price notes" className="h-11 rounded-2xl" />
              <div className="md:col-span-2 flex flex-wrap gap-2">
                {weekdayOptions.map((day) => (
                  <label
                    key={`new-${day.value}`}
                    className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="supplierItemDeliveryDay"
                      value={day.value}
                      defaultChecked={Array.isArray(supplier.deliveryDays) && supplier.deliveryDays.includes(day.value)}
                      className="size-4"
                    />
                    {day.label}
                  </label>
                ))}
                <label className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-2 text-sm">
                  <input type="checkbox" name="preferred" defaultChecked className="size-4" />
                  Preferred source
                </label>
              </div>
              <div className="md:col-span-2 flex justify-end">
                <Button type="submit" className="rounded-2xl">
                  Link item
                </Button>
              </div>
            </form>
          </Panel>

          <Panel
            title="Recent purchase orders"
            description="Open an order to see communications, lifecycle steps, and receiving."
          >
            <div className="space-y-3">
              {supplier.purchaseOrders.length ? (
                supplier.purchaseOrders.map((order) => (
                  <Link
                    key={order.id}
                    href={`/purchase-orders/${order.id}`}
                    className="flex items-center justify-between gap-3 notif-card p-4 transition-colors hover:bg-muted/40"
                  >
                    <div>
                      <p className="font-medium">{order.orderNumber}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Created {formatDateTime(order.createdAt)}
                      </p>
                    </div>
                    <StatusBadge label={order.status} tone="info" />
                  </Link>
                ))
              ) : (
                <EmptyState
                  title="No recent orders"
                  description="Orders sent to this supplier will appear here."
                />
              )}
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel
            title="Contact and workflow"
            description="The details the team needs when placing or troubleshooting an order."
          >
            <div className="grid gap-3">
              <ContactRow
                icon={Mail}
                label="Email"
                value={supplier.email ?? "No email on file"}
              />
              <ContactRow
                icon={Phone}
                label="Phone"
                value={supplier.phone ?? "No phone on file"}
              />
              <ContactRow
                icon={Globe}
                label="Website"
                value={supplier.website ?? "No website on file"}
              />
              <ContactRow
                icon={Truck}
                label="Notes"
                value={supplier.notes ?? "No extra ordering notes yet"}
              />
            </div>
          </Panel>

          <Panel
            title="Communications and tasks"
            description="Email sends and website-order prep attempts stay visible here."
          >
            <div className="space-y-3">
              {supplier.communications.map((communication) => (
                <div
                  key={communication.id}
                  className="notif-card p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{communication.subject ?? "Supplier message"}</p>
                    <StatusBadge label={communication.status} tone="info" />
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{communication.body}</p>
                </div>
              ))}

              {supplier.agentTasks.map((task) => (
                <div
                  key={task.id}
                  className="notif-card p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{task.title}</p>
                    <StatusBadge
                      label={task.status}
                      tone={task.status === "FAILED" ? "critical" : "info"}
                    />
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{task.description}</p>
                </div>
              ))}

              {!supplier.communications.length && !supplier.agentTasks.length ? (
                <EmptyState
                  title="No communications or tasks yet"
                  description="Messages and website-order prep attempts will show up here."
                />
              ) : null}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="notif-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="notif-card border-none shadow-none bg-transparent">
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="notif-card px-3 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
}) {
  return (
    <div className="notif-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <p className="text-xs uppercase tracking-[0.16em]">{label}</p>
      </div>
      <p className="mt-2 font-medium">{value}</p>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="notif-card px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
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

type CredentialsState = ReturnType<typeof summariseStoredCredentials>;

function WebsiteLoginPanel({
  supplierId,
  supplierName,
  credentialsState,
  siteUrl: _siteUrl,
}: {
  supplierId: string;
  supplierName: string;
  credentialsState: CredentialsState;
  siteUrl: string | null;
}) {
  const isConnected = credentialsState.kind !== "none";

  return (
    <Panel
      title="Website login"
      description={
        isConnected
          ? `Agent signs in as you and adds items directly to your real ${supplierName} cart.`
          : `Agent can't add items to your real ${supplierName} cart until you sign in once. Takes 30 seconds.`
      }
    >
      <div className="rounded-[22px] border border-border/60 bg-card/50 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">
              {credentialsState.kind === "none" && "Not connected — agent runs anonymously."}
              {credentialsState.kind === "password" &&
                `Connected via password (${credentialsState.username})`}
              {credentialsState.kind === "cookies" &&
                `Connected via cookies (${credentialsState.cookieCount} cookie${credentialsState.cookieCount === 1 ? "" : "s"}${credentialsState.primaryDomain ? ` · ${credentialsState.primaryDomain}` : ""})`}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {isConnected
                ? "The agent uses this session on the next website-mode order."
                : "Sign in once; every future order for this supplier is one tap."}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href={`/suppliers/${supplierId}/signin`}>
              <Button type="button" className="rounded-2xl">
                {isConnected ? "Re-sign in" : `🔐 Sign in to ${supplierName}`}
              </Button>
            </Link>
            {isConnected ? (
              <form action={clearSupplierCredentialsAction}>
                <input type="hidden" name="supplierId" value={supplierId} />
                <Button type="submit" variant="outline" className="rounded-2xl">
                  Disconnect
                </Button>
              </form>
            ) : null}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        You sign in on the real {supplierName} page (not in a StockPilot form). Your session is
        encrypted with AES-256 at rest and decrypted only inside the browser-agent process at
        PO dispatch time. The agent never auto-pays — you always review the cart before
        checkout.
      </p>
    </Panel>
  );
}
