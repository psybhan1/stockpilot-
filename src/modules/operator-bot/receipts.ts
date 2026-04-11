import { BotChannel, Prisma } from "@/lib/prisma";

import { db } from "@/lib/db";

type ReceiptDuplicateResult = {
  kind: "duplicate";
  reply: string | null;
  purchaseOrderId?: string | null;
  orderNumber?: string | null;
  metadata?: Prisma.JsonValue | null;
  skipSend: boolean;
};

type ReceiptReservedResult =
  | {
      kind: "new";
      receiptId: string;
    }
  | ReceiptDuplicateResult
  | {
      kind: "none";
      receiptId: null;
    };

export async function reserveBotMessageReceipt(input: {
  channel: BotChannel;
  externalMessageId?: string | null;
  senderId: string;
  senderDisplayName?: string | null;
  inboundText: string;
  rawPayload?: Prisma.InputJsonValue;
  locationId?: string | null;
  userId?: string | null;
}) : Promise<ReceiptReservedResult> {
  const externalMessageId = input.externalMessageId?.trim();

  if (!externalMessageId) {
    return {
      kind: "none",
      receiptId: null,
    };
  }

  try {
    const receipt = await db.botMessageReceipt.create({
      data: {
        channel: input.channel,
        externalMessageId,
        senderId: input.senderId,
        senderDisplayName: input.senderDisplayName ?? null,
        inboundText: input.inboundText,
        rawPayload: input.rawPayload ?? undefined,
        locationId: input.locationId ?? null,
        userId: input.userId ?? null,
      },
      select: {
        id: true,
      },
    });

    return {
      kind: "new",
      receiptId: receipt.id,
    };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }

    const existing = await db.botMessageReceipt.findUnique({
      where: {
        channel_externalMessageId: {
          channel: input.channel,
          externalMessageId,
        },
      },
      select: {
        replyText: true,
        purchaseOrderId: true,
        orderNumber: true,
        status: true,
        metadata: true,
      },
    });

    return {
      kind: "duplicate",
      reply: existing?.replyText ?? null,
      purchaseOrderId: existing?.purchaseOrderId ?? null,
      orderNumber: existing?.orderNumber ?? null,
      metadata: existing?.metadata ?? null,
      skipSend: !existing?.replyText || existing.status === "RECEIVED",
    };
  }
}

export async function completeBotMessageReceipt(input: {
  receiptId?: string | null;
  locationId?: string | null;
  userId?: string | null;
  reply: string | null;
  purchaseOrderId?: string | null;
  orderNumber?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  if (!input.receiptId) {
    return;
  }

  await db.botMessageReceipt.update({
    where: {
      id: input.receiptId,
    },
    data: {
      locationId: input.locationId ?? undefined,
      userId: input.userId ?? undefined,
      replyText: input.reply,
      purchaseOrderId: input.purchaseOrderId ?? null,
      orderNumber: input.orderNumber ?? null,
      metadata: input.metadata ?? undefined,
      status: "COMPLETED",
      processedAt: new Date(),
    },
  });
}

export async function failBotMessageReceipt(input: {
  receiptId?: string | null;
  locationId?: string | null;
  userId?: string | null;
  reply?: string | null;
  errorMessage: string;
  metadata?: Prisma.InputJsonValue;
}) {
  if (!input.receiptId) {
    return;
  }

  await db.botMessageReceipt.update({
    where: {
      id: input.receiptId,
    },
    data: {
      locationId: input.locationId ?? undefined,
      userId: input.userId ?? undefined,
      replyText: input.reply ?? null,
      metadata: toInputJsonValue(
        mergeReceiptMetadata(
        {
          error: input.errorMessage,
        },
        input.metadata
        )
      ),
      status: "FAILED",
      processedAt: new Date(),
    },
  });
}

function mergeReceiptMetadata(
  base: Record<string, unknown>,
  extra: Prisma.InputJsonValue | undefined
) {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) {
    return base;
  }

  return {
    ...extra,
    ...base,
  };
}

function toInputJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
