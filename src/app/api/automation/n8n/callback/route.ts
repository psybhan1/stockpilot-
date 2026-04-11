import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import type { Prisma } from "@/lib/prisma";
import { AgentTaskStatus } from "@/lib/prisma";
import { isWebhookSecretValid } from "@/lib/webhook-secret";
import { applyAgentTaskCallback } from "@/modules/automation/service";

const automationCallbackSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum([
    AgentTaskStatus.READY_FOR_REVIEW,
    AgentTaskStatus.COMPLETED,
    AgentTaskStatus.FAILED,
  ]),
  summary: z.string().trim().min(1).optional(),
  error: z.string().trim().min(1).optional(),
  externalRunId: z.string().trim().min(1).optional(),
  externalUrl: z.string().trim().min(1).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  if (!isWebhookSecretValid(request.headers, env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ message: "Unauthorized webhook callback." }, { status: 401 });
  }

  const parsedBody = automationCallbackSchema.safeParse(await request.json());

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        message: "Invalid automation callback payload.",
        errors: parsedBody.error.flatten(),
      },
      { status: 400 }
    );
  }

  const task = await applyAgentTaskCallback({
    taskId: parsedBody.data.taskId,
    status: parsedBody.data.status,
    summary: parsedBody.data.summary,
    error: parsedBody.data.error,
    externalRunId: parsedBody.data.externalRunId,
    externalUrl: parsedBody.data.externalUrl,
    output: parsedBody.data.output as Prisma.InputJsonValue | undefined,
  });

  return NextResponse.json({
    ok: true,
    message: "Automation callback recorded.",
    taskId: task.id,
    status: task.status,
  });
}
