import {
  AlertSeverity,
  AlertStatus,
  AlertType,
  JobType,
  NotificationChannel,
  NotificationStatus,
  Role,
} from "@/lib/prisma";
import type { Prisma } from "@/lib/prisma";

import { createAuditLogTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getNotificationProvider } from "@/providers/notification-provider";

export async function queueManagerEmailNotificationsTx(
  tx: Prisma.TransactionClient,
  input: {
    locationId: string;
    alertId: string;
    subject: string;
    body: string;
  }
) {
  const managers = await tx.userLocationRole.findMany({
    where: {
      locationId: input.locationId,
      role: Role.MANAGER,
    },
    include: {
      user: true,
    },
  });

  if (managers.length === 0) {
    return [];
  }

  const notifications = [];

  for (const manager of managers) {
    const { notification, job } = await queueNotificationTx(tx, {
      locationId: input.locationId,
      alertId: input.alertId,
      channel: NotificationChannel.EMAIL,
      recipient: manager.user.email,
      subject: input.subject,
      body: input.body,
    });

    notifications.push({ notification, job });
  }

  return notifications;
}

export async function queueNotificationTx(
  tx: Prisma.TransactionClient,
  input: {
    locationId: string;
    alertId?: string;
    channel: NotificationChannel;
    recipient: string;
    subject?: string;
    body: string;
  }
) {
  const notification = await tx.notification.create({
    data: {
      locationId: input.locationId,
      alertId: input.alertId,
      channel: input.channel,
      recipient: input.recipient,
      subject: input.subject,
      body: input.body,
      status: NotificationStatus.QUEUED,
    },
  });

  const job = await tx.jobRun.create({
    data: {
      locationId: input.locationId,
      type: JobType.SEND_EMAIL,
      payload: {
        notificationId: notification.id,
      },
    },
  });

  return { notification, job };
}

export async function deliverNotificationById(notificationId: string) {
  const notification = await getNotificationNotification(notificationId);

  const provider = getNotificationProvider();
  const result = await provider.sendNotification({
    notificationId: notification.id,
    channel: notification.channel,
    recipient: notification.recipient,
    subject: notification.subject ?? "StockPilot notification",
    body: notification.body,
    callbackUrl: getNotificationCallbackUrl(),
    callbackSecret: env.N8N_WEBHOOK_SECRET ?? null,
  });

  return {
    providerMessageId: result.providerMessageId,
    deliveryState: result.deliveryState,
    metadata: result.metadata,
  };
}

export function getNotificationCallbackUrl() {
  return `${env.APP_URL.replace(/\/$/, "")}/api/notifications/n8n/callback`;
}

export async function applyNotificationCallback(input: {
  notificationId: string;
  status: NotificationStatus;
  providerMessageId?: string | null;
  summary?: string | null;
  error?: string | null;
  deliveredAt?: Date | null;
  metadata?: Prisma.InputJsonValue;
}) {
  const notification = await db.notification.findUniqueOrThrow({
    where: {
      id: input.notificationId,
    },
  });

  return db.$transaction(async (tx) => {
    const nextSentAt =
      input.status === NotificationStatus.SENT
        ? input.deliveredAt ?? notification.sentAt ?? new Date()
        : null;

    const updatedNotification = await tx.notification.update({
      where: {
        id: notification.id,
      },
      data: {
        status: input.status,
        sentAt: nextSentAt,
        providerMessageId: input.providerMessageId ?? undefined,
        metadata: input.metadata ?? undefined,
      },
    });

    if (input.status === NotificationStatus.FAILED) {
      await createFailureAlertTx(tx, {
        locationId: notification.locationId,
        title: `Notification delivery failed for ${notification.recipient}`,
        message:
          input.error ??
          input.summary ??
          `StockPilot could not deliver the ${notification.channel.toLowerCase()} notification to ${notification.recipient}.`,
        severity: AlertSeverity.WARNING,
        metadata: {
          notificationId: notification.id,
          channel: notification.channel,
          recipient: notification.recipient,
          providerMessageId: input.providerMessageId ?? null,
          ...(input.metadata && typeof input.metadata === "object"
            ? { callback: input.metadata }
            : {}),
        },
      });
    }

    await createAuditLogTx(tx, {
      locationId: notification.locationId,
      action:
        input.status === NotificationStatus.SENT
          ? "notification.delivered"
          : "notification.delivery_failed",
      entityType: "notification",
      entityId: notification.id,
      details: {
        recipient: notification.recipient,
        channel: notification.channel,
        providerMessageId: input.providerMessageId ?? null,
        summary: input.summary ?? null,
        error: input.error ?? null,
        metadata: input.metadata ?? null,
      },
    });

    return updatedNotification;
  });
}

export async function createFailureAlertTx(
  tx: Prisma.TransactionClient,
  input: {
    locationId: string;
    title: string;
    message: string;
    severity?: AlertSeverity;
    metadata?: Prisma.InputJsonValue;
  }
) {
  const alert = await tx.alert.create({
    data: {
      locationId: input.locationId,
      type: AlertType.SYNC_FAILURE,
      severity: input.severity ?? AlertSeverity.WARNING,
      title: input.title,
      message: input.message,
      status: AlertStatus.OPEN,
      metadata: input.metadata,
    },
  });

  await queueManagerEmailNotificationsTx(tx, {
    locationId: input.locationId,
    alertId: alert.id,
    subject: alert.title,
    body: alert.message,
  });

  return alert;
}

async function getNotificationNotification(notificationId: string) {
  return db.notification.findUniqueOrThrow({
    where: {
      id: notificationId,
    },
  });
}

