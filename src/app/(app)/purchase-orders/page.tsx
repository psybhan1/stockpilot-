import Link from "next/link";
import { ArrowRight } from "lucide-react";

import {
  approveRecommendationAction,
  deferRecommendationAction,
  rejectRecommendationAction,
} from "@/app/actions/operations";
import { PageHero } from "@/components/app/page-hero";
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
      <PageHero
        eyebrow="Orders"
        title="Purchase orders"
        subtitle="from draft to doorstep."
        description="Review recommendations and track supplier orders."
        stats={[
          { label: "Needs approval", value: String(pendingRecommendations.length).padStart(2, "0"), highlight: pendingRecommendations.length > 0 },
          { label: "In progress", value: String(activeOrders.length).padStart(2, "0") },
          { label: "Delivered", value: String(deliveredOrders.length).padStart(2, "0") },
        ]}
      />

      {/* Pending approvals */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Waiting for approval</h2>
          <p className="text-sm text-muted-foreground">Recommendations that need a decision</p>
        </div>

        {pendingRecommendations.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {pendingRecommendations.map((rec, i) => (
              <div
                key={rec.id}
                className={`brutal-card ${rec.urgency === "CRITICAL" ? "brutal-card-hot pl-7" : ""} p-5 space-y-4`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="brutal-number text-xs text-muted-foreground">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {rec.urgency === "CRITICAL" ? (
                        <span className="brutal-chip-hot">Urgent</span>
                      ) : (
                        <span className="brutal-chip-outline">
                          {rec.urgency === "WARNING" ? "Watch" : "Info"}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-base font-bold uppercase tracking-[-0.02em]">
                      {rec.inventoryItem.name}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      From · {rec.supplier.name}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-[auto_1fr] gap-0 border-2 border-foreground">
                  <div className="border-r-2 border-foreground px-3 py-2">
                    <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                      Qty
                    </p>
                    <p className="brutal-number mt-0.5 text-lg">
                      {rec.recommendedPackCount}{" "}
                      <span className="text-xs text-muted-foreground">
                        {rec.recommendedPurchaseUnit.toLowerCase()}
                      </span>
                    </p>
                  </div>
                  <div className="min-w-0 px-3 py-2">
                    <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                      Reason
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                      {rec.rationale}
                    </p>
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
                        className="h-9 w-24 rounded-none border-2 border-foreground text-sm"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        className="hot-cta h-9 rounded-none border-2 text-xs font-bold uppercase tracking-[0.14em]"
                      >
                        Approve
                      </Button>
                    </form>
                    <div className="flex gap-2">
                      <form action={deferRecommendationAction}>
                        <input type="hidden" name="recommendationId" value={rec.id} />
                        <Button
                          type="submit"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-none border-2 border-foreground text-xs font-bold uppercase tracking-[0.14em]"
                        >
                          Later
                        </Button>
                      </form>
                      <form action={rejectRecommendationAction}>
                        <input type="hidden" name="recommendationId" value={rec.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="h-8 rounded-none text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"
                        >
                          Reject
                        </Button>
                      </form>
                    </div>
                  </div>
                ) : (
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Waiting for manager approval
                  </p>
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
