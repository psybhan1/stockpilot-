import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import {
  CommunicationDirection,
  CommunicationStatus,
  SupplierOrderingMode,
  type Prisma,
} from "@/lib/prisma";
import { botTelemetry } from "@/lib/bot-telemetry";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { parsePurchaseOrderIdFromReplyAddress } from "@/modules/purchasing/reply-address";
import {
  classifyReplyIntent,
  extractPriceSignal,
  notifyManagerOfReply,
} from "@/modules/purchasing/supplier-reply-poller";

/**
 * Inbound supplier-reply webhook.
 *
 * This is the replacement for the gmail.readonly thread poller. We
 * dropped gmail.readonly from the OAuth scopes so any café owner
 * can log in with Gmail without Google's CASA security assessment
 * (~$4-15k, months). Replies now flow through this endpoint instead:
 *
 *   1. Outbound POs set Reply-To: reply+<poId>@<REPLY_DOMAIN>.
 *   2. REPLY_DOMAIN's MX/DNS points at an inbound-email service
 *      (Resend / Postmark / Mailgun / SendGrid / n8n).
 *   3. When a supplier replies, that service POSTs the message here
 *      as JSON.
 *   4. We parse the recipient to recover the PO id, log an INBOUND
 *      SupplierCommunication, classify intent via Groq, and ping
 *      the manager on Telegram — same UX as the old poller, just
 *      triggered by a push instead of a 5-minute pull.
 *
 * Authentication: a shared secret. Every inbound provider supports
 * either a header or basic-auth for this. The client MUST send
 * `Authorization: Bearer <INBOUND_EMAIL_SECRET>` OR
 * `X-Inbound-Secret: <INBOUND_EMAIL_SECRET>`.
 *
 * Payload shape — we accept the fields most inbound providers send.
 * Missing fields are tolerated (empty strings default). Unknown
 * fields are ignored.
 *   {
 *     "to":      "reply+cm123@reply.stockpilot.app",
 *     "from":    "maria@sysco.example",
 *     "subject": "Re: PO PO-1042",
 *     "text":    "Confirmed for Friday delivery.",
 *     "html":    "<p>…</p>",         // optional
 *     "messageId": "<abc@mail.supplier.com>"  // optional, dedup key
 *   }
 */

type InboundPayload = {
  to?: string;
  recipient?: string;
  from?: string;
  sender?: string;
  subject?: string;
  text?: string;
  body?: string;
  html?: string;
  messageId?: string;
  "Message-Id"?: string;
  // Resend wraps in { data: {...} } for webhooks.
  data?: InboundPayload;
};

function pickString(...candidates: Array<string | undefined | null>) {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!env.INBOUND_EMAIL_SECRET) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Inbound email endpoint is not configured. Set INBOUND_EMAIL_SECRET on the server.",
      },
      { status: 503 }
    );
  }

  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const header = req.headers.get("x-inbound-secret");
  const provided = (bearer || header || "").trim();

  if (!provided || !safeEqual(provided, env.INBOUND_EMAIL_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let raw: InboundPayload = {};
  try {
    raw = (await req.json()) as InboundPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const payload = raw.data && typeof raw.data === "object" ? raw.data : raw;

  const recipient = pickString(payload.to, payload.recipient);
  const fromHeader = pickString(payload.from, payload.sender);
  const subject = pickString(payload.subject);
  const bodyText = pickString(payload.text, payload.body);
  const messageId = pickString(payload.messageId, payload["Message-Id"]);

  const purchaseOrderId = parsePurchaseOrderIdFromReplyAddress(recipient);

  if (!purchaseOrderId) {
    botTelemetry.event("inbound-email.unrecognized_recipient", {
      recipient: recipient?.slice(0, 80) ?? null,
    });
    // Return 200 so the inbound provider doesn't retry forever for
    // mail we can't attribute. The message is just dropped.
    return NextResponse.json({ ok: true, attributed: false });
  }

  const po = await db.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      id: true,
      orderNumber: true,
      locationId: true,
      supplierId: true,
      supplier: { select: { name: true } },
    },
  });

  if (!po) {
    botTelemetry.event("inbound-email.unknown_purchase_order", { purchaseOrderId });
    return NextResponse.json({ ok: true, attributed: false });
  }

  // Drop bounce / autoresponder noise — same blocklist the Gmail
  // poller uses so manager inbox stays clean.
  const fromLower = (fromHeader ?? "").toLowerCase();
  if (
    fromLower.includes("mailer-daemon") ||
    fromLower.includes("postmaster") ||
    fromLower.includes("mail delivery") ||
    fromLower.includes("noreply") ||
    fromLower.includes("no-reply")
  ) {
    return NextResponse.json({ ok: true, attributed: false, reason: "bounce" });
  }

  // Dedup on provider Message-Id when available. Without one we fall
  // back to a best-effort unique key so retries from the inbound
  // provider don't create double rows.
  const dedupKey =
    messageId ??
    `inbound-${purchaseOrderId}-${Buffer.from((bodyText ?? "").slice(0, 120))
      .toString("base64")
      .slice(0, 40)}`;

  const existing = await db.supplierCommunication.findFirst({
    where: {
      purchaseOrderId,
      direction: CommunicationDirection.INBOUND,
      providerMessageId: dedupKey,
    },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ ok: true, attributed: true, duplicate: true });
  }

  const effectiveBody = bodyText ?? subject ?? "";
  const intent = effectiveBody
    ? await classifyReplyIntent(effectiveBody)
    : "OTHER";
  const priceSignal = effectiveBody
    ? await extractPriceSignal(effectiveBody).catch(() => null)
    : null;

  await db.supplierCommunication.create({
    data: {
      supplierId: po.supplierId,
      purchaseOrderId: po.id,
      channel: SupplierOrderingMode.EMAIL,
      direction: CommunicationDirection.INBOUND,
      subject: subject ?? null,
      body: effectiveBody,
      status: CommunicationStatus.SENT,
      providerMessageId: dedupKey,
      metadata: {
        inboundWebhook: true,
        fromHeader: fromHeader ?? null,
        messageId: messageId ?? null,
        intent,
        ...(priceSignal ? { priceSignal } : {}),
      } satisfies Prisma.InputJsonValue,
      sentAt: new Date(),
    },
  });

  await notifyManagerOfReply({
    locationId: po.locationId,
    orderNumber: po.orderNumber,
    supplierName: po.supplier.name,
    purchaseOrderId: po.id,
    bodyText: effectiveBody,
    intent,
    priceSignal,
  });

  botTelemetry.event("inbound-email.reply_detected", {
    purchaseOrderId: po.id,
    intent,
  });

  return NextResponse.json({ ok: true, attributed: true, intent });
}

// GET is useful for the inbound provider's URL-verification flow
// (some providers ping the endpoint before enabling the webhook).
export function GET() {
  return NextResponse.json({
    ok: true,
    ready: Boolean(env.INBOUND_EMAIL_SECRET && env.REPLY_DOMAIN),
    replyDomainConfigured: Boolean(env.REPLY_DOMAIN),
  });
}
