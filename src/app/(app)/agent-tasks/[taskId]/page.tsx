/**
 * Live view of a browser-ordering agent task. Shows each step
 * (launched, login, search, product, add-to-cart, cart view) as it
 * lands in the AgentTaskStep table, with inline screenshots.
 *
 * Auto-refreshes while the task is still running so managers can
 * watch the agent work. Once the task lands in READY_FOR_REVIEW /
 * COMPLETED / FAILED we stop refreshing and show the final summary.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clock, XCircle, Loader2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/app/status-badge";
import { db } from "@/lib/db";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import {
  humaniseStepName,
  listAgentSteps,
} from "@/modules/automation/agent-steps";

// Auto-refresh the server component every 2s while the task is still
// progressing (the step list polls itself). Next.js revalidates the
// page render but the <meta http-equiv="refresh"> fallback also keeps
// JS-less browsers working.
export const dynamic = "force-dynamic";

// Tasks are "live" while they're queued or executing — the status
// transitions PENDING → READY_FOR_REVIEW / COMPLETED / FAILED when
// the browser agent finishes. Only PENDING is truly live in our
// schema, but we keep this as a Set for future extensibility.
const LIVE_STATUSES = new Set(["PENDING"]);

export default async function AgentTaskLivePage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const session = await requireSession(Role.STAFF);

  const task = await db.agentTask.findFirst({
    where: { id: taskId, locationId: session.locationId },
    include: {
      supplier: { select: { name: true, website: true } },
      purchaseOrder: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          lines: {
            select: {
              description: true,
              quantityOrdered: true,
              inventoryItem: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!task) notFound();

  const steps = await listAgentSteps(task.id);
  const isLive = LIVE_STATUSES.has(task.status);

  return (
    <div className="flex flex-col gap-6">
      {/* Force a page refresh every 2s while the task is still running.
          Once it lands in a terminal state we stop auto-refreshing so
          the cart screenshot doesn't keep blinking in place. */}
      {isLive ? (
        <meta httpEquiv="refresh" content="2" />
      ) : null}

      <Card className="border-border/60 bg-[linear-gradient(135deg,rgba(240,249,255,0.92),rgba(255,255,255,0.94))] shadow-xl shadow-black/5 dark:bg-[linear-gradient(135deg,rgba(23,37,84,0.92),rgba(15,23,42,0.94))]">
        <CardContent className="flex flex-col gap-4 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="max-w-2xl">
              <Link
                href="/agent-tasks"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-4" /> All agent tasks
              </Link>
              <p className="mt-3 text-sm uppercase tracking-[0.22em] text-sky-600 dark:text-sky-300">
                {task.supplier?.name ?? "Supplier"} · Website order
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                {task.purchaseOrder?.orderNumber ?? task.title}
              </h1>
              {task.purchaseOrder ? (
                <p className="mt-3 text-muted-foreground">
                  {task.purchaseOrder.lines
                    .map((l) => `${l.quantityOrdered}× ${l.description || l.inventoryItem.name}`)
                    .join(" · ")}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col items-end gap-2">
              <StatusBadge
                label={
                  isLive
                    ? "Working..."
                    : task.status === "READY_FOR_REVIEW"
                      ? "Ready to review"
                      : task.status === "COMPLETED"
                        ? "Completed"
                        : task.status === "FAILED"
                          ? "Failed"
                          : task.status
                }
                tone={
                  task.status === "FAILED"
                    ? "critical"
                    : task.status === "COMPLETED"
                      ? "success"
                      : isLive
                        ? "info"
                        : "neutral"
                }
              />
              {isLive ? (
                <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  auto-refreshing every 2s
                </p>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="p-0">
          {steps.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
              <p className="font-medium text-foreground">Starting up…</p>
              <p className="text-sm">
                The browser agent is launching Chrome. First step should appear in a moment.
              </p>
            </div>
          ) : (
            <ol className="divide-y divide-border/60">
              {steps.map((step, idx) => (
                <StepRow
                  key={step.id}
                  taskId={task.id}
                  step={step}
                  isLast={idx === steps.length - 1}
                  isLive={isLive}
                />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {task.purchaseOrder ? (
        <div className="flex items-center justify-end">
          <Link
            href={`/purchase-orders/${task.purchaseOrder.id}`}
            className="text-sm font-medium text-sky-600 hover:underline dark:text-sky-300"
          >
            Open {task.purchaseOrder.orderNumber} →
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function StepRow({
  taskId,
  step,
  isLast,
  isLive,
}: {
  taskId: string;
  step: {
    id: string;
    sequence: number;
    name: string;
    status: string;
    notes: string | null;
    startedAt: Date;
    endedAt: Date | null;
  };
  isLast: boolean;
  isLive: boolean;
}) {
  const label = humaniseStepName(step.name);
  const duration =
    step.endedAt && step.startedAt
      ? Math.max(0, step.endedAt.getTime() - step.startedAt.getTime())
      : null;
  const durationLabel =
    duration === null ? null : duration < 1000 ? `<1s` : `${Math.round(duration / 1000)}s`;

  const runningNow = step.status === "running" && isLast && isLive;

  return (
    <li className="flex gap-4 p-5">
      <div className="mt-1 shrink-0">
        {step.status === "ok" ? (
          <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
        ) : step.status === "failed" ? (
          <XCircle className="size-5 text-rose-600 dark:text-rose-400" />
        ) : runningNow ? (
          <Loader2 className="size-5 animate-spin text-sky-600 dark:text-sky-400" />
        ) : (
          <Clock className="size-5 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-medium">
            <span className="text-xs text-muted-foreground">#{step.sequence} · </span>
            {label}
          </p>
          <span className="text-xs text-muted-foreground">
            {durationLabel ?? "running..."}
          </span>
        </div>
        {step.notes ? (
          <p className="text-sm text-muted-foreground">{step.notes}</p>
        ) : null}
        {/* Render screenshot inline via the authenticated API route.
            loading="lazy" so older steps don't re-fetch on every
            auto-refresh — just the latest one. */}
        <img
          src={`/api/agent-tasks/${taskId}/steps/${step.id}/screenshot`}
          alt={label}
          loading="lazy"
          className="mt-2 max-h-80 w-full rounded-xl border border-border/60 object-cover object-top"
          onError={(e) => {
            // Screenshot absent (text-only step) — hide the <img>.
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
    </li>
  );
}
