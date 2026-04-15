import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  recordInventoryMovementAction,
  updateInventoryItemAction,
} from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Role } from "@/lib/domain-enums";
import { formatCurrency, formatDateTime, formatRelativeDays } from "@/lib/format";
import { db } from "@/lib/db";
import { requireSession } from "@/modules/auth/session";
import { getInventoryItemDetail } from "@/modules/dashboard/queries";
import { formatQuantityBase } from "@/modules/inventory/units";

export default async function InventoryItemPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const session = await requireSession(Role.SUPERVISOR);
  const { itemId } = await params;
  const item = await getInventoryItemDetail(session.locationId, itemId).catch(() => null);
  const suppliers = await db.supplier.findMany({
    where: {
      locationId: session.locationId,
    },
    orderBy: {
      name: "asc",
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!item) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border-border/60 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(255,255,255,0.92))] shadow-xl shadow-black/5 dark:bg-[linear-gradient(135deg,rgba(68,64,60,0.98),rgba(28,25,23,0.94))]">
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm uppercase tracking-[0.22em] text-amber-600 dark:text-amber-300">
                Inventory item
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                {item.name}
              </h1>
              <p className="mt-3 text-base text-muted-foreground sm:text-lg">
                SKU {item.sku} - {item.category.replaceAll("_", " ")} - confidence{" "}
                {Math.round(item.confidenceScore * 100)}%
              </p>
            </div>
            <StatusBadge
              label={
                item.snapshot?.urgency === "CRITICAL"
                  ? "Urgent"
                  : item.snapshot?.urgency === "WARNING"
                    ? "Watch"
                    : "Good"
              }
              tone={
                item.snapshot?.urgency === "CRITICAL"
                  ? "critical"
                  : item.snapshot?.urgency === "WARNING"
                    ? "warning"
                    : "success"
              }
            />
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <MetricCard
              label="On hand"
              value={formatQuantityBase(item.stockOnHandBase, item.displayUnit, item.packSizeBase)}
            />
            <MetricCard
              label="Days left"
              value={formatRelativeDays(item.snapshot?.daysLeft)}
            />
            <MetricCard
              label="Primary supplier"
              value={item.primarySupplier?.name ?? "Unassigned"}
            />
            <MetricCard
              label="Latest cost note"
              value={item.latestCostNote ?? formatCurrency(null)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <Panel
            title="Edit stock settings"
            description="Managers and supervisors can keep item thresholds and storage details current right here."
          >
            <form action={updateInventoryItemAction} className="space-y-4">
              <input type="hidden" name="itemId" value={item.id} />
              <div className="grid gap-3 md:grid-cols-2">
                <Input name="name" defaultValue={item.name} placeholder="Item name" className="h-11 rounded-2xl" />
                <Input name="storageLocation" defaultValue={item.storageLocation ?? ""} placeholder="Storage location" className="h-11 rounded-2xl" />
                <Input name="sublocation" defaultValue={item.sublocation ?? ""} placeholder="Sublocation" className="h-11 rounded-2xl" />
                <Input
                  name="confidenceScore"
                  type="number"
                  min="0.1"
                  max="0.99"
                  step="0.01"
                  defaultValue={item.confidenceScore}
                  className="h-11 rounded-2xl"
                />
                <Input name="parLevelBase" type="number" min="0" defaultValue={item.parLevelBase} className="h-11 rounded-2xl" />
                <Input
                  name="lowStockThresholdBase"
                  type="number"
                  min="0"
                  defaultValue={item.lowStockThresholdBase}
                  className="h-11 rounded-2xl"
                />
                <Input name="safetyStockBase" type="number" min="0" defaultValue={item.safetyStockBase} className="h-11 rounded-2xl" />
                <Input name="leadTimeDays" type="number" min="0" defaultValue={item.leadTimeDays} className="h-11 rounded-2xl" />
                <Input
                  name="minimumOrderQuantity"
                  type="number"
                  min="1"
                  defaultValue={item.minimumOrderQuantity}
                  className="h-11 rounded-2xl"
                />
                <Input name="packSizeBase" type="number" min="1" defaultValue={item.packSizeBase} className="h-11 rounded-2xl" />
                <Input
                  name="latestCostNote"
                  defaultValue={item.latestCostNote ?? ""}
                  placeholder="Latest cost note"
                  className="h-11 rounded-2xl md:col-span-2"
                />
                <select
                  name="primarySupplierId"
                  defaultValue={item.primarySupplierId ?? ""}
                  className="h-11 rounded-2xl border border-input bg-background px-3 text-sm md:col-span-2"
                >
                  <option value="">No primary supplier</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </div>

              <Textarea
                name="notes"
                defaultValue={item.notes ?? ""}
                placeholder="Operational notes"
                className="min-h-24 rounded-[24px]"
              />

              <div className="flex justify-end">
                <Button type="submit" className="rounded-2xl">
                  Save stock settings
                </Button>
              </div>
            </form>
          </Panel>

          <Panel
            title="Recent stock movements"
            description="Every stock change is tied to a source event and an ending balance."
          >
            <div className="space-y-3">
              {item.stockMovements.length ? (
                item.stockMovements.map((movement) => (
                  <div
                    key={movement.id}
                    className="notif-card p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          {movement.movementType.replaceAll("_", " ").toLowerCase()}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatDateTime(movement.performedAt)}
                        </p>
                      </div>
                      <StatusBadge
                        label={movement.quantityDeltaBase > 0 ? `+${movement.quantityDeltaBase}` : String(movement.quantityDeltaBase)}
                        tone={movement.quantityDeltaBase > 0 ? "success" : "warning"}
                      />
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <InfoPill label="Balance after" value={String(movement.afterBalanceBase)} />
                      <InfoPill label="Source" value={movement.sourceType} />
                      <InfoPill label="Recorded by" value={movement.userId ?? "System"} />
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="No recent stock movements"
                  description="Stock changes will appear here as the ledger updates."
                />
              )}
            </div>
          </Panel>

          <Panel
            title="Recent reorder recommendations"
            description="See the latest recommendations and open the supplier flow when needed."
          >
            <div className="space-y-3">
              {item.reorderRecommendations.length ? (
                item.reorderRecommendations.map((recommendation) => (
                  <Link
                    key={recommendation.id}
                    href="/purchase-orders"
                    className="block notif-card p-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{recommendation.supplier.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {recommendation.rationale}
                        </p>
                      </div>
                      <StatusBadge
                        label={recommendation.status}
                        tone={recommendation.status === "APPROVED" ? "success" : "warning"}
                      />
                    </div>
                  </Link>
                ))
              ) : (
                <EmptyState
                  title="No reorder recommendations yet"
                  description="Forecast-driven recommendations will appear here for this item."
                />
              )}
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel
            title="Stock profile"
            description="The numbers people usually want first when checking an item."
          >
            <div className="grid gap-3">
              <InfoPill
                label="Par level"
                value={formatQuantityBase(item.parLevelBase, item.displayUnit, item.packSizeBase)}
              />
              <InfoPill
                label="Low-stock threshold"
                value={formatQuantityBase(
                  item.lowStockThresholdBase,
                  item.displayUnit,
                  item.packSizeBase
                )}
              />
              <InfoPill
                label="Safety stock"
                value={formatQuantityBase(
                  item.safetyStockBase,
                  item.displayUnit,
                  item.packSizeBase
                )}
              />
              <InfoPill label="Storage" value={item.storageLocation ?? "Not set"} />
            </div>
          </Panel>

          <Panel
            title="Record movement"
            description="Use this when stock changes outside POS sales or formal receiving."
          >
            <form action={recordInventoryMovementAction} className="space-y-4">
              <input type="hidden" name="inventoryItemId" value={item.id} />
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  name="movementType"
                  defaultValue="CORRECTION"
                  className="h-11 rounded-2xl border border-input bg-background px-3 text-sm"
                >
                  <option value="RECEIVING">Receiving</option>
                  <option value="BREAKAGE">Breakage</option>
                  <option value="WASTE">Waste</option>
                  <option value="TRANSFER">Transfer out</option>
                  <option value="RETURN">Return in</option>
                  <option value="CORRECTION">Correction (+/-)</option>
                </select>
                <Input
                  name="quantityBase"
                  type="number"
                  defaultValue={0}
                  placeholder="Quantity in base units"
                  className="h-11 rounded-2xl"
                />
              </div>
              <Textarea name="notes" placeholder="Why did this change happen?" className="min-h-24 rounded-[24px]" />
              <div className="flex justify-end">
                <Button type="submit" variant="outline" className="rounded-2xl">
                  Record movement
                </Button>
              </div>
            </form>
          </Panel>

          <Panel
            title="Supplier coverage"
            description="All supplier links connected to this item."
          >
            <div className="space-y-3">
              {item.supplierItems.length ? (
                item.supplierItems.map((supplierItem) => (
                  <div
                    key={supplierItem.id}
                    className="notif-card p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{supplierItem.supplier.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          MOQ {supplierItem.minimumOrderQuantity} - pack size {supplierItem.packSizeBase}
                        </p>
                      </div>
                      <Link href={`/suppliers/${supplierItem.supplierId}`} className="text-sm hover:underline">
                        Open supplier
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="No supplier links yet"
                  description="Add supplier coverage to improve reordering for this item."
                />
              )}
            </div>
          </Panel>

          <Panel
            title="Related alerts"
            description="Recent inventory warnings connected to this item."
          >
            <div className="space-y-3">
              {item.alerts.length ? (
                item.alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="notif-card p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{alert.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{alert.message}</p>
                      </div>
                      <StatusBadge
                        label={alert.severity}
                        tone={
                          alert.severity === "CRITICAL"
                            ? "critical"
                            : alert.severity === "WARNING"
                              ? "warning"
                              : "info"
                        }
                      />
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="No recent alerts"
                  description="Item-specific alerts will appear here when they are triggered."
                />
              )}
            </div>
          </Panel>
        </div>
      </div>
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

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="notif-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="notif-card p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-medium">{value}</p>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[22px] border border-dashed border-border/60 px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
