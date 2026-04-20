import { AgentTaskStatus, AgentTaskType } from "@/lib/prisma";
import type { Prisma } from "@/lib/prisma";

import { createAuditLogTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createFailureAlertTx } from "@/modules/notifications/service";
import { getAutomationProvider } from "@/providers/automation-provider";

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function dispatchAgentTaskById(taskId: string) {
  const task = await db.agentTask.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      supplier: true,
      purchaseOrder: true,
    },
  });

  if (task.type !== AgentTaskType.WEBSITE_ORDER_PREP) {
    throw new Error("Only website-order preparation tasks can be dispatched.");
  }

  // If the supplier has a website URL and we have Chromium available,
  // use the internal browser agent (safer, tighter approval flow)
  // instead of dispatching to n8n.
  const supplierWebsite = task.supplier?.website?.trim();
  if (supplierWebsite && process.env.BROWSER_AGENT_ENABLED !== "false") {
    try {
      const { runWebsiteOrderAgent } = await import(
        "@/modules/automation/browser-agent"
      );
      await db.agentTask.update({
        where: { id: task.id },
        data: { status: AgentTaskStatus.PENDING, lastAttemptAt: new Date() },
      });
      const agentResult = await runWebsiteOrderAgent(task.id);
      return db.agentTask.findUniqueOrThrow({ where: { id: task.id } });
    } catch (err) {
      // If browser agent fails (e.g. Chromium not available on this
      // host), fall through to the n8n provider path below.
      console.warn(
        "[automation] Browser agent failed, falling through to n8n:",
        err instanceof Error ? err.message : err
      );
    }
  }

  const input = asRecord(task.input);
  const provider = getAutomationProvider();
  const result = await provider.dispatchWebsiteOrderTask({
    taskId: task.id,
    title: task.title,
    description: task.description,
    supplierName: task.supplier?.name ?? "Unknown supplier",
    website:
      task.supplier?.website ??
      (typeof input?.website === "string" ? input.website : null),
    purchaseOrderId: task.purchaseOrderId,
    orderNumber:
      task.purchaseOrder?.orderNumber ??
      (typeof input?.orderNumber === "string" ? input.orderNumber : null),
    requiresApproval: task.requiresApproval,
    reviewUrl: `${env.APP_URL.replace(/\/$/, "")}/agent-tasks`,
    callbackUrl: getAutomationCallbackUrl(),
    callbackSecret: env.N8N_WEBHOOK_SECRET ?? null,
    input,
  });

  const previousOutput = asRecord(task.output);
  const previousHistory = Array.isArray(previousOutput?.dispatchHistory)
    ? previousOutput.dispatchHistory
    : [];
  const dispatchEntry = {
    provider: result.provider,
    summary: result.summary,
    dispatchState: result.dispatchState,
    externalRunId: result.externalRunId ?? null,
    externalUrl: result.externalUrl ?? null,
    dispatchedAt: new Date().toISOString(),
  };

  return db.$transaction(async (tx) => {
    const updatedTask = await tx.agentTask.update({
      where: { id: task.id },
      data: {
        status:
          result.dispatchState === "ready_for_review"
            ? AgentTaskStatus.READY_FOR_REVIEW
            : AgentTaskStatus.PENDING,
        lastAttemptAt: new Date(),
        output: {
          ...(previousOutput ?? {}),
          dispatch: dispatchEntry,
          dispatchHistory: [...previousHistory, dispatchEntry],
          ...(result.metadata
            ? { providerMetadata: result.metadata as Prisma.InputJsonValue }
            : {}),
        },
      },
    });

    await createAuditLogTx(tx, {
      locationId: task.locationId,
      action: "agentTask.dispatched",
      entityType: "agentTask",
      entityId: task.id,
      details: {
        provider: result.provider,
        dispatchState: result.dispatchState,
        externalRunId: result.externalRunId ?? null,
        externalUrl: result.externalUrl ?? null,
      },
    });

    return updatedTask;
  });
}

export function getAutomationCallbackUrl() {
  return `${env.APP_URL.replace(/\/$/, "")}/api/automation/n8n/callback`;
}

export async function applyAgentTaskCallback(input: {
  taskId: string;
  status: "READY_FOR_REVIEW" | "COMPLETED" | "FAILED";
  summary?: string | null;
  error?: string | null;
  externalRunId?: string | null;
  externalUrl?: string | null;
  output?: Prisma.InputJsonValue;
}) {
  const task = await db.agentTask.findUniqueOrThrow({
    where: {
      id: input.taskId,
    },
    include: {
      purchaseOrder: true,
    },
  });

  const previousOutput = asRecord(task.output);
  const previousHistory = Array.isArray(previousOutput?.callbackHistory)
    ? previousOutput.callbackHistory
    : [];
  const callbackEntry = {
    status: input.status,
    summary: input.summary ?? null,
    error: input.error ?? null,
    externalRunId: input.externalRunId ?? null,
    externalUrl: input.externalUrl ?? null,
    receivedAt: new Date().toISOString(),
  };
  const outputRecord = asRecord(input.output);

  return db.$transaction(async (tx) => {
    const nextStatus =
      task.status === AgentTaskStatus.COMPLETED &&
      input.status === AgentTaskStatus.READY_FOR_REVIEW
        ? AgentTaskStatus.COMPLETED
        : input.status;

    const updatedTask = await tx.agentTask.update({
      where: {
        id: task.id,
      },
      data: {
        status: nextStatus,
        lastAttemptAt: new Date(),
        output: {
          ...(previousOutput ?? {}),
          ...(outputRecord ?? {}),
          callback: callbackEntry,
          callbackHistory: [...previousHistory, callbackEntry],
          ...(input.externalRunId ? { externalRunId: input.externalRunId } : {}),
          ...(input.externalUrl ? { externalUrl: input.externalUrl } : {}),
        },
      },
    });

    if (
      input.status === AgentTaskStatus.FAILED &&
      task.purchaseOrderId &&
      task.purchaseOrder &&
      !["DELIVERED", "CANCELLED"].includes(task.purchaseOrder.status)
    ) {
      await tx.purchaseOrder.update({
        where: {
          id: task.purchaseOrderId,
        },
        data: {
          status: "FAILED",
          notes: [
            task.purchaseOrder.notes?.trim(),
            input.error?.trim() || input.summary?.trim() || "n8n reported a website-order preparation failure.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      });
    }

    if (input.status === AgentTaskStatus.FAILED) {
      await createFailureAlertTx(tx, {
        locationId: task.locationId,
        title: `${task.title} failed`,
        message:
          input.error ??
          input.summary ??
          "n8n reported a failure while preparing the website order workflow.",
        metadata: {
          agentTaskId: task.id,
          purchaseOrderId: task.purchaseOrderId,
          externalRunId: input.externalRunId ?? null,
          externalUrl: input.externalUrl ?? null,
          ...(outputRecord ? { output: outputRecord } : {}),
        } as Prisma.InputJsonValue,
      });
    }

    await createAuditLogTx(tx, {
      locationId: task.locationId,
      action:
        input.status === AgentTaskStatus.FAILED
          ? "agentTask.callback_failed"
          : "agentTask.callback_received",
      entityType: "agentTask",
      entityId: task.id,
      details: {
        status: nextStatus,
        summary: input.summary ?? null,
        error: input.error ?? null,
        externalRunId: input.externalRunId ?? null,
        externalUrl: input.externalUrl ?? null,
      },
    });

    return updatedTask;
  });
}
