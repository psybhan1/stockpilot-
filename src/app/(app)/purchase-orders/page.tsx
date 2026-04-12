import Link from "next/link";
import { ArrowRight } from "lucide-react";

import {
  approveRecommendationAction,
  deferRecommendationAction,
  rejectRecommendationAction,
} from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Role } from "@/lib/domain-enums";
import { formatDateTime } from "@/lib/format";
import { requireSession } from "@/modules/auth/session";
import { getPurchaseOrdersData } from "@/modules/dashboard/queries";
import { getPurchaseOrderStatusTone } from "@/modules/purchasing/lifecycle";

export default async function PurchaseOrdersPage() {
  const session = await requireSession(Role.SUPERVISOR);
  const { recommendations, purchaseOrders } = await getPurchaseOrdersData(session.locationId);

  const pendingRecommendations = recommendations.filter(
    (recommendation) => recommendation.status === "PENDING_APPROVAL"
  );
  const activeOrders = purchaseOrders.filter((order) =>
    ["APPROVED", "SENT", "ACKNOWLEDGED"].includes(order.status)
  );
  const deliveredOrders = purchaseOrders.filter((order) => order.status === "DELIVERED");

  return (
    <div className="space-y-10">
      {/* Header */}
      <section>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Orders
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Purchase orders
        </h1>
        <p className="mt-2 text-muted-foreground">
          Review recommendations and track supplier orders.
        </p>
      </section>

      {/* Metrics */}
      <section className="grid grid-cols-3 gap-3">
        <MetricCard label="Needs approval" value={pendingRecommendations.length} />
        <MetricCard label="In progress" value={activeOrders.length} />
        <MetricCard label="Delivered" value={deliveredOrders.length} />
      </section>

      {/* Pending approvals */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Waiting for approval</h2>
          <p className="text-sm text-muted-foreground">Recommendations that need a decision</p>
        </div>

        {pendingRecommendations.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {pendingRecommendations.map((rec) => (
              <div
                key={rec.id}
                className="rounded-xl border border-border/50 bg-card p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{rec.inventoryItem.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{rec.supplier.name}</p>
                  </div>
                  <StatusBadge
                    label={rec.urgency === "CRITICAL" ? "Urgent" : rec.urgency === "WARNING" ? "Watch" : "Info"}
                    tone={rec.urgency === "CRITICAL" ? "critical" : rec.urgency === "WARNING" ? "warning" : "info"}
                  />
                </div>

                <div className="flex gap-3 text-sm">
                  <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">Qty</p>
                    <p className="font-medium">{rec.recommendedPackCount} {rec.recommendedPurchaseUnit.toLowerCase()}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 flex-1">
                    <p className="text-xs text-muted-foreground">Reason</p>
                    <p className="text-muted-foreground line-clamp-1">{rec.rationale}</p>
                  </div>
                </div>

                {session.role === Role.MANAGER ? (
                  <div className="space-y-2">
                    <form action={approveRecommendationAction} className="flex items-center gap-2">
                      <input type="hidden" name="recommendationId" value={rec.id} />
                      <Input
                        name="recommendedPackCount"
                        type="number"
                        min={1}
                        defaultValue={rec.recommendedPackCount}
                        className="h-9 w-24 text-sm"
                      />
                      <Button type="submit" size="sm" className="h-9 text-xs">
                        Approve
                      </Button>
                    </form>
                    <div className="flex gap-2">
                      <form action={deferRecommendationAction}>
                        <input type="hidden" name="recommendationId" value={rec.id} />
                        <Button type="submit" variant="outline" size="sm" className="h-8 text-xs">
                          Later
                        </Button>
                      </form>
                      <form action={rejectRecommendationAction}>
                        <input type="hidden" name="recommendationId" value={rec.id} />
                        <Button type="submit" variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground">
                          Reject
                        </Button>
                      </form>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Waiting for manager approval</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="No approvals waiting" />
        )}
      </section>

      {/* Order history */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Order history</h2>
          <p className="text-sm text-muted-foreground">Track every order from creation to delivery</p>
        </div>

        {purchaseOrders.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {purchaseOrders.map((order) => (
              <Link
                key={order.id}
                href={`/purchase-orders/${order.id}`}
                className="group flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-card p-4 transition-colors hover:bg-muted/30"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{order.orderNumber}</p>
                    <StatusBadge
                      label={order.status}
                      tone={getPurchaseOrderStatusTone(order.status)}
                    />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {order.supplier.name} · {order.lines.length} line{order.lines.length !== 1 ? "s" : ""} · {formatDateTime(order.createdAt)}
                  </p>
                </div>
                <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState text="No purchase orders yet" />
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/50 px-4 py-8 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
