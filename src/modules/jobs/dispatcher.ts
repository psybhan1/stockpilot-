import { JobStatus, JobType, databaseUsesPostgres } from "@/lib/prisma";
import type { Prisma } from "@/lib/prisma";

import { createAuditLogTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { dispatchAgentTaskById } from "@/modules/automation/service";
import { refreshOperationalState } from "@/modules/inventory/ledger";
import {
  createFailureAlertTx,
  deliverNotificationById,
} from "@/modules/notifications/service";
import { importSampleSales, syncCatalog } from "@/modules/pos/service";

type JobPayload = Record<string, unknown>;

export async function enqueueJob(input: {
  locationId?: string;
  type: keyof typeof JobType | JobType;
  payload?: JobPayload;
}) {
  return db.jobRun.create({
    data: {
      locationId: input.locationId,
      type: input.type as JobType,
      payload: input.payload as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function enqueueJobTx(
  tx: Prisma.TransactionClient,
  input: {
    locationId?: string;
    type: keyof typeof JobType | JobType;
    payload?: JobPayload;
  }
) {
  return tx.jobRun.create({
    data: {
      locationId: input.locationId,
      type: input.type as JobType,
      payload: input.payload as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function runPendingJobs(limit = 10) {
  let processed = 0;

  for (let index = 0; index < limit; index += 1) {
    const nextJob = await claimNextJob();
    if (!nextJob) {
      break;
    }

    try {
      switch (nextJob.type) {
        case JobType.SYNC_CATALOG: {
          const integrationId = readPayloadString(nextJob.payload, "integrationId");

          if (!integrationId) {
            throw new Error("SYNC_CATALOG job is missing integrationId.");
          }

          await syncCatalog(integrationId, readPayloadString(nextJob.payload, "userId"));
          break;
        }
        case JobType.SYNC_SALES: {
          const integrationId = readPayloadString(nextJob.payload, "integrationId");

          if (!integrationId) {
            throw new Error("SYNC_SALES job is missing integrationId.");
          }

          await importSampleSales(integrationId, readPayloadString(nextJob.payload, "userId"));
          break;
        }
        case JobType.REFRESH_FORECAST:
        case JobType.EVALUATE_ALERTS:
        case JobType.GENERATE_REORDERS:
          await refreshOperationalState(
            String(nextJob.locationId),
            ((nextJob.payload as JobPayload)?.inventoryItemIds as string[]) ?? []
          );
          break;
        case JobType.SEND_EMAIL: {
          const notificationId = String((nextJob.payload as JobPayload)?.notificationId ?? "");
          const deliveryResult = await deliverNotificationById(notificationId);

          await db.notification.update({
            where: {
              id: notificationId,
            },
            data: {
              status: deliveryResult.deliveryState === "sent" ? "SENT" : "QUEUED",
              sentAt: deliveryResult.deliveryState === "sent" ? new Date() : null,
              providerMessageId: deliveryResult.providerMessageId ?? undefined,
              metadata: deliveryResult.metadata as Prisma.InputJsonValue | undefined,
            },
          });
          break;
        }
        case JobType.PREPARE_WEBSITE_ORDER: {
          const taskId = String((nextJob.payload as JobPayload)?.taskId ?? "");
          await dispatchAgentTaskById(taskId);
          break;
        }
        default:
          break;
      }

      await db.jobRun.update({
        where: { id: nextJob.id },
        data: {
          status: JobStatus.COMPLETED,
        },
      });
      processed += 1;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown job failure";

      if (nextJob.type === JobType.SEND_EMAIL) {
        const notificationId = String((nextJob.payload as JobPayload)?.notificationId ?? "");
        if (notificationId) {
          await db.notification.update({
            where: { id: notificationId },
            data: {
              status: "FAILED",
              metadata: {
                error: errorMessage,
                failedAt: new Date().toISOString(),
              },
            },
          });
        }
      }

      await db.$transaction(async (tx) => {
        await tx.jobRun.update({
          where: { id: nextJob.id },
          data: {
            status: JobStatus.FAILED,
            lastError: errorMessage,
          },
        });

        if (
          nextJob.locationId &&
          ([
            JobType.SYNC_CATALOG,
            JobType.SYNC_SALES,
            JobType.PREPARE_WEBSITE_ORDER,
          ] as JobType[]).includes(
            nextJob.type
          )
        ) {
          await createFailureAlertTx(tx, {
            locationId: nextJob.locationId,
            title:
              nextJob.type === JobType.SYNC_CATALOG
                ? "Square catalog sync failed"
                : nextJob.type === JobType.SYNC_SALES
                ? "Square sales sync failed"
                : "Website order preparation failed",
            message: errorMessage,
            metadata: {
              jobId: nextJob.id,
              jobType: nextJob.type,
            },
          });
        }

        if (nextJob.locationId) {
          await createAuditLogTx(tx, {
            locationId: nextJob.locationId,
            action: "job.failed",
            entityType: "jobRun",
            entityId: nextJob.id,
            details: {
              jobType: nextJob.type,
              error: errorMessage,
            },
          });
        }
      });
    }
  }

  return processed;
}

async function claimNextJob() {
  if (databaseUsesPostgres()) {
    return db.$transaction(async (tx) => {
      const claimed = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `WITH next_job AS (
          SELECT id
          FROM "JobRun"
          WHERE status = CAST($1 AS "JobStatus")
            AND "availableAt" <= NOW()
          ORDER BY "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "JobRun"
        SET status = CAST($2 AS "JobStatus"),
            "lockedAt" = NOW(),
            attempts = attempts + 1,
            "updatedAt" = NOW()
        FROM next_job
        WHERE "JobRun".id = next_job.id
        RETURNING "JobRun".id`,
        JobStatus.PENDING,
        JobStatus.RUNNING
      );

      if (!claimed[0]?.id) {
        return null;
      }

      return tx.jobRun.findUnique({
        where: {
          id: claimed[0].id,
        },
      });
    });
  }

  const now = new Date();
  const nextJob = await db.jobRun.findFirst({
    where: {
      status: JobStatus.PENDING,
      availableAt: {
        lte: now,
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (!nextJob) {
    return null;
  }

  const claim = await db.jobRun.updateMany({
    where: {
      id: nextJob.id,
      status: JobStatus.PENDING,
      availableAt: {
        lte: now,
      },
    },
    data: {
      status: JobStatus.RUNNING,
      lockedAt: now,
      attempts: {
        increment: 1,
      },
    },
  });

  if (claim.count === 0) {
    return null;
  }

  return db.jobRun.findUnique({
    where: {
      id: nextJob.id,
    },
  });
}

function readPayloadString(payload: Prisma.JsonValue | null, key: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

