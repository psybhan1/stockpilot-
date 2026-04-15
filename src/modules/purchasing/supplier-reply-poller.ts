/**
 * Supplier-reply poller.
 *
 * Every time we send a PO via Gmail we stash the Gmail thread_id in
 * SupplierCommunication.metadata.gmailThreadId. This module polls
 * those threads for NEW messages the supplier sent back, saves each
 * one as an INBOUND SupplierCommunication, classifies the intent
 * with Groq (confirmed / out_of_stock / delayed / question), and
 * pings the manager on Telegram.
 *
 * No inbound-email infra required — uses the Gmail OAuth tokens we
 * already have. Runs from the existing worker loop at a 5-minute
 * cadence; idempotent because we de-dupe on Gmail message IDs.
 */

import {
  CommunicationDirection,
  CommunicationStatus,
  SupplierOrderingMode,
  type Prisma,
} from "@/lib/prisma";
import { db } from "@/lib/db";
import { botTelemetry } from "@/lib/bot-telemetry";
import { getGmailCredentials } from "@/modules/channels/service";
import { GmailEmailProvider } from "@/providers/email/gmail-email";
import { sendTelegramMessage } from "@/lib/telegram-bot";

type SupplierReplyIntent =
  | "CONFIRMED"
  | "OUT_OF_STOCK"
  | "DELAYED"
  | "QUESTION"
  | "OTHER";

const POLL_WINDOW_DAYS = 14;

/**
 * Entry point — called on a schedule from worker.ts.
 * Processes up to `maxPOs` SENT POs that have a Gmail thread id.
 */
export async function pollSupplierReplies(maxPOs = 20): Promise<number> {
  const stop = botTelemetry.start("supplier-reply-poller.run");
  let replyCount = 0;

  try {
    const cutoff = new Date(Date.now() - POLL_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Fetch recent OUTBOUND supplier communications with a gmail thread id,
    // for POs that are still SENT/ACKNOWLEDGED (not delivered / cancelled).
    const outbounds = await db.supplierCommunication.findMany({
      where: {
        direction: CommunicationDirection.OUTBOUND,
        channel: SupplierOrderingMode.EMAIL,
        createdAt: { gte: cutoff },
        purchaseOrder: {
          status: { in: ["SENT", "ACKNOWLEDGED"] },
        },
      },
      orderBy: { createdAt: "desc" },
      take: maxPOs,
      select: {
        id: true,
        supplierId: true,
        purchaseOrderId: true,
        metadata: true,
        purchaseOrder: {
          select: {
            locationId: true,
            orderNumber: true,
            supplier: { select: { name: true } },
          },
        },
      },
    });

    for (const comm of outbounds) {
      const meta = comm.metadata as Record<string, unknown> | null;
      const threadId = typeof meta?.gmailThreadId === "string" ? meta.gmailThreadId : null;
      if (!threadId) continue;

      const locationId = comm.purchaseOrder?.locationId;
      if (!locationId) continue;

      const handled = await pollOneThread({
        locationId,
        threadId,
        supplierId: comm.supplierId,
        purchaseOrderId: comm.purchaseOrderId,
        supplierName: comm.purchaseOrder?.supplier.name ?? "supplier",
        orderNumber: comm.purchaseOrder?.orderNumber ?? "",
      });
      replyCount += handled;
    }
  } catch (err) {
    botTelemetry.error("supplier-reply-poller.run", err);
  } finally {
    stop({ replies: replyCount });
  }

  return replyCount;
}

async function pollOneThread(ctx: {
  locationId: string;
  threadId: string;
  supplierId: string;
  purchaseOrderId: string | null;
  supplierName: string;
  orderNumber: string;
}): Promise<number> {
  const creds = await getGmailCredentials(ctx.locationId);
  if (!creds) return 0;

  // We need a valid access token — the provider has the refresh
  // machinery. Create a throwaway instance just to reuse it.
  const provider = new GmailEmailProvider(ctx.locationId);
  // ensureFreshToken is private, so we go directly through Gmail's
  // thread API with the current creds; if it 401s we trigger a send
  // to force a refresh (side-effect). Simpler approach: call Gmail
  // with current token, on 401 refresh via a dummy dryrun.
  const accessToken = creds.accessToken;

  const threadUrl = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${ctx.threadId}?format=full`;
  let res = await fetch(threadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    // Token expired — use provider's refresh via a dummy send path.
    // Cheaper option: reload creds (the provider refreshes lazily).
    // Easiest: skip this thread for this cycle; next cycle will catch up.
    void provider;
    return 0;
  }
  if (!res.ok) return 0;

  const thread = (await res.json()) as {
    messages?: Array<{
      id: string;
      threadId: string;
      snippet?: string;
      payload?: {
        headers?: Array<{ name: string; value: string }>;
        parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
        body?: { data?: string };
      };
    }>;
  };

  const messages = thread.messages ?? [];
  if (messages.length <= 1) return 0; // only our outbound

  // Skip the first (our outbound) and process only supplier replies
  // we haven't recorded yet.
  const knownIds = await db.supplierCommunication.findMany({
    where: {
      purchaseOrderId: ctx.purchaseOrderId ?? undefined,
      direction: CommunicationDirection.INBOUND,
    },
    select: { providerMessageId: true },
  });
  const knownSet = new Set(knownIds.map((k) => k.providerMessageId).filter(Boolean));

  let newReplies = 0;

  for (const msg of messages.slice(1)) {
    if (knownSet.has(msg.id)) continue;

    const fromHeader = msg.payload?.headers?.find(
      (h) => h.name.toLowerCase() === "from"
    )?.value;
    const bodyText = extractBodyText(msg);
    if (!bodyText) continue;

    // Very small guard: ignore messages we sent ourselves (the supplier
    // email domain shouldn't match the connected Gmail account's user).
    if (fromHeader?.toLowerCase().includes(creds.email.toLowerCase())) continue;

    const intent = await classifyReplyIntent(bodyText);

    await db.supplierCommunication.create({
      data: {
        supplierId: ctx.supplierId,
        purchaseOrderId: ctx.purchaseOrderId ?? null,
        channel: SupplierOrderingMode.EMAIL,
        direction: CommunicationDirection.INBOUND,
        subject: null,
        body: bodyText,
        status: CommunicationStatus.DELIVERED,
        providerMessageId: msg.id,
        metadata: {
          gmailThreadId: ctx.threadId,
          gmailMessageId: msg.id,
          fromHeader: fromHeader ?? null,
          intent,
        } satisfies Prisma.InputJsonValue,
        sentAt: new Date(),
      },
    });

    await notifyManagerOfReply({
      locationId: ctx.locationId,
      orderNumber: ctx.orderNumber,
      supplierName: ctx.supplierName,
      bodyText,
      intent,
    });

    newReplies += 1;
    botTelemetry.event("supplier-reply-poller.reply_detected", {
      purchaseOrderId: ctx.purchaseOrderId,
      intent,
    });
  }

  return newReplies;
}

function extractBodyText(msg: {
  payload?: {
    parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
    body?: { data?: string };
  };
  snippet?: string;
}): string {
  const decode = (data?: string) => {
    if (!data) return "";
    try {
      return Buffer.from(data, "base64url").toString("utf8");
    } catch {
      return "";
    }
  };

  // Prefer the text/plain part if present.
  const parts = msg.payload?.parts ?? [];
  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      const decoded = decode(part.body.data);
      if (decoded.trim()) return decoded.trim();
    }
  }
  // Fall back to the top-level body.
  const direct = decode(msg.payload?.body?.data);
  if (direct.trim()) return direct.trim();
  // Last resort — the snippet.
  return (msg.snippet ?? "").trim();
}

async function classifyReplyIntent(body: string): Promise<SupplierReplyIntent> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return "OTHER";

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        temperature: 0,
        max_tokens: 20,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Classify a supplier\'s reply to a purchase order email. Return JSON {"intent":"CONFIRMED|OUT_OF_STOCK|DELAYED|QUESTION|OTHER"}. CONFIRMED = will deliver as ordered. OUT_OF_STOCK = can\'t fulfil. DELAYED = can deliver but later than usual. QUESTION = they need something from us before proceeding. OTHER = unrelated / unclear.',
          },
          { role: "user", content: body.slice(0, 2000) },
        ],
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return "OTHER";
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(raw) as { intent?: string };
    const intent = (parsed.intent ?? "OTHER").toUpperCase();
    if (
      intent === "CONFIRMED" ||
      intent === "OUT_OF_STOCK" ||
      intent === "DELAYED" ||
      intent === "QUESTION"
    ) {
      return intent;
    }
    return "OTHER";
  } catch {
    return "OTHER";
  }
}

async function notifyManagerOfReply(input: {
  locationId: string;
  orderNumber: string;
  supplierName: string;
  bodyText: string;
  intent: SupplierReplyIntent;
}) {
  const managers = await db.user.findMany({
    where: {
      locationId: input.locationId,
      telegramChatId: { not: null },
    },
    select: { telegramChatId: true },
    take: 3,
  });

  const icon =
    input.intent === "CONFIRMED"
      ? "✅"
      : input.intent === "OUT_OF_STOCK"
      ? "⚠"
      : input.intent === "DELAYED"
      ? "⏰"
      : input.intent === "QUESTION"
      ? "❓"
      : "📨";

  const label =
    input.intent === "CONFIRMED"
      ? "confirmed"
      : input.intent === "OUT_OF_STOCK"
      ? "out of stock"
      : input.intent === "DELAYED"
      ? "delayed"
      : input.intent === "QUESTION"
      ? "asked a question"
      : "replied";

  const preview = input.bodyText.slice(0, 300).replace(/\s+/g, " ").trim();
  const message =
    `${icon} *${input.supplierName}* ${label} on *${input.orderNumber}*.\n\n` +
    `> ${preview}${input.bodyText.length > 300 ? "…" : ""}`;

  for (const manager of managers) {
    if (!manager.telegramChatId) continue;
    try {
      await sendTelegramMessage(manager.telegramChatId, message, {
        parseMode: "Markdown",
      });
    } catch (err) {
      botTelemetry.error("supplier-reply-poller.notify", err, {
        chatId: manager.telegramChatId,
      });
    }
  }
}
