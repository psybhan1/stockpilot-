/**
 * One-shot Gmail thread-id backfill for SupplierCommunication rows
 * sent before we started persisting threadId on send.
 *
 * For each OUTBOUND email comm whose metadata is missing
 * gmailThreadId, we search the connected Gmail mailbox for a sent
 * message matching the PO's subject ("Purchase order <PO-NUMBER>" or
 * "Purchase Order <PO-NUMBER>"). The first match wins — Gmail
 * returns its threadId which we stamp onto the comm so the reply
 * poller can pick up supplier responses on those threads.
 *
 * Idempotent: rows already carrying gmailThreadId are skipped, so
 * this can run on every boot without doing extra work.
 */

import {
  CommunicationDirection,
  SupplierOrderingMode,
  type Prisma,
} from "@/lib/prisma";
import { db } from "@/lib/db";
import { botTelemetry } from "@/lib/bot-telemetry";
import { getGmailCredentials } from "@/modules/channels/service";

const SEARCH_WINDOW_DAYS = 30;

export async function backfillGmailThreadIds(maxRows = 100): Promise<{
  scanned: number;
  matched: number;
  skipped: number;
}> {
  const stop = botTelemetry.start("gmail-thread-backfill.run");
  let scanned = 0;
  let matched = 0;
  let skipped = 0;

  try {
    const cutoff = new Date(
      Date.now() - SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000
    );

    const candidates = await db.supplierCommunication.findMany({
      where: {
        direction: CommunicationDirection.OUTBOUND,
        channel: SupplierOrderingMode.EMAIL,
        createdAt: { gte: cutoff },
        purchaseOrder: {
          status: { in: ["SENT", "ACKNOWLEDGED", "DELIVERED"] },
        },
      },
      orderBy: { createdAt: "desc" },
      take: maxRows,
      select: {
        id: true,
        metadata: true,
        purchaseOrder: {
          select: { locationId: true, orderNumber: true },
        },
      },
    });

    for (const comm of candidates) {
      scanned += 1;
      const meta = (comm.metadata ?? {}) as Record<string, unknown>;
      if (typeof meta.gmailThreadId === "string" && meta.gmailThreadId.length > 0) {
        skipped += 1;
        continue;
      }
      const locationId = comm.purchaseOrder?.locationId;
      const orderNumber = comm.purchaseOrder?.orderNumber;
      if (!locationId || !orderNumber) {
        skipped += 1;
        continue;
      }

      const creds = await getGmailCredentials(locationId);
      if (!creds) {
        skipped += 1;
        continue;
      }

      // Gmail search supports "subject:" with quoted strings. We
      // include both casings of "Purchase Order" plus a bare
      // PO-number search so any of our historical templates match.
      const query = `(subject:"${orderNumber}") in:sent`;
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=${encodeURIComponent(
        query
      )}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
      });
      if (!res.ok) {
        // 401 → token expired; let the next regular send refresh it.
        // 4xx/5xx → just move on, don't crash the boot.
        skipped += 1;
        continue;
      }
      const body = (await res.json()) as {
        messages?: Array<{ id: string; threadId: string }>;
      };
      const first = body.messages?.[0];
      if (!first) {
        skipped += 1;
        continue;
      }

      await db.supplierCommunication.update({
        where: { id: comm.id },
        data: {
          metadata: {
            ...meta,
            gmailThreadId: first.threadId,
            gmailMessageId: first.id,
            backfilledAt: new Date().toISOString(),
          } satisfies Prisma.InputJsonValue,
        },
      });
      matched += 1;
      botTelemetry.event("gmail-thread-backfill.matched", {
        purchaseOrderNumber: orderNumber,
        threadId: first.threadId,
      });
    }
  } catch (err) {
    botTelemetry.error("gmail-thread-backfill.run", err);
  } finally {
    stop({ scanned, matched, skipped });
  }

  return { scanned, matched, skipped };
}
