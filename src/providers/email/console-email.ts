import type { NotificationProvider, SupplierOrderProvider } from "@/providers/contracts";
import { NotificationChannel } from "@/lib/prisma";
import { buildWebsiteOrderPlaywrightTemplate } from "@/modules/automation/playwright-template";

export class ConsoleEmailProvider implements NotificationProvider, SupplierOrderProvider {
  async sendNotification(input: {
    notificationId?: string;
    channel: NotificationChannel;
    recipient: string;
    subject?: string;
    body: string;
    callbackUrl?: string;
    callbackSecret?: string | null;
  }) {
    console.info(`[ConsoleNotificationProvider:${input.channel}]`, input);
    return {
      providerMessageId: `console-${input.channel.toLowerCase()}-${Date.now()}`,
      deliveryState: "sent" as const,
    };
  }

  async sendAlert(input: { recipient: string; subject: string; body: string }) {
    return this.sendNotification({
      channel: NotificationChannel.EMAIL,
      recipient: input.recipient,
      subject: input.subject,
      body: input.body,
    });
  }

  async createDraft(input: {
    supplierName: string;
    mode: "EMAIL" | "WEBSITE" | "MANUAL";
    orderNumber: string;
    lines: Array<{ description: string; quantity: number; unit: string }>;
  }) {
    const lines = input.lines
      .map((line) => `- ${line.description}: ${line.quantity} ${line.unit}`)
      .join("\n");

    return {
      subject: `PO ${input.orderNumber} from StockPilot`,
      body: `Hello ${input.supplierName},\n\nPlease confirm the following order:\n${lines}\n\nThank you,\nStockPilot`,
    };
  }

  async sendApprovedOrder(input: { recipient: string; subject: string; body: string }) {
    console.info("[ConsoleEmailProvider] supplier-order", input);
    return {
      providerMessageId: `console-order-${Date.now()}`,
    };
  }

  async prepareWebsiteTask(input: {
    supplierName: string;
    website?: string | null;
    orderNumber: string;
    lines: Array<{ description: string; quantity: number; unit: string }>;
  }) {
    const lineSummary = input.lines.map((line) => ({
      label: line.description,
      quantity: `${line.quantity} ${line.unit}`,
    }));
    const playwrightScript = buildWebsiteOrderPlaywrightTemplate(input);

    return {
      title: `Prepare ${input.supplierName} website order`,
      description: `Review the site order draft for PO ${input.orderNumber}. Final submission stays manager-approved.`,
      input: {
        ...input,
        credentials: {
          status: "placeholder",
          note: "Use supplier credentials stored outside StockPilot in v1. Never submit without manager approval.",
        },
        steps: [
          {
            title: "Open supplier portal",
            detail: `Navigate to ${input.website ?? "the supplier ordering portal"} and confirm you are in the correct account.`,
          },
          {
            title: "Sign in safely",
            detail: "Use the supplier credentials placeholder and stop if credentials are unavailable or expired.",
          },
          {
            title: "Build the cart",
            detail: `Add the requested lines for ${input.orderNumber}: ${lineSummary
              .map((line) => `${line.label} (${line.quantity})`)
              .join(", ")}.`,
          },
          {
            title: "Capture review evidence",
            detail: "Keep the cart ready for approval, capture totals, and stop before final submission.",
          },
        ],
        evidenceChecklist: [
          "Cart quantities match StockPilot",
          "Delivery date or slot is visible",
          "Order total or subtotal is captured",
          "Final submit button is not pressed until a manager approves",
        ],
        browserAutomation: {
          mode: "playwright-template",
          readyForExecution: true,
          scriptLanguage: "typescript",
          scriptFilename: `stockpilot-${input.orderNumber.toLowerCase()}-website-order.ts`,
          script: playwrightScript,
        },
        approvalGate: "Final supplier checkout remains manager-approved in v1.",
      },
    };
  }
}
