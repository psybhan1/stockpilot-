import { createHash, createHmac, randomBytes } from "node:crypto";

import { createAuditLogTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { BotChannel } from "@/lib/prisma";
import type { Prisma } from "@/lib/prisma";
import {
  buildTelegramConnectUrl as buildTelegramConnectUrlPrimitive,
  buildWhatsAppConnectUrl as buildWhatsAppConnectUrlPrimitive,
  isPublicAppUrl as isPublicAppUrlPrimitive,
  isTwilioSandboxSender as isTwilioSandboxSenderPrimitive,
  readConnectTokenFromText as readConnectTokenFromTextPrimitive,
} from "@/modules/operator-bot/connect-primitives";
import {
  completeBotMessageReceipt,
  failBotMessageReceipt,
  reserveBotMessageReceipt,
} from "@/modules/operator-bot/receipts";

const BOT_CONNECT_TTL_MINUTES = 15;

export type BotConnectStatus = {
  ok: boolean;
  status: "connected" | "expired" | "invalid" | "conflict";
  reply: string;
  skipSend?: boolean;
};

export async function createBotConnectRequest(input: {
  userId: string;
  locationId: string;
  channel: BotChannel;
}) {
  const token = randomBytes(12).toString("base64url");
  const expiresAt = new Date(Date.now() + BOT_CONNECT_TTL_MINUTES * 60 * 1000);

  await db.$transaction(async (tx) => {
    await tx.botConnectRequest.updateMany({
      where: {
        userId: input.userId,
        channel: input.channel,
        consumedAt: null,
      },
      data: {
        consumedAt: new Date(),
      },
    });

    await tx.botConnectRequest.create({
      data: {
        userId: input.userId,
        locationId: input.locationId,
        channel: input.channel,
        tokenHash: hashConnectToken(token),
        expiresAt,
      },
    });

    await createAuditLogTx(tx, {
      locationId: input.locationId,
      userId: input.userId,
      action: "bot.connect_issued",
      entityType: "user",
      entityId: input.userId,
      details: {
        channel: input.channel,
        expiresAt: expiresAt.toISOString(),
      },
    });
  });

  return {
    token,
    expiresAt,
  };
}

export async function connectManagerBotChannel(input: {
  channel: BotChannel;
  token: string;
  senderId: string;
  senderDisplayName?: string | null;
  telegramUsername?: string | null;
  sourceMessageId?: string | null;
  inboundText?: string | null;
}): Promise<BotConnectStatus> {
  const normalizedSenderId =
    input.channel === BotChannel.WHATSAPP
      ? normalizePhoneNumber(input.senderId)
      : normalizeTelegramChatId(input.senderId);
  const receipt = await reserveBotMessageReceipt({
    channel: input.channel,
    externalMessageId: input.sourceMessageId ?? null,
    senderId: normalizedSenderId ?? input.senderId,
    senderDisplayName: input.senderDisplayName ?? null,
    inboundText:
      input.inboundText?.trim() ||
      (input.channel === BotChannel.TELEGRAM ? "/start connect" : "connect"),
  });
  const receiptId = receipt.kind === "new" ? receipt.receiptId : null;

  if (receipt.kind === "duplicate") {
    const status = readConnectStatus(receipt.metadata);

    return {
      ok: status === "connected",
      status,
      reply: receipt.reply ?? "",
      skipSend: receipt.skipSend,
    };
  }

  if (!normalizedSenderId) {
    const reply =
      input.channel === BotChannel.WHATSAPP
        ? "⚠️ Something went wrong reading your WhatsApp number. Open StockPilot and tap Connect WhatsApp again."
        : "⚠️ Something went wrong reading your Telegram chat. Open StockPilot and tap Connect Telegram again.";

    await recordConnectAttempt(input, "invalid", {
      senderId: input.senderId,
      detail: "Unreadable sender id.",
    });
    await completeBotMessageReceipt({
      receiptId,
      reply,
      metadata: {
        channel: input.channel,
        connectStatus: "invalid",
      },
    });

    return {
      ok: false,
      status: "invalid",
      reply,
    };
  }

  const request = await db.botConnectRequest.findFirst({
    where: {
      channel: input.channel,
      tokenHash: hashConnectToken(input.token),
      consumedAt: null,
    },
    include: {
      user: true,
    },
  });

  if (!request) {
    const reply = "❌ This link is no longer valid. Open StockPilot → Settings and tap Connect again to get a fresh one.";

    await recordConnectAttempt(input, "invalid", {
      senderId: normalizedSenderId,
      detail: "Connect token not found.",
    });
    await completeBotMessageReceipt({
      receiptId,
      reply,
      metadata: {
        channel: input.channel,
        connectStatus: "invalid",
      },
    });

    return {
      ok: false,
      status: "invalid",
      reply,
    };
  }

  if (request.expiresAt <= new Date()) {
    const reply =
      "⏱️ This link has expired. Open StockPilot → Settings and tap Connect again to get a fresh one.";

    await db.botConnectRequest.update({
      where: {
        id: request.id,
      },
      data: {
        consumedAt: new Date(),
      },
    });

    await recordConnectAttempt(input, "expired", {
      locationId: request.locationId,
      userId: request.userId,
      senderId: normalizedSenderId,
      detail: "Connect token expired.",
    });
    await completeBotMessageReceipt({
      receiptId,
      locationId: request.locationId,
      userId: request.userId,
      reply,
      metadata: {
        channel: input.channel,
        connectStatus: "expired",
      },
    });

    return {
      ok: false,
      status: "expired",
      reply,
    };
  }

  const conflict =
    input.channel === BotChannel.WHATSAPP
      ? await db.user.findFirst({
          where: {
            id: {
              not: request.userId,
            },
            phoneNumber: normalizedSenderId,
          },
          select: {
            id: true,
          },
        })
      : await db.user.findFirst({
          where: {
            id: {
              not: request.userId,
            },
            telegramChatId: normalizedSenderId,
          },
          select: {
            id: true,
          },
        });

  if (conflict) {
    const reply =
      input.channel === BotChannel.WHATSAPP
        ? "⚠️ This WhatsApp number is already linked to another StockPilot account. Contact your admin if this is a mistake."
        : "⚠️ This Telegram account is already linked to another StockPilot account. Contact your admin if this is a mistake.";

    await recordConnectAttempt(input, "conflict", {
      locationId: request.locationId,
      userId: request.userId,
      senderId: normalizedSenderId,
      detail: "Sender already linked to another user.",
    });
    await completeBotMessageReceipt({
      receiptId,
      locationId: request.locationId,
      userId: request.userId,
      reply,
      metadata: {
        channel: input.channel,
        connectStatus: "conflict",
      },
    });

    return {
      ok: false,
      status: "conflict",
      reply,
    };
  }

  const normalizedTelegramUsername = normalizeTelegramUsername(input.telegramUsername ?? null);
  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: {
          id: request.userId,
        },
        data:
          input.channel === BotChannel.WHATSAPP
            ? {
                phoneNumber: normalizedSenderId,
              }
            : {
                telegramChatId: normalizedSenderId,
                telegramUsername: normalizedTelegramUsername,
              },
      });

      await tx.botConnectRequest.update({
        where: {
          id: request.id,
        },
        data: {
          consumedAt: new Date(),
        },
      });

      await createAuditLogTx(tx, {
        locationId: request.locationId,
        userId: request.userId,
        action: "bot.connect_succeeded",
        entityType: "user",
        entityId: request.userId,
        details: {
          channel: input.channel,
          senderId: normalizedSenderId,
          senderDisplayName: input.senderDisplayName ?? null,
          telegramUsername: normalizedTelegramUsername,
        },
      });

      if (input.sourceMessageId) {
        await createAuditLogTx(tx, {
          locationId: request.locationId,
          userId: request.userId,
          action: "bot.connect_processed",
          entityType: "botChannel",
          entityId: input.sourceMessageId,
          details: {
            channel: input.channel,
            senderId: normalizedSenderId,
          },
        });
      }
    });

    const reply =
      input.channel === BotChannel.WHATSAPP
        ? `✅ You're all set, ${request.user.name}! WhatsApp is now linked to StockPilot.\n\nYou'll receive stock alerts here. You can also send messages like:\n• "Whole milk — 2 left, order more"\n• "Order 5 cases of olive oil"`
        : `✅ You're all set, ${request.user.name}! Telegram is now linked to StockPilot.\n\nYou'll receive stock alerts here. You can also send messages like:\n• "Whole milk — 2 left, order more"\n• "Order 5 cases of olive oil"`;

    await completeBotMessageReceipt({
      receiptId,
      locationId: request.locationId,
      userId: request.userId,
      reply,
      metadata: {
        channel: input.channel,
        connectStatus: "connected",
        senderId: normalizedSenderId,
        telegramUsername: normalizedTelegramUsername,
      },
    });

    return {
      ok: true,
      status: "connected",
      reply,
    };
  } catch (error) {
    await failBotMessageReceipt({
      receiptId,
      locationId: request.locationId,
      userId: request.userId,
      errorMessage: error instanceof Error ? error.message : "Unknown connect failure",
      metadata: {
        channel: input.channel,
        connectStatus: "invalid",
      },
    });

    throw error;
  }
}

export async function connectManagerTelegramLoginChannel(input: {
  token: string;
  telegramUserId: string;
  telegramUsername?: string | null;
  senderDisplayName?: string | null;
}): Promise<BotConnectStatus> {
  const normalizedSenderId = normalizeTelegramChatId(input.telegramUserId);

  if (!normalizedSenderId) {
    await recordConnectAttempt(
      {
        channel: BotChannel.TELEGRAM,
      },
      "invalid",
      {
        senderId: input.telegramUserId,
        detail: "Unreadable Telegram user id from login flow.",
      }
    );

    return {
      ok: false,
      status: "invalid",
      reply: "Telegram login returned an unreadable account id. Please try again.",
    };
  }

  const request = await db.botConnectRequest.findFirst({
    where: {
      channel: BotChannel.TELEGRAM,
      tokenHash: hashConnectToken(input.token),
      consumedAt: null,
    },
    include: {
      user: true,
    },
  });

  if (!request) {
    await recordConnectAttempt(
      {
        channel: BotChannel.TELEGRAM,
      },
      "invalid",
      {
        senderId: normalizedSenderId,
        detail: "Telegram login state token not found.",
      }
    );

    return {
      ok: false,
      status: "invalid",
      reply: "This Telegram connect link is no longer valid. Open StockPilot and try again.",
    };
  }

  if (request.expiresAt <= new Date()) {
    await db.botConnectRequest.update({
      where: {
        id: request.id,
      },
      data: {
        consumedAt: new Date(),
      },
    });

    await recordConnectAttempt(
      {
        channel: BotChannel.TELEGRAM,
      },
      "expired",
      {
        locationId: request.locationId,
        userId: request.userId,
        senderId: normalizedSenderId,
        detail: "Telegram one-tap connect token expired.",
      }
    );

    return {
      ok: false,
      status: "expired",
      reply: "This Telegram connect link expired. Open StockPilot and try again for a fresh link.",
    };
  }

  const conflict = await db.user.findFirst({
    where: {
      id: {
        not: request.userId,
      },
      telegramChatId: normalizedSenderId,
    },
    select: {
      id: true,
    },
  });

  if (conflict) {
    await recordConnectAttempt(
      {
        channel: BotChannel.TELEGRAM,
      },
      "conflict",
      {
        locationId: request.locationId,
        userId: request.userId,
        senderId: normalizedSenderId,
        detail: "Telegram login account is already linked to another user.",
      }
    );

    return {
      ok: false,
      status: "conflict",
      reply: "That Telegram account is already linked to another StockPilot manager.",
    };
  }

  const normalizedTelegramUsername = normalizeTelegramUsername(input.telegramUsername ?? null);

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: {
        id: request.userId,
      },
      data: {
        telegramChatId: normalizedSenderId,
        telegramUsername: normalizedTelegramUsername,
      },
    });

    await tx.botConnectRequest.update({
      where: {
        id: request.id,
      },
      data: {
        consumedAt: new Date(),
      },
    });

    await createAuditLogTx(tx, {
      locationId: request.locationId,
      userId: request.userId,
      action: "bot.connect_succeeded",
      entityType: "user",
      entityId: request.userId,
      details: {
        channel: BotChannel.TELEGRAM,
        senderId: normalizedSenderId,
        senderDisplayName: input.senderDisplayName ?? null,
        telegramUsername: normalizedTelegramUsername,
        method: "telegram_oidc",
      },
    });
  });

  return {
    ok: true,
    status: "connected",
    reply: `Telegram is now connected to StockPilot for ${request.user.name}. You can message things like "Whole milk 2 left, order more."`,
  };
}

export function buildTelegramConnectUrl(botUsername: string, token: string) {
  return buildTelegramConnectUrlPrimitive(botUsername, token);
}

export function buildWhatsAppConnectUrl(senderNumber: string, token: string) {
  return buildWhatsAppConnectUrlPrimitive(senderNumber, token);
}

export function readConnectTokenFromText(input: {
  channel: BotChannel;
  text: string;
}) {
  return readConnectTokenFromTextPrimitive({
    channel: input.channel === BotChannel.TELEGRAM ? "TELEGRAM" : "WHATSAPP",
    text: input.text,
  });
}

export function verifyTelegramWidgetAuth(input: Record<string, string>) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN.");
  }

  const receivedHash = input.hash;

  if (!receivedHash) {
    return false;
  }

  const dataCheckString = Object.entries(input)
    .filter(([key, value]) => key !== "hash" && key !== "connectToken" && value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHash("sha256").update(env.TELEGRAM_BOT_TOKEN).digest();
  const computedHash = createHmac("sha256", secret).update(dataCheckString).digest("hex");

  const authDate = Number(input.auth_date ?? 0);
  const maxAgeSeconds = 15 * 60;
  const isFresh = Number.isFinite(authDate) && Date.now() / 1000 - authDate <= maxAgeSeconds;

  return isFresh && computedHash === receivedHash;
}

export function isPublicAppUrl(url: string) {
  return isPublicAppUrlPrimitive(url);
}

export async function getTelegramBotUsername() {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return null;
  }

  let response: Response;

  try {
    response = await fetch(
      `${env.TELEGRAM_BOT_API_BASE_URL.replace(/\/$/, "")}/bot${env.TELEGRAM_BOT_TOKEN}/getMe`,
      {
        cache: "no-store",
      }
    );
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        ok?: boolean;
        result?: {
          username?: string;
        };
      }
    | null;

  return payload?.ok && payload.result?.username ? payload.result.username : null;
}

function hashConnectToken(token: string) {
  return createHash("sha256").update(`${token}:${env.SESSION_SECRET}`).digest("hex");
}

function normalizePhoneNumber(value: string) {
  const normalized = value.replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");
  if (!normalized) {
    return null;
  }

  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

function normalizeTelegramChatId(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeTelegramUsername(value: string | null) {
  if (!value) {
    return null;
  }

  return value.startsWith("@") ? value : `@${value}`;
}

function readConnectStatus(metadata: Prisma.JsonValue | null | undefined): BotConnectStatus["status"] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "connected";
  }

  const connectStatus = (metadata as Record<string, unknown>).connectStatus;

  if (
    connectStatus === "connected" ||
    connectStatus === "expired" ||
    connectStatus === "invalid" ||
    connectStatus === "conflict"
  ) {
    return connectStatus;
  }

  return "connected";
}

async function recordConnectAttempt(
  input: {
    channel: BotChannel;
    sourceMessageId?: string | null;
  },
  status: BotConnectStatus["status"],
  details: {
    locationId?: string | null;
    userId?: string | null;
    senderId?: string | null;
    detail?: string | null;
  }
) {
  await db.auditLog.create({
    data: {
      locationId: details.locationId ?? undefined,
      userId: details.userId ?? undefined,
      action:
        status === "expired"
          ? "bot.connect_expired"
          : status === "conflict"
            ? "bot.connect_conflict"
            : "bot.connect_invalid",
      entityType: input.sourceMessageId ? "botChannel" : "user",
      entityId:
        input.sourceMessageId ??
        details.userId ??
        details.senderId ??
        `${input.channel.toLowerCase()}-connect`,
      details: {
        channel: input.channel,
        status,
        senderId: details.senderId ?? null,
        detail: details.detail ?? null,
      },
    },
  });
}

export function isTwilioSandboxSender(value: string | null | undefined) {
  return isTwilioSandboxSenderPrimitive(value);
}
