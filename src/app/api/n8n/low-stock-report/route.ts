/**
 * Rich daily operations brief — called by n8n Workflow 02 every
 * morning at 8am. Replaces the old "just list items below par" with
 * a genuinely actionable summary:
 *
 *   - Burn rate per item, computed from the last 7 days of actual
 *     consumption (POS_DEPLETION + WASTE + BREAKAGE movements).
 *   - Projected days_remaining = stockOnHand / burnRate. An item
 *     with 5 units left but 2/day burn is more urgent than an item
 *     with 3 units left but 0.1/day burn.
 *   - Per-item "criticality" that factors BOTH on-hand-vs-par AND
 *     projected-days-to-zero.
 *   - Pre-rendered `message` field so n8n can just relay it.
 *   - Yesterday's activity summary (orders sent, replies received,
 *     rescue orders triggered) so the manager sees recent context.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  AlertSeverity,
  CommunicationDirection,
  MovementType,
  PurchaseOrderStatus,
} from "@/lib/prisma";
import { verifyN8nRequest } from "@/modules/automation/n8n-auth";

const BURN_WINDOW_DAYS = 7;
const CRITICAL_DAYS = 2; // ≤2 days runway = critical
const WATCH_DAYS = 5; // ≤5 days runway = watch

export async function GET(request: NextRequest) {
  const auth = await verifyN8nRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ message: auth.reason }, { status: 401 });
  }

  try {
    const location = await db.location.findFirst({
      select: { id: true, name: true },
    });
    if (!location) {
      return NextResponse.json({ message: "No location found" }, { status: 404 });
    }

    // 1. Per-item burn rate from recent consumption.
    const since = new Date(Date.now() - BURN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const consumption = await db.stockMovement.groupBy({
      by: ["inventoryItemId"],
      where: {
        locationId: location.id,
        performedAt: { gte: since },
        movementType: {
          in: [
            MovementType.POS_DEPLETION,
            MovementType.WASTE,
            MovementType.BREAKAGE,
          ],
        },
      },
      _sum: { quantityDeltaBase: true },
    });
    const burnByItem = new Map<string, number>();
    for (const row of consumption) {
      const outflow = Math.abs(row._sum.quantityDeltaBase ?? 0);
      burnByItem.set(row.inventoryItemId, outflow / BURN_WINDOW_DAYS);
    }

    // 2. Items + snapshots. We pull all items (not only below-par)
    //    so we can spot items with fine stock but terrible runway.
    const items = await db.inventoryItem.findMany({
      where: { locationId: location.id },
      select: {
        id: true,
        name: true,
        stockOnHandBase: true,
        parLevelBase: true,
        displayUnit: true,
        packSizeBase: true,
        primarySupplier: { select: { name: true } },
        snapshot: { select: { urgency: true, daysLeft: true } },
      },
    });

    // 3. Pending POs per item — "safe until next delivery" logic.
    const pendingLines = await db.purchaseOrderLine.findMany({
      where: {
        purchaseOrder: {
          locationId: location.id,
          status: {
            in: [PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.SENT, PurchaseOrderStatus.ACKNOWLEDGED],
          },
        },
      },
      select: {
        inventoryItemId: true,
        purchaseOrder: {
          select: { orderNumber: true, status: true, supplier: { select: { name: true } } },
        },
      },
    });
    const pendingByItem = new Map<string, Array<{ orderNumber: string; status: string; supplier: string }>>();
    for (const l of pendingLines) {
      const arr = pendingByItem.get(l.inventoryItemId) ?? [];
      arr.push({
        orderNumber: l.purchaseOrder.orderNumber,
        status: l.purchaseOrder.status,
        supplier: l.purchaseOrder.supplier.name,
      });
      pendingByItem.set(l.inventoryItemId, arr);
    }

    type EnrichedItem = {
      id: string;
      name: string;
      onHand: number;
      par: number;
      unit: string;
      burnPerDay: number;
      daysRemaining: number | null;
      urgency: "CRITICAL" | "WATCH" | "SAFE";
      supplier: string | null;
      pendingOrders: Array<{ orderNumber: string; status: string; supplier: string }>;
    };

    const enriched: EnrichedItem[] = items.map((i) => {
      const burn = burnByItem.get(i.id) ?? 0;
      const daysRemaining =
        burn > 0
          ? i.stockOnHandBase / burn
          : i.stockOnHandBase > 0
          ? null // infinite-ish — no consumption
          : 0;
      let urgency: EnrichedItem["urgency"] = "SAFE";
      const belowPar = i.stockOnHandBase < i.parLevelBase;
      if (
        (daysRemaining !== null && daysRemaining <= CRITICAL_DAYS) ||
        (belowPar && i.snapshot?.urgency === AlertSeverity.CRITICAL)
      ) {
        urgency = "CRITICAL";
      } else if (
        (daysRemaining !== null && daysRemaining <= WATCH_DAYS) ||
        belowPar
      ) {
        urgency = "WATCH";
      }
      return {
        id: i.id,
        name: i.name,
        onHand: i.stockOnHandBase,
        par: i.parLevelBase,
        unit: i.displayUnit.toLowerCase(),
        burnPerDay: Math.round(burn * 100) / 100,
        daysRemaining: daysRemaining == null ? null : Math.round(daysRemaining * 10) / 10,
        urgency,
        supplier: i.primarySupplier?.name ?? null,
        pendingOrders: pendingByItem.get(i.id) ?? [],
      };
    });

    const critical = enriched.filter((i) => i.urgency === "CRITICAL");
    const watch = enriched.filter((i) => i.urgency === "WATCH");

    // Proactive recommendations — for each critical item not already
    // covered by a pending PO, suggest an amount to order today,
    // grouped by supplier so each supplier = one order.
    type RecOrder = {
      supplier: string;
      lines: Array<{ name: string; suggested: number; unit: string; runway: string }>;
    };
    const recsBySupplier = new Map<string, RecOrder>();
    for (const item of critical) {
      if (item.pendingOrders.length > 0) continue; // already being handled
      const supplierName = item.supplier ?? "No supplier linked";
      const shortage = Math.max(1, Math.ceil((item.par - item.onHand) / Math.max(1, item.burnPerDay || 1)));
      // Suggest enough to get back to par + 1 safety day of burn.
      const suggestedBase = Math.max(1, item.par - item.onHand + Math.ceil(item.burnPerDay || 0));
      const existing = recsBySupplier.get(supplierName) ?? {
        supplier: supplierName,
        lines: [],
      };
      existing.lines.push({
        name: item.name,
        suggested: Math.round(suggestedBase),
        unit: item.unit,
        runway:
          item.daysRemaining == null
            ? ""
            : item.daysRemaining < 1
            ? `${Math.round(item.daysRemaining * 24)}h left`
            : `${item.daysRemaining.toFixed(1)}d left`,
      });
      recsBySupplier.set(supplierName, existing);
    }
    const recommendedOrders = Array.from(recsBySupplier.values());

    // 4. Yesterday-ish activity snapshot.
    const yesterdayStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [ordersSentYd, repliesYd, rescueOrdersYd] = await Promise.all([
      db.purchaseOrder.count({
        where: {
          locationId: location.id,
          sentAt: { gte: yesterdayStart },
        },
      }),
      db.supplierCommunication.count({
        where: {
          direction: CommunicationDirection.INBOUND,
          createdAt: { gte: yesterdayStart },
          purchaseOrder: { locationId: location.id },
        },
      }),
      db.purchaseOrder.count({
        where: {
          locationId: location.id,
          createdAt: { gte: yesterdayStart },
          metadata: { path: ["source"], equals: "rescue" },
        },
      }),
    ]);

    // 5. Pre-rendered Telegram message for workflow 02 to just relay.
    const message = renderBriefMessage({
      locationName: location.name,
      critical,
      watch,
      recommendedOrders,
      activity: {
        ordersSent: ordersSentYd,
        supplierReplies: repliesYd,
        rescueOrders: rescueOrdersYd,
      },
    });

    return NextResponse.json({
      ok: true,
      locationName: location.name,
      generatedAt: new Date().toISOString(),
      totalLowStock: critical.length + watch.length,
      critical: critical.length,
      warning: watch.length,
      // Backward-compatible `items` field — union of critical + watch,
      // keeps old workflow versions happy.
      items: [...critical, ...watch].map((i) => ({
        id: i.id,
        name: i.name,
        onHand: i.onHand,
        par: i.par,
        unit: i.unit,
        urgency: i.urgency === "CRITICAL" ? "CRITICAL" : "WARNING",
        daysLeft: i.daysRemaining,
        supplier: i.supplier,
        shortage: Math.max(0, i.par - i.onHand),
      })),
      // Rich data for the new workflow.
      brief: {
        critical,
        watch,
        recommendedOrders,
        activity: {
          ordersSent: ordersSentYd,
          supplierReplies: repliesYd,
          rescueOrders: rescueOrdersYd,
        },
      },
      message,
    });
  } catch (error) {
    console.error("[low-stock-report] error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}

function renderBriefMessage(input: {
  locationName: string;
  critical: Array<{
    name: string;
    onHand: number;
    par: number;
    unit: string;
    burnPerDay: number;
    daysRemaining: number | null;
    supplier: string | null;
    pendingOrders: Array<{ orderNumber: string; status: string; supplier: string }>;
  }>;
  watch: Array<{
    name: string;
    onHand: number;
    par: number;
    unit: string;
    daysRemaining: number | null;
    supplier: string | null;
    pendingOrders: Array<{ orderNumber: string; status: string; supplier: string }>;
  }>;
  recommendedOrders: Array<{
    supplier: string;
    lines: Array<{ name: string; suggested: number; unit: string; runway: string }>;
  }>;
  activity: { ordersSent: number; supplierReplies: number; rescueOrders: number };
}): string {
  const lines: string[] = [];
  lines.push(`📊 *Good morning — ${input.locationName}*`);
  lines.push("");

  if (input.critical.length > 0) {
    lines.push("🔴 *Order today — running out*");
    for (const i of input.critical) {
      const runway =
        i.daysRemaining !== null
          ? ` (${formatDays(i.daysRemaining)} left)`
          : "";
      const pending = i.pendingOrders.length
        ? ` — _${i.pendingOrders[0].orderNumber} ${i.pendingOrders[0].status.toLowerCase()} w/ ${i.pendingOrders[0].supplier}_`
        : i.supplier
        ? ` — _order from ${i.supplier}_`
        : "";
      lines.push(`  • ${i.name}: ${i.onHand}/${i.par} ${i.unit}${runway}${pending}`);
    }
    lines.push("");
  }

  if (input.watch.length > 0) {
    lines.push("🟡 *Watch list — order this week*");
    for (const i of input.watch.slice(0, 8)) {
      const runway =
        i.daysRemaining !== null
          ? ` (${formatDays(i.daysRemaining)} left)`
          : "";
      lines.push(`  • ${i.name}: ${i.onHand}/${i.par} ${i.unit}${runway}`);
    }
    if (input.watch.length > 8) {
      lines.push(`  …and ${input.watch.length - 8} more`);
    }
    lines.push("");
  }

  if (input.critical.length === 0 && input.watch.length === 0) {
    lines.push("✅ *All items above par — no action needed today.*");
    lines.push("");
  }

  if (input.recommendedOrders.length > 0) {
    lines.push("📋 *To be safe through the week, place these orders today:*");
    for (const rec of input.recommendedOrders) {
      lines.push(`  🏪 *${rec.supplier}*`);
      for (const line of rec.lines) {
        const runway = line.runway ? ` · ${line.runway}` : "";
        lines.push(`    • ${line.suggested} ${line.unit} ${line.name}${runway}`);
      }
    }
    lines.push("");
    lines.push(
      "_Reply with what you want ordered — e.g. \"yes, draft those\" — and I'll handle it._"
    );
    lines.push("");
  }

  lines.push("📈 *Last 24h*");
  lines.push(
    `  • ${input.activity.ordersSent} order${input.activity.ordersSent === 1 ? "" : "s"} sent`
  );
  lines.push(
    `  • ${input.activity.supplierReplies} supplier repl${input.activity.supplierReplies === 1 ? "y" : "ies"}`
  );
  if (input.activity.rescueOrders > 0) {
    lines.push(
      `  • ${input.activity.rescueOrders} auto-rescue${input.activity.rescueOrders === 1 ? "" : "s"} triggered`
    );
  }
  lines.push("");
  lines.push(
    "_Reply here with what you want to order — e.g. \"order 5 bags of ground coffee\"._"
  );

  return lines.join("\n");
}

function formatDays(days: number): string {
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 10) return `${days.toFixed(1)}d`;
  return `${Math.round(days)}d`;
}
