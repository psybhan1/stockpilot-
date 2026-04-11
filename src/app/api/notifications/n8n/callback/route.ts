import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import type { Prisma } from "@/lib/prisma";
import { NotificationStatus } from "@/lib/prisma";
import { isWebhookSecretValid } from "@/lib/webhook-secret";
import { applyNotificationCallback } from "@/modules/notifications/service";

const notificationCallbackSchema = z.object({
  notificationId: z.string().min(1),
  status: z.nativeEnum(NotificationStatus).default(NotificationStatus.SENT),
  providerMessageId: z.string().trim().min(1).optional(),
  summary: z.string().trim().min(1).optional(),
  error: z.string().trim().min(1).optional(),
  deliveredAt: z.coerce.date().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  if (!isWebhookSecretValid(request.headers, env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ message: "Unauthorized webhook callback." }, { status: 401 });
  }

  const parsedBody = notificationCallbackSchema.safeParse(await request.json());

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        message: "Invalid notification callback payload.",
        errors: parsedBody.error.flatten(),
      },
      { status: 400 }
    );
  }

  const notification = await applyNotificationCallback({
    notificationId: parsedBody.data.notificationId,
    status: parsedBody.data.status,
    providerMessageId: parsedBody.data.providerMessageId,
    summary: parsedBody.data.summary,
    error: parsedBody.data.error,
    deliveredAt: parsedBody.data.deliveredAt,
    metadata: parsedBody.data.metadata as Prisma.InputJsonValue | undefined,
  });

  return NextResponse.json({
    ok: true,
    message: "Notification callback recorded.",
    notificationId: notification.id,
    status: notification.status,
  });
}
