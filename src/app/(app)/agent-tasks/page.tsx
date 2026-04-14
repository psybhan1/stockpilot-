import { Bot, ExternalLink, ListChecks } from "lucide-react";

import {
  completeAgentTaskAction,
  dispatchAgentTaskAction,
  failAgentTaskAction,
} from "@/app/actions/operations";
import { PageHero } from "@/components/app/page-hero";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
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

  const pendingCount = tasks.filter((t) => t.status === "PENDING").length;
  const reviewCount = tasks.filter((t) => t.status === "READY_FOR_REVIEW").length;
  const failedCount = tasks.filter((t) => t.status === "FAILED").length;

  return (
    <div className="space-y-10">
      <PageHero
        eyebrow="Agent Tasks"
        title="Automation queue"
        subtitle="machines at work."
        description="Review and manage automated ordering and website tasks."
        stats={[
          { label: "Pending", value: String(pendingCount).padStart(2, "0"), highlight: pendingCount > 0 },
          { label: "Ready for review", value: String(reviewCount).padStart(2, "0") },
          { label: "Failed", value: String(failedCount).padStart(2, "0"), highlight: failedCount > 0 },
        ]}
      />

      {/* Task list */}
      <section className="space-y-3">
        {tasks.length ? (
          tasks.map((task) => {
            const input = task.input && typeof task.input === "object" && !Array.isArray(task.input)
              ? (task.input as TaskInputShape) : null;
            const output = task.output && typeof task.output === "object" && !Array.isArray(task.output)
              ? (task.output as TaskOutputShape) : null;

            return (
              <div key={task.id} className="rounded-xl border border-border/50 bg-card p-5 space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Bot className="size-3.5" />
                      <span>{task.supplier?.name ?? "Internal"}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium">{task.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{task.description}</p>
                  </div>
                  <StatusBadge
                    label={task.status}
                    tone={task.status === "FAILED" ? "critical" : task.status === "READY_FOR_REVIEW" ? "info" : task.status === "PENDING" ? "warning" : "success"}
                  />
                </div>

                {/* Meta */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Type: {task.type.replaceAll("_", " ").toLowerCase()}</span>
                  {input?.orderNumber && <span>Order: {input.orderNumber}</span>}
                  {input?.website && <span>Site: {input.website}</span>}
                </div>

                {/* Steps */}
                {input?.steps?.length ? (
                  <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <ListChecks className="size-3.5" />
                      <span>Steps</span>
                    </div>
                    {input.steps.map((step, i) => (
                      <div key={`${task.id}-step-${i}`} className="text-xs">
                        <p className="font-medium">{step.title ?? `Step ${i + 1}`}</p>
                        {step.detail && <p className="text-muted-foreground">{step.detail}</p>}
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Evidence checklist */}
                {input?.evidenceChecklist?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {input.evidenceChecklist.map((item) => (
                      <span key={`${task.id}-${item}`} className="rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}

                {/* Approval gate */}
                {input?.approvalGate && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
                    {input.approvalGate}
                  </div>
                )}

                {/* Browser automation */}
                {input?.browserAutomation?.script && (
                  <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium">Browser automation</p>
                      {input.browserAutomation.scriptLanguage && (
                        <StatusBadge label={input.browserAutomation.scriptLanguage.toUpperCase()} tone="info" />
                      )}
                    </div>
                    <pre className="overflow-x-auto rounded-md bg-card p-2 text-xs leading-5 text-muted-foreground">
                      <code>{input.browserAutomation.script}</code>
                    </pre>
                  </div>
                )}

                {/* Dispatch result */}
                {output?.dispatch && (
                  <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium">Dispatch: {output.dispatch.provider ?? "internal"}</p>
                      {output.dispatch.provider && <StatusBadge label={output.dispatch.provider.toUpperCase()} tone="info" />}
                    </div>
                    {output.dispatch.summary && <p className="text-xs text-muted-foreground">{output.dispatch.summary}</p>}
                    {output.dispatch.externalUrl && (
                      <a href={output.dispatch.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        Open external run <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  {(task.status === "PENDING" || task.status === "FAILED") && (
                    <form action={dispatchAgentTaskAction}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <Button type="submit" size="sm" variant={task.status === "FAILED" ? "default" : "outline"} className="h-8 text-xs">
                        {task.status === "FAILED" ? "Retry dispatch" : "Queue dispatch"}
                      </Button>
                    </form>
                  )}
                  {task.status === "READY_FOR_REVIEW" && (
                    <>
                      <form action={completeAgentTaskAction}>
                        <input type="hidden" name="taskId" value={task.id} />
                        <Button type="submit" size="sm" className="h-8 text-xs">
                          Mark completed
                        </Button>
                      </form>
                      <form action={failAgentTaskAction}>
                        <input type="hidden" name="taskId" value={task.id} />
                        <Button type="submit" size="sm" variant="outline" className="h-8 text-xs text-muted-foreground">
                          Mark failed
                        </Button>
                      </form>
                    </>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-xl border border-dashed border-border/50 px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">No automation tasks right now</p>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value, highlight }: { label: string; value: number; highlight?: "warning" | "critical" }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${
        highlight === "critical" ? "text-red-500" : highlight === "warning" ? "text-amber-500" : ""
      }`}>{value}</p>
    </div>
  );
}
