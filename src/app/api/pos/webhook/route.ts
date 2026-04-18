import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import {
  AlertSeverity,
  AlertStatus,
  AlertType,
  MovementType,
  PosProviderType,
  SaleProcessingStatus,
} from "@/lib/prisma";
import type { Prisma } from "@/lib/prisma";
import { botTelemetry } from "@/lib/bot-telemetry";
import { db } from "@/lib/db";
import { postStockMovementTx } from "@/modules/inventory/ledger";

/**
 * Universal POS webhook.
 *
 * Every POS (Toast, Clover, Lightspeed, Shopify, square-via-direct-
 * webhook, anything Zapier can connect to) ingests sales through
 * this endpoint. Native integrations like Square OAuth still use
 * their own path; everything else comes here.
 *
 * Auth: `Authorization: Bearer <secret>` where <secret> is the
 * per-tenant webhook secret stored in PosIntegration.settings.
 * Timing-safe compare, same pattern as /api/inbound/email.
 *
 * Payload (Zapier-friendly minimum viable shape; extra fields are
 * ignored so users can map POS-specific payloads in Zapier without
 * stripping them):
 *   {
 *     "externalOrderId": "square-order-123",   // optional dedup key
 *     "occurredAt": "2026-04-18T18:22:00Z",    // optional
 *     "lineItems": [
 *       {
 *         "externalProductId": "sq-var-latte-16",  // required
 *         "externalProductName": "Large Latte",    // optional (nice for mapping UI)
 *         "quantity": 2,                           // defaults to 1
 *         "unitPriceCents": 560                    // optional (not used for depletion)
 *       }
 *     ]
 *   }
 *
 * For each line:
 *   - Look up PosSimpleMapping (integrationId, externalProductId).
 *   - If mapped, write a POS_DEPLETION stock movement and mark the
 *     sale line processed.
 *   - If not mapped, persist the sale but flag an Alert so the
 *     owner can wire it from /pos-mapping. Future sales of the same
 *     product will get processed once the mapping is saved.
 *
 * Returns `{ ok, processed, unmapped[], depletions }` so Zapier
 * (or any caller) can surface the result to the admin.
 */

type IncomingLineItem = {
  externalProductId?: string;
  external_product_id?: string;
  productId?: string;
  sku?: string;
  externalProductName?: string;
  external_product_name?: string;
  productName?: string;
  name?: string;
  quantity?: number | string;
  qty?: number | string;
  unitPriceCents?: number;
  unit_price_cents?: number;
};

type IncomingPayload = {
  externalOrderId?: string;
  external_order_id?: string;
  orderId?: string;
  occurredAt?: string;
  occurred_at?: string;
  lineItems?: IncomingLineItem[];
  line_items?: IncomingLineItem[];
  items?: IncomingLineItem[];
};

function pickString(
  ...candidates: Array<string | number | undefined | null>
): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
    if (typeof c === "number") return String(c);
  }
  return null;
}

function pickInt(
  value: number | string | undefined,
  fallback: number
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.round(value));
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
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
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const headerSecret = req.headers.get("x-pos-webhook-secret");
  const provided = (bearer || headerSecret || "").trim();

  if (!provided) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Missing credential. Send `Authorization: Bearer <secret>` or `X-POS-Webhook-Secret: <secret>`.",
      },
      { status: 401 }
    );
  }

  // Find the integration whose stored secret matches. We scan every
  // non-SQUARE / non-MANUAL integration; the set is tiny (one row per
  // café) so the full-table scan is effectively O(tenants). Doing it
  // this way means the client never has to identify itself — it just
  // presents the secret and we resolve the tenant from it.
  const integrations = await db.posIntegration.findMany({
    where: {
      provider: {
        notIn: [PosProviderType.SQUARE, PosProviderType.MANUAL],
      },
      status: "CONNECTED",
    },
    select: {
      id: true,
      locationId: true,
      provider: true,
      settings: true,
    },
  });

  let matched: (typeof integrations)[number] | null = null;
  for (const integration of integrations) {
    const settings = integration.settings as Record<string, unknown> | null;
    const stored = typeof settings?.webhookSecret === "string"
      ? settings.webhookSecret
      : null;
    if (stored && safeEqual(provided, stored)) {
      matched = integration;
      break;
    }
  }

  if (!matched) {
    return NextResponse.json(
      { ok: false, error: "Invalid webhook secret." },
      { status: 401 }
    );
  }

  let payload: IncomingPayload;
  try {
    payload = (await req.json()) as IncomingPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body must be valid JSON." },
      { status: 400 }
    );
  }

  const lineItems = payload.lineItems ?? payload.line_items ?? payload.items;
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Expected a non-empty `lineItems` array with at least one `{externalProductId, quantity}`.",
      },
      { status: 400 }
    );
  }

  const externalOrderId =
    pickString(
      payload.externalOrderId,
      payload.external_order_id,
      payload.orderId
    ) ?? `pos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const occurredAt = (() => {
    const raw = pickString(payload.occurredAt, payload.occurred_at);
    if (!raw) return new Date();
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  })();

  // Upsert the sale event so repeat deliveries from Zapier don't
  // double-deplete. We dedup on (integrationId, externalOrderId) via
  // the schema's composite unique.
  const saleEvent = await db.posSaleEvent.upsert({
    where: {
      integrationId_externalOrderId: {
        integrationId: matched.id,
        externalOrderId,
      },
    },
    update: {},
    create: {
      locationId: matched.locationId,
      integrationId: matched.id,
      externalOrderId,
      status: "COMPLETED",
      source: matched.provider,
      processingStatus: SaleProcessingStatus.PENDING,
      occurredAt,
      rawData: payload as unknown as Prisma.InputJsonValue,
    },
  });

  // Skip lines we already processed for this event. Retries are safe.
  const alreadyProcessed = await db.posSaleLine.findMany({
    where: { saleEventId: saleEvent.id },
    select: { externalLineId: true },
  });
  const seenLines = new Set(alreadyProcessed.map((l) => l.externalLineId));

  let depletions = 0;
  const unmapped: Array<{
    externalProductId: string;
    externalProductName: string | null;
    quantity: number;
  }> = [];

  for (let i = 0; i < lineItems.length; i += 1) {
    const line = lineItems[i]!;
    const externalProductId = pickString(
      line.externalProductId,
      line.external_product_id,
      line.productId,
      line.sku
    );
    if (!externalProductId) continue;

    const externalLineId = `${externalOrderId}:${externalProductId}:${i}`;
    if (seenLines.has(externalLineId)) continue;

    const externalProductName = pickString(
      line.externalProductName,
      line.external_product_name,
      line.productName,
      line.name
    );
    const quantity = pickInt(line.quantity ?? line.qty, 1);

    const mapping = await db.posSimpleMapping.findUnique({
      where: {
        integrationId_externalProductId: {
          integrationId: matched.id,
          externalProductId,
        },
      },
      select: { inventoryItemId: true, quantityPerSaleBase: true },
    });

    await db.$transaction(async (tx) => {
      await tx.posSaleLine.create({
        data: {
          saleEventId: saleEvent.id,
          externalLineId,
          quantity,
          unitPriceCents:
            typeof line.unitPriceCents === "number"
              ? line.unitPriceCents
              : typeof line.unit_price_cents === "number"
                ? line.unit_price_cents
                : undefined,
          rawData: {
            externalProductId,
            externalProductName,
          },
        },
      });

      if (mapping) {
        const deltaBase = -1 * mapping.quantityPerSaleBase * quantity;
        await postStockMovementTx(tx, {
          locationId: matched.locationId,
          inventoryItemId: mapping.inventoryItemId,
          quantityDeltaBase: deltaBase,
          movementType: MovementType.POS_DEPLETION,
          sourceType: "pos_webhook",
          sourceId: externalLineId,
          metadata: {
            saleEventId: saleEvent.id,
            externalProductId,
            externalProductName,
          },
        });
        depletions += 1;
      } else {
        // Remember the product name + id so the admin can map it
        // later without having to look up the cryptic POS id. We
        // stash it as an OPEN alert so it shows up in their alert
        // queue until resolved.
        await tx.alert.upsert({
          where: {
            id: `pos-unmapped-${matched.id}-${externalProductId}`,
          },
          update: {
            // touch on re-occurrence so the alert surfaces freshly
            severity: AlertSeverity.WARNING,
            status: AlertStatus.OPEN,
          },
          create: {
            id: `pos-unmapped-${matched.id}-${externalProductId}`,
            locationId: matched.locationId,
            type: AlertType.RECIPE_GAP,
            severity: AlertSeverity.WARNING,
            status: AlertStatus.OPEN,
            title: `Map this POS product: ${externalProductName ?? externalProductId}`,
            message: `A sale for '${externalProductName ?? externalProductId}' came in from ${matched.provider}, but we don't know which inventory item to deplete. Open /pos-mapping to link it — all future sales (and this one once resolved) will deplete automatically.`,
          },
        });
        unmapped.push({
          externalProductId,
          externalProductName,
          quantity,
        });
      }
    });
  }

  // Mark the event processed once all lines are either depleted or
  // queued as unmapped alerts. Partial processing is still "success"
  // for webhook acknowledgement; the next sale of a newly-mapped
  // product picks up on its own.
  await db.posSaleEvent.update({
    where: { id: saleEvent.id },
    data: {
      processingStatus: SaleProcessingStatus.PROCESSED,
      processedAt: new Date(),
    },
  });

  botTelemetry.event("pos-webhook.processed", {
    integrationId: matched.id,
    provider: matched.provider,
    processed: depletions,
    unmapped: unmapped.length,
  });

  return NextResponse.json({
    ok: true,
    processed: depletions,
    unmapped,
    saleEventId: saleEvent.id,
  });
}

export function GET() {
  return NextResponse.json({
    ok: true,
    message:
      "POS webhook is live. POST sales here with `Authorization: Bearer <your-secret>`.",
  });
}
