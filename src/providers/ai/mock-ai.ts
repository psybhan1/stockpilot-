import { MeasurementUnit } from "@/lib/prisma";

import { buildRecipeSuggestion } from "@/modules/recipes/suggestions";
import type { AiProvider } from "@/providers/contracts";

export class MockAiProvider implements AiProvider {
  async suggestRecipe(input: {
    menuItemName: string;
    variationName: string;
    serviceMode?: unknown;
  }) {
    return buildRecipeSuggestion(input.variationName || input.menuItemName);
  }

  async explainRisk(input: {
    inventoryName: string;
    daysLeft: number | null;
    projectedRunoutAt: Date | null;
  }) {
    if (input.daysLeft == null) {
      return `${input.inventoryName} has sparse usage history, so the forecast is low confidence and needs a fresh count.`;
    }

    if (input.daysLeft < 2) {
      return `${input.inventoryName} is on pace to run out in under two days. Prioritize a reorder or count verification immediately.`;
    }

    return `${input.inventoryName} is tracking toward a stockout window that needs review before the next delivery cycle.`;
  }

  async explainReorder(input: {
    inventoryName: string;
    projectedRunoutAt: Date | null;
    recommendedPackCount: number;
    recommendedUnit: MeasurementUnit;
  }) {
    return `Order ${input.recommendedPackCount} ${input.recommendedUnit.toLowerCase()} units of ${input.inventoryName} so the location stays above safety stock before the next delivery window.`;
  }

  async draftSupplierMessage(input: {
    supplierName: string;
    orderNumber: string;
    lines: Array<{ description: string; quantity: number; unit: string }>;
  }) {
    // Delegate to the same deterministic template every other path
    // uses, so callers don't accidentally produce the old bland
    // "Please confirm PO PO-XXXX for N units" body.
    const { buildSupplierOrderEmail } = await import(
      "@/modules/purchasing/email-template"
    );
    const composed = buildSupplierOrderEmail({
      supplierName: input.supplierName,
      businessName: "Our team",
      orderNumber: input.orderNumber,
      replyToEmail: "",
      lines: input.lines,
    });
    return { subject: composed.subject, body: composed.text };
  }

  async answerOpsQuery(input: {
    question: string;
    summary: {
      lowStockItems: string[];
      pendingApprovals: string[];
      recentAnomalies: string[];
    };
  }) {
    const lower = input.question.toLowerCase();

    if (lower.includes("weekend") || lower.includes("run out")) {
      return {
        answer: `Most likely runouts are ${input.summary.lowStockItems.join(
          ", "
        )}. Those items are already inside the alert queue and reorder workflow.`,
        suggestedActions: ["Review purchase orders", "Run a stock count on packaging"],
      };
    }

    if (lower.includes("oat milk")) {
      return {
        answer:
          "Oat milk is trending down because the large iced vanilla latte mix is heavier than dairy milk drinks and the last sample sale skewed toward that item.",
        suggestedActions: ["Approve the oat milk reorder", "Verify oat milk count"],
      };
    }

    if (lower.includes("draft an order")) {
      return {
        answer: `Pending approvals already cover ${input.summary.pendingApprovals.join(
          ", "
        )}. Approve the recommendation to generate the supplier-ready order draft.`,
        suggestedActions: ["Open purchase orders", "Review supplier drafts"],
      };
    }

    return {
      answer:
        "StockPilot is prioritizing low-stock risks, pending recipe approvals, and supplier follow-ups. Use the dashboard cards to move the highest-risk items first.",
      suggestedActions: ["Review alerts", "Run queued jobs"],
    };
  }
}

