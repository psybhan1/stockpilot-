import type { Prisma } from "@/lib/prisma";

export async function createAuditLogTx(
  tx: Prisma.TransactionClient,
  input: {
    locationId?: string | null;
    userId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    details?: Prisma.InputJsonValue;
  }
) {
  await tx.auditLog.create({
    data: {
      locationId: input.locationId ?? undefined,
      userId: input.userId ?? undefined,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      details: input.details,
    },
  });
}

