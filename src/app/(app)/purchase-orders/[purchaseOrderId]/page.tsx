import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  acknowledgePurchaseOrderAction,
  cancelPurchaseOrderAction,
  dispatchAgentTaskAction,
  deliverPurchaseOrderAction,
  markPurchaseOrderSentAction,
} from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { SupplierConversation } from "@/components/app/supplier-conversation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Role } from "@/lib/domain-enums";
import { formatDateTime, formatRelativeDays } from "@/lib/format";
import { requireSession } from "@/modules/auth/session";
import { getPurchaseOrderDetail } from "@/modules/dashboard/queries";
import { formatQuantityBase } from "@/modules/inventory/units";
import {
  canAcknowledgePurchaseOrder,
  canCancelPurchaseOrder,
  canDeliverPurchaseOrder,
  canMarkPurchaseOrderSent,
  getPurchaseOrderStatusTone,
} from "@/modules/purchasing/lifecycle";

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ purchaseOrderId: string }>;
}) {
  const session = await requireSession(Role.SUPERVISOR);
  const { purchaseOrderId } = await params;
  const purchaseOrder = await getPurchaseOrderDetail(session.locationId, purchaseOrderId).catch(
    () => null
  );

  if (!purchaseOrder) {
    notFound();
  }

  const canMarkSent =
    session.role === Role.MANAGER && canMarkPurchaseOrderSent(purchaseOrder.status);
  const canAcknowledge = canAcknowledgePurchaseOrder(purchaseOrder.status);
  const canDeliver = canDeliverPurchaseOrder(purchaseOrder.status);
  const canCancel =
    session.role === Role.MANAGER && canCancelPurchaseOrder(purchaseOrder.status);

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border-border/60 bg-[linear-gradient(135deg,rgba(41,37,36,0.98),rgba(87,83,78,0.96))] text-white shadow-2xl shadow-black/10">
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm uppercase tracking-[0.22em] text-white/60">Purchase order</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                {purchaseOrder.orderNumber}
              </h1>
              <p className="mt-3 text-base text-white/70 sm:text-lg">
                Supplier{" "}
                <Link
                  href={`/suppliers/${purchaseOrder.supplierId}`}
                  className="font-medium text-white hover:text-white/80"
                >
                  {purchaseOrder.supplier.name}
                </Link>{" "}
                - {purchaseOrder.supplier.orderingMode.toLowerCase()} workflow
              </p>
            </div>

            <StatusBadge
              label={purchaseOrder.status}
              tone={getPurchaseOrderStatusTone(purchaseOrder.status)}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <MetricCard label="Created" value={formatDateTime(purchaseOrder.createdAt)} />
            <MetricCard label="Approved" value={formatDateTime(purchaseOrder.approvedAt)} />
            <MetricCard label="Sent" value={formatDateTime(purchaseOrder.sentAt)} />
            <MetricCard label="Delivered" value={formatDateTime(purchaseOrder.deliveredAt)} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <Panel
            title="Order summary"
            description="Everything tied to the recommendation and current purchasing context."
          >
            <div className="grid gap-3 md:grid-cols-2">
              <InfoPill
                label="Recommendation"
                value={
                  purchaseOrder.recommendation?.rationale ??
                  "This order was created outside the current recommendation queue."
                }
                muted
              />
              <InfoPill label="Notes" value={purchaseOrder.notes ?? "No notes yet."} muted />
            </div>
          </Panel>

          <Panel
            title="Line items"
            description="Open any linked item if you want to review current runway before receiving."
          >
            <div className="space-y-3">
              {purchaseOrder.lines.map((line) => (
                <div
                  key={line.id}
                  className="notif-card p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        href={`/inventory/${line.inventoryItemId}`}
                        className="font-medium hover:underline"
                      >
                        {line.description}
                      </Link>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {line.inventoryItem.name}
                  </p>
                    </div>
                    <StatusBadge
                      label={formatRelativeDays(line.inventoryItem.snapshot?.daysLeft)}
                      tone={
                        line.inventoryItem.snapshot?.urgency === "CRITICAL"
                          ? "critical"
                          : line.inventoryItem.snapshot?.urgency === "WARNING"
                            ? "warning"
                            : "info"
                      }
                    />
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <InfoPill
                      label="Ordered"
                      value={`${line.quantityOrdered} ${line.purchaseUnit.toLowerCase()}`}
                    />
                    <InfoPill
                      label="Expected stock added"
                      value={formatQuantityBase(
                        line.expectedQuantityBase,
                        line.inventoryItem.displayUnit,
                        line.inventoryItem.packSizeBase
                      )}
                    />
                    <InfoPill
                      label="Current runway"
                      value={formatRelativeDays(line.inventoryItem.snapshot?.daysLeft)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          {canDeliver ? (
            <Panel
              title="Receive delivery"
              description="Adjust received pack counts if the shipment differs from the order."
            >
              <form action={deliverPurchaseOrderAction} className="space-y-4">
                <input type="hidden" name="purchaseOrderId" value={purchaseOrder.id} />

                <div className="grid gap-3 md:grid-cols-2">
                  {purchaseOrder.lines.map((line) => (
                    <label
                      key={line.id}
                      className="notif-card p-4"
                    >
                      <span className="font-medium">{line.description}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        Ordered {line.quantityOrdered} {line.purchaseUnit.toLowerCase()}
                      </span>
                      <Input
                        name={`received-${line.id}`}
                        type="number"
                        min={0}
                        defaultValue={line.quantityOrdered}
                        className="mt-3 h-11 rounded-2xl"
                      />
                    </label>
                  ))}
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium">Receiving note</p>
                  <Textarea
                    name="notes"
                    rows={3}
                    placeholder="Optional receiving note for the audit trail"
                    className="rounded-2xl"
                  />
                </div>

                <Button type="submit" className="rounded-2xl">
                  Mark delivered and receive stock
                </Button>
              </form>
            </Panel>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel
              title="Supplier conversation"
              description="The exact email we sent and every reply from the supplier — with intent automatically classified."
            >
              <SupplierConversation
                supplierEmail={purchaseOrder.supplier.email}
                entries={purchaseOrder.communications.map((c) => ({
                  id: c.id,
                  direction: c.direction,
                  subject: c.subject,
                  body: c.body,
                  status: c.status,
                  createdAt: c.createdAt.toISOString(),
                  sentAt: c.sentAt ? c.sentAt.toISOString() : null,
                  metadata:
                    c.metadata && typeof c.metadata === "object"
                      ? (c.metadata as Record<string, unknown>)
                      : null,
                }))}
              />
            </Panel>

            <Panel
              title="Automation tasks"
              description="Website-order prep and review tasks connected to this PO."
            >
              <div className="space-y-3">
                {purchaseOrder.agentTasks.length ? (
                  purchaseOrder.agentTasks.map((task) => (
                    <div
                      key={task.id}
                      className="notif-card p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{task.title}</p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {task.description}
                          </p>
                        </div>
                        <StatusBadge
                          label={task.status}
                          tone={
                            task.status === "FAILED"
                              ? "critical"
                              : task.status === "PENDING"
                                ? "warning"
                                : "info"
                          }
                        />
                      </div>

                      {task.status === "PENDING" || task.status === "FAILED" ? (
                        <form action={dispatchAgentTaskAction} className="mt-3">
                          <input type="hidden" name="taskId" value={task.id} />
                          <Button type="submit" size="sm" variant="outline" className="rounded-full">
                            {task.status === "FAILED"
                              ? "Retry automation dispatch"
                              : "Queue automation dispatch"}
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <EmptyState
                    title="No automation tasks"
                    description="Website ordering prep tasks will show up here when needed."
                  />
                )}
              </div>
            </Panel>
          </div>
        </div>

        <div className="space-y-6">
          <Panel
            title="What to do next"
            description="Managers control outbound order state. Supervisors can acknowledge and receive stock."
          >
            <div className="space-y-4">
              {canMarkSent ? (
                <ActionForm
                  title="Mark order sent"
                  description="Use this for manual or internal supplier workflows once the order has been placed."
                  action={markPurchaseOrderSentAction}
                  hiddenName="purchaseOrderId"
                  hiddenValue={purchaseOrder.id}
                  buttonLabel="Mark order sent"
                />
              ) : null}

              {canAcknowledge ? (
                <ActionForm
                  title="Mark supplier acknowledged"
                  description="Record that the supplier confirmed the order or delivery slot."
                  action={acknowledgePurchaseOrderAction}
                  hiddenName="purchaseOrderId"
                  hiddenValue={purchaseOrder.id}
                  buttonLabel="Mark acknowledged"
                  variant="outline"
                />
              ) : null}

              {canCancel ? (
                <ActionForm
                  title="Cancel order"
                  description="Use this when the supplier cannot fulfill or the order is no longer needed."
                  action={cancelPurchaseOrderAction}
                  hiddenName="purchaseOrderId"
                  hiddenValue={purchaseOrder.id}
                  buttonLabel="Cancel order"
                  variant="ghost"
                  notePlaceholder="Cancellation reason"
                />
              ) : null}

              {!canMarkSent && !canAcknowledge && !canCancel ? (
                <EmptyState
                  title="No further action needed here"
                  description="This order is already in a closed state. Review the audit history for the full timeline."
                />
              ) : null}
            </div>
          </Panel>

          <Panel
            title="Audit history"
            description="Every lifecycle change stays visible for operators and managers."
          >
            <div className="space-y-3">
              {purchaseOrder.auditLogs.length ? (
                purchaseOrder.auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="notif-card p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{log.action}</p>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(log.createdAt)}
                      </span>
                    </div>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-sm text-muted-foreground">
                      {JSON.stringify(log.details ?? {}, null, 2)}
                    </pre>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="No audit entries yet"
                  description="Important changes to this order will appear here automatically."
                />
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
      <p className="text-sm text-white/65">{label}</p>
      <p className="mt-3 text-lg font-semibold">{value}</p>
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
    <Card className="rounded-[28px] border-border/60 bg-card/88 shadow-lg shadow-black/5">
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

function InfoPill({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="notif-card p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className={muted ? "mt-2 text-sm text-muted-foreground" : "mt-2 font-medium"}>{value}</p>
    </div>
  );
}

function ActionForm({
  title,
  description,
  action,
  hiddenName,
  hiddenValue,
  buttonLabel,
  variant = "default",
  notePlaceholder = "Optional note",
}: {
  title: string;
  description: string;
  action: (formData: FormData) => Promise<void>;
  hiddenName: string;
  hiddenValue: string;
  buttonLabel: string;
  variant?: "default" | "outline" | "ghost";
  notePlaceholder?: string;
}) {
  return (
    <form action={action} className="space-y-3 notif-card p-4">
      <input type="hidden" name={hiddenName} value={hiddenValue} />
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <Textarea name="notes" rows={3} placeholder={notePlaceholder} className="rounded-2xl" />
      <Button type="submit" variant={variant} className="w-full rounded-2xl">
        {buttonLabel}
      </Button>
    </form>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-border px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
