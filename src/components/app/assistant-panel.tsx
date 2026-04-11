"use client";

import Link from "next/link";
import { type ReactNode, useState, useTransition } from "react";
import { CheckCircle2, ChevronRight, Sparkles } from "lucide-react";

import {
  acknowledgeAlertAction,
  approveRecommendationAction,
  completeAgentTaskAction,
  deferRecommendationAction,
  failAgentTaskAction,
  resolveAlertAction,
} from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Role } from "@/lib/domain-enums";
import { assistantPrompts } from "@/lib/navigation";
import { hasMinimumRole } from "@/lib/permissions";

type AssistantResponse = {
  answer: string;
  suggestedActions?: string[];
};

type AssistantPanelProps = {
  role: Role;
  summary: {
    alerts: Array<{
      id: string;
      title: string;
      severity: string;
      inventoryItem: { name: string } | null;
    }>;
    recommendations: Array<{
      id: string;
      rationale: string;
      urgency: string;
      recommendedPackCount: number;
      recommendedPurchaseUnit: string;
      inventoryItem: { name: string };
      supplier: { name: string };
    }>;
    tasks: Array<{
      id: string;
      title: string;
      status: string;
      supplier: { name: string } | null;
    }>;
  };
};

function toneForSeverity(severity: string) {
  if (severity === "CRITICAL") {
    return "critical" as const;
  }

  if (severity === "WARNING") {
    return "warning" as const;
  }

  return "info" as const;
}

export function AssistantPanel({ role, summary }: AssistantPanelProps) {
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<AssistantResponse | null>(null);
  const [pending, startTransition] = useTransition();
  const canReviewAlerts = hasMinimumRole(role, Role.SUPERVISOR);
  const canApproveOrders = hasMinimumRole(role, Role.MANAGER);
  const canReviewTasks = hasMinimumRole(role, Role.MANAGER);

  async function ask(nextQuestion: string) {
    startTransition(async () => {
      const result = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: nextQuestion }),
      });
      const data = (await result.json()) as AssistantResponse;
      setResponse(data);
      setQuestion(nextQuestion);
    });
  }

  return (
    <Card className="rounded-[28px] border-border/60 bg-card/88 shadow-lg shadow-black/5 backdrop-blur">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-amber-500" />
          Action center
        </CardTitle>
        <CardDescription>
          Your alerts, approvals, and quick answers in one simple place.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          <SummaryPill label="Alerts" value={summary.alerts.length} />
          <SummaryPill label="Orders" value={summary.recommendations.length} />
          <SummaryPill label="Tasks" value={summary.tasks.length} />
        </div>

        <div className="grid gap-3">
          <SectionCard
            title="Needs attention"
            href="/alerts"
            hrefLabel="See all"
            emptyLabel="You're clear right now."
          >
            {summary.alerts.length
              ? summary.alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="rounded-2xl border border-border/60 bg-background/80 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{alert.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {alert.inventoryItem?.name ?? "System alert"}
                        </p>
                      </div>
                      <StatusBadge
                        label={alert.severity}
                        tone={toneForSeverity(alert.severity)}
                      />
                    </div>
                    {canReviewAlerts ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <form action={acknowledgeAlertAction}>
                          <input type="hidden" name="alertId" value={alert.id} />
                          <Button type="submit" size="xs" variant="outline">
                            Seen it
                          </Button>
                        </form>
                        <form action={resolveAlertAction}>
                          <input type="hidden" name="alertId" value={alert.id} />
                          <Button type="submit" size="xs">
                            Done
                          </Button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                ))
              : null}
          </SectionCard>

          <SectionCard
            title="Waiting for approval"
            href="/purchase-orders"
            hrefLabel="Open orders"
            emptyLabel="No order approvals are waiting."
          >
            {summary.recommendations.length
              ? summary.recommendations.map((recommendation) => (
                  <div
                    key={recommendation.id}
                    className="rounded-2xl border border-border/60 bg-background/80 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">
                          {recommendation.inventoryItem.name}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {recommendation.recommendedPackCount}{" "}
                          {recommendation.recommendedPurchaseUnit.toLowerCase()} from{" "}
                          {recommendation.supplier.name}
                        </p>
                      </div>
                      <StatusBadge
                        label={recommendation.urgency}
                        tone={toneForSeverity(recommendation.urgency)}
                      />
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {recommendation.rationale}
                    </p>
                    {canApproveOrders ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <form action={approveRecommendationAction}>
                          <input
                            type="hidden"
                            name="recommendationId"
                            value={recommendation.id}
                          />
                          <input
                            type="hidden"
                            name="recommendedPackCount"
                            value={recommendation.recommendedPackCount}
                          />
                          <Button type="submit" size="xs">
                            Approve
                          </Button>
                        </form>
                        <form action={deferRecommendationAction}>
                          <input
                            type="hidden"
                            name="recommendationId"
                            value={recommendation.id}
                          />
                          <Button type="submit" size="xs" variant="outline">
                            Later
                          </Button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                ))
              : null}
          </SectionCard>

          <SectionCard
            title="Automation to review"
            href="/agent-tasks"
            hrefLabel="Open tasks"
            emptyLabel="No review tasks are waiting."
          >
            {summary.tasks.length
              ? summary.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-2xl border border-border/60 bg-background/80 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{task.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {task.supplier?.name ?? "Internal"}
                        </p>
                      </div>
                      <StatusBadge
                        label={task.status}
                        tone={task.status === "FAILED" ? "critical" : "info"}
                      />
                    </div>
                    {canReviewTasks && task.status === "READY_FOR_REVIEW" ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <form action={completeAgentTaskAction}>
                          <input type="hidden" name="taskId" value={task.id} />
                          <Button type="submit" size="xs">
                            <CheckCircle2 className="size-3.5" />
                            Mark done
                          </Button>
                        </form>
                        <form action={failAgentTaskAction}>
                          <input type="hidden" name="taskId" value={task.id} />
                          <Button type="submit" size="xs" variant="outline">
                            Mark failed
                          </Button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                ))
              : null}
          </SectionCard>
        </div>

        <div className="rounded-[24px] border border-border/60 bg-background/80 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Ask a quick question</p>
            <Sparkles className="size-4 text-amber-500" />
          </div>

          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What are we most likely to run out of this weekend?"
            rows={3}
            className="mt-3 rounded-2xl"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            {assistantPrompts.map((prompt) => (
              <Button
                key={prompt}
                variant="outline"
                size="sm"
                onClick={() => ask(prompt)}
                disabled={pending}
              >
                {prompt}
              </Button>
            ))}
          </div>

          <Button
            onClick={() => ask(question)}
            disabled={pending || !question.trim()}
            className="mt-3 w-full rounded-2xl"
          >
            {pending ? "Thinking..." : "Ask assistant"}
          </Button>

          {response ? (
            <div className="mt-3 rounded-2xl border border-border/60 bg-card p-4 text-sm">
              <p className="text-foreground">{response.answer}</p>
              {response.suggestedActions?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {response.suggestedActions.map((action) => (
                    <span
                      key={action}
                      className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
                    >
                      {action}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/80 px-3 py-3 text-center">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function SectionCard({
  title,
  href,
  hrefLabel,
  emptyLabel,
  children,
}: {
  title: string;
  href: string;
  hrefLabel: string;
  emptyLabel: string;
  children: ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);

  return (
    <div className="rounded-[24px] border border-border/60 bg-background/75 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{title}</p>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {hrefLabel}
          <ChevronRight className="size-3.5" />
        </Link>
      </div>
      <div className="mt-3 space-y-2 text-sm text-muted-foreground">
        {hasChildren ? children : <p>{emptyLabel}</p>}
      </div>
    </div>
  );
}
