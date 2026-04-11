import { Bot, CheckCircle2, ExternalLink, ListChecks, TriangleAlert } from "lucide-react";

import {
  completeAgentTaskAction,
  dispatchAgentTaskAction,
  failAgentTaskAction,
} from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { getAgentTasksData } from "@/modules/dashboard/queries";

type TaskInputShape = {
  website?: string;
  orderNumber?: string;
  approvalGate?: string;
  steps?: Array<{ title?: string; detail?: string }>;
  evidenceChecklist?: string[];
  browserAutomation?: {
    mode?: string;
    readyForExecution?: boolean;
    scriptLanguage?: string;
    scriptFilename?: string;
    script?: string;
  };
};

type TaskOutputShape = {
  dispatch?: {
    provider?: string;
    summary?: string;
    externalRunId?: string | null;
    externalUrl?: string | null;
    dispatchedAt?: string;
  };
  resolution?: string;
};

export default async function AgentTasksPage() {
  const session = await requireSession(Role.MANAGER);
  const tasks = await getAgentTasksData(session.locationId);

  const pendingCount = tasks.filter((task) => task.status === "PENDING").length;
  const reviewCount = tasks.filter((task) => task.status === "READY_FOR_REVIEW").length;
  const failedCount = tasks.filter((task) => task.status === "FAILED").length;

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border-border/60 bg-[linear-gradient(135deg,rgba(41,37,36,0.98),rgba(87,83,78,0.96))] text-white shadow-2xl shadow-black/10">
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.22em] text-white/60">Agent tasks</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Keep automation work reviewable, explainable, and easy to finish.
            </h1>
            <p className="mt-3 text-base text-white/70 sm:text-lg">
              Website ordering prep and operator assistance can move quickly without bypassing the
              approval-first rules of the product.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard label="Pending" value={pendingCount} />
            <MetricCard label="Ready for review" value={reviewCount} />
            <MetricCard label="Failed" value={failedCount} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {tasks.length ? (
          tasks.map((task) => {
            const input =
              task.input && typeof task.input === "object" && !Array.isArray(task.input)
                ? (task.input as TaskInputShape)
                : null;
            const output =
              task.output && typeof task.output === "object" && !Array.isArray(task.output)
                ? (task.output as TaskOutputShape)
                : null;

            return (
              <Card
                key={task.id}
                className="rounded-[28px] border-border/60 bg-card/88 shadow-lg shadow-black/5"
              >
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Bot className="size-4" />
                        <p className="text-xs uppercase tracking-[0.16em]">
                          {task.supplier?.name ?? "Internal task"}
                        </p>
                      </div>
                      <h2 className="mt-3 text-lg font-semibold">{task.title}</h2>
                      <p className="mt-2 text-sm text-muted-foreground">{task.description}</p>
                    </div>
                    <StatusBadge
                      label={task.status}
                      tone={
                        task.status === "FAILED"
                          ? "critical"
                          : task.status === "READY_FOR_REVIEW"
                            ? "info"
                            : task.status === "PENDING"
                              ? "warning"
                              : "success"
                      }
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <InfoPill label="Order" value={input?.orderNumber ?? "Not specified"} />
                    <InfoPill label="Website" value={input?.website ?? "Not provided"} />
                    <InfoPill label="Type" value={task.type.replaceAll("_", " ").toLowerCase()} />
                  </div>

                  {input?.steps?.length ? (
                    <div className="rounded-[24px] border border-border/60 bg-background/80 p-4">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <ListChecks className="size-4" />
                        <p className="text-xs uppercase tracking-[0.16em]">Review steps</p>
                      </div>
                      <div className="mt-3 space-y-3">
                        {input.steps.map((step, index) => (
                          <div
                            key={`${task.id}-step-${index}`}
                            className="rounded-2xl border border-border/60 bg-card px-3 py-3"
                          >
                            <p className="font-medium">{step.title ?? `Step ${index + 1}`}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {step.detail ?? "No detail provided."}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {input?.evidenceChecklist?.length ? (
                    <div className="rounded-[24px] border border-border/60 bg-background/80 p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        Approval checklist
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {input.evidenceChecklist.map((item) => (
                          <span
                            key={`${task.id}-${item}`}
                            className="rounded-full bg-muted px-3 py-2 text-sm text-muted-foreground"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {input?.approvalGate ? (
                    <div className="rounded-[24px] border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200">
                      {input.approvalGate}
                    </div>
                  ) : null}

                  {input?.browserAutomation?.script ? (
                    <div className="rounded-[24px] border border-border/60 bg-background/80 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                            Browser automation
                          </p>
                          <p className="mt-2 font-medium">
                            {input.browserAutomation.mode ?? "playwright-template"}
                          </p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {input.browserAutomation.readyForExecution
                              ? "A Playwright-ready script is attached for operator review and controlled execution."
                              : "Automation scaffolding is attached for operator review."}
                          </p>
                        </div>
                        {input.browserAutomation.scriptLanguage ? (
                          <StatusBadge
                            label={input.browserAutomation.scriptLanguage.toUpperCase()}
                            tone="info"
                          />
                        ) : null}
                      </div>

                      <div className="mt-3 rounded-2xl border border-border/60 bg-card px-3 py-3">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                          {input.browserAutomation.scriptFilename ?? "website-order.ts"}
                        </p>
                        <pre className="mt-3 overflow-x-auto text-xs leading-6 text-muted-foreground">
                          <code>{input.browserAutomation.script}</code>
                        </pre>
                      </div>
                    </div>
                  ) : null}

                  {output?.dispatch ? (
                    <div className="rounded-[24px] border border-border/60 bg-background/80 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                            Dispatch result
                          </p>
                          <p className="mt-2 font-medium">
                            {output.dispatch.provider ?? "internal"}
                          </p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {output.dispatch.summary ?? "No dispatch summary recorded."}
                          </p>
                        </div>
                        {output.dispatch.provider ? (
                          <StatusBadge label={output.dispatch.provider.toUpperCase()} tone="info" />
                        ) : null}
                      </div>

                      {output.dispatch.externalRunId || output.dispatch.externalUrl ? (
                        <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                          {output.dispatch.externalRunId ? (
                            <p>Run ID: {output.dispatch.externalRunId}</p>
                          ) : null}
                          {output.dispatch.externalUrl ? (
                            <a
                              href={output.dispatch.externalUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 hover:underline"
                            >
                              Open external run
                              <ExternalLink className="size-3.5" />
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    {(task.status === "PENDING" || task.status === "FAILED") && (
                      <form action={dispatchAgentTaskAction}>
                        <input type="hidden" name="taskId" value={task.id} />
                        <Button
                          type="submit"
                          size="sm"
                          variant={task.status === "FAILED" ? "default" : "outline"}
                          className="rounded-full"
                        >
                          <TriangleAlert data-icon="inline-start" />
                          {task.status === "FAILED" ? "Retry dispatch" : "Queue dispatch"}
                        </Button>
                      </form>
                    )}

                    {task.status === "READY_FOR_REVIEW" && (
                      <>
                        <form action={completeAgentTaskAction}>
                          <input type="hidden" name="taskId" value={task.id} />
                          <Button type="submit" size="sm" className="rounded-full">
                            <CheckCircle2 data-icon="inline-start" />
                            Mark completed
                          </Button>
                        </form>
                        <form action={failAgentTaskAction}>
                          <input type="hidden" name="taskId" value={task.id} />
                          <Button type="submit" size="sm" variant="outline" className="rounded-full">
                            Mark failed
                          </Button>
                        </form>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <EmptyState
            title="No automation tasks right now"
            description="Website-order prep and reviewable automation work will show up here when needed."
          />
        )}
      </div>
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
