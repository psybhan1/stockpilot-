import Link from "next/link";
import { ArrowRight, PackageCheck, Send, ShieldCheck } from "lucide-react";

import {
  approveRecommendationAction,
  deferRecommendationAction,
  rejectRecommendationAction,
} from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border-border/60 bg-[linear-gradient(135deg,rgba(41,37,36,0.98),rgba(87,83,78,0.96))] text-white shadow-2xl shadow-black/10">
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.22em] text-white/60">Orders</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Review what to buy, then track every order without the spreadsheet feeling.
            </h1>
            <p className="mt-3 text-base text-white/70 sm:text-lg">
              Recommendations stay explainable and editable. Once approved, every supplier step
              still leaves a clean internal record.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard label="Needs approval" value={pendingRecommendations.length} />
            <MetricCard label="In progress" value={activeOrders.length} />
            <MetricCard label="Delivered" value={deliveredOrders.length} />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <TipCard
              icon={ShieldCheck}
              title="Approve with context"
              description="Each suggestion shows the supplier, quantity, and reason."
            />
            <TipCard
              icon={Send}
              title="Keep it review-first"
              description="Nothing critical goes out without a human approval step."
            />
            <TipCard
              icon={PackageCheck}
              title="Track the full lifecycle"
              description="Sent, acknowledged, delivered, and received all stay attached to the same PO."
            />
          </div>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Waiting for approval</h2>
          <p className="mt-1 text-muted-foreground">
            Start here when you need to decide what gets ordered next.
          </p>
        </div>

        {pendingRecommendations.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {pendingRecommendations.map((recommendation) => (
              <Card
                key={recommendation.id}
                className="rounded-[28px] border-border/60 bg-card/88 shadow-lg shadow-black/5"
              >
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold">{recommendation.inventoryItem.name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {recommendation.supplier.name}
                      </p>
                    </div>
                    <StatusBadge
                      label={
                        recommendation.urgency === "CRITICAL"
                          ? "Urgent"
                          : recommendation.urgency === "WARNING"
                            ? "Watch"
                            : "Info"
                      }
                      tone={
                        recommendation.urgency === "CRITICAL"
                          ? "critical"
                          : recommendation.urgency === "WARNING"
                            ? "warning"
                            : "info"
                      }
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <InfoPill
                      label="Suggested quantity"
                      value={`${recommendation.recommendedPackCount} ${recommendation.recommendedPurchaseUnit.toLowerCase()}`}
                    />
                    <InfoPill label="Status" value="Waiting for manager" />
                  </div>

                  <div className="rounded-[24px] border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
                    {recommendation.rationale}
                  </div>

                  {session.role === Role.MANAGER ? (
                    <div className="space-y-3 rounded-[24px] border border-border/60 bg-background/75 p-4">
                      <form
                        action={approveRecommendationAction}
                        className="grid gap-3 sm:grid-cols-[120px_auto]"
                      >
                        <input
                          type="hidden"
                          name="recommendationId"
                          value={recommendation.id}
                        />
                        <Input
                          name="recommendedPackCount"
                          type="number"
                          min={1}
                          defaultValue={recommendation.recommendedPackCount}
                          className="h-11 rounded-2xl"
                        />
                        <Button type="submit" className="h-11 rounded-2xl">
                          Approve and create PO
                        </Button>
                      </form>

                      <div className="flex flex-wrap gap-2">
                        <form action={deferRecommendationAction}>
                          <input
                            type="hidden"
                            name="recommendationId"
                            value={recommendation.id}
                          />
                          <Button type="submit" variant="outline" size="sm" className="rounded-full">
                            Later
                          </Button>
                        </form>
                        <form action={rejectRecommendationAction}>
                          <input
                            type="hidden"
                            name="recommendationId"
                            value={recommendation.id}
                          />
                          <Button type="submit" variant="ghost" size="sm" className="rounded-full">
                            Reject
                          </Button>
                        </form>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-[24px] border border-border/60 bg-background/75 p-4 text-sm text-muted-foreground">
                      A manager still needs to approve this recommendation.
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No approvals waiting"
            description="New reorder recommendations will show up here as inventory risk increases."
          />
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Order history</h2>
          <p className="mt-1 text-muted-foreground">
            Open any order to see communications, receiving, automation tasks, and audit history.
          </p>
        </div>

        {purchaseOrders.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {purchaseOrders.map((order) => (
              <Link
                key={order.id}
                href={`/purchase-orders/${order.id}`}
                className="rounded-[28px] border border-border/60 bg-card/88 p-5 shadow-lg shadow-black/5 transition-all hover:-translate-y-0.5 hover:border-primary/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold">{order.orderNumber}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{order.supplier.name}</p>
                  </div>
                  <StatusBadge
                    label={order.status}
                    tone={getPurchaseOrderStatusTone(order.status)}
                  />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <InfoPill label="Lines" value={String(order.lines.length)} />
                  <InfoPill label="Created" value={formatDateTime(order.createdAt)} />
                  <InfoPill
                    label="Supplier mode"
                    value={order.supplier.orderingMode.toLowerCase()}
                  />
                </div>

                <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  Open order
                  <ArrowRight className="size-4" />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No purchase orders yet"
            description="Approved recommendations will turn into trackable orders here."
          />
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
      <p className="text-sm text-white/65">{label}</p>
      <p className="mt-3 text-4xl font-semibold">{value}</p>
    </div>
  );
}

function TipCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof ShieldCheck;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
      <Icon className="size-5 text-amber-300" />
      <p className="mt-4 font-semibold">{title}</p>
      <p className="mt-2 text-sm text-white/70">{description}</p>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/80 px-3 py-3">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card className="rounded-[28px] border-dashed border-border/60 bg-card/70">
      <CardContent className="px-6 py-10 text-center">
        <p className="font-medium">{title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
