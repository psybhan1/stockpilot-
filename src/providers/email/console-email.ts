import type { NotificationProvider, SupplierOrderProvider } from "@/providers/contracts";
import { NotificationChannel } from "@/lib/prisma";
import { buildWebsiteOrderPlaywrightTemplate } from "@/modules/automation/playwright-template";
import { buildMailtoUrl } from "./mailto";

export { buildMailtoUrl };

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

  async sendApprovedOrder(input: {
    recipient: string;
    subject: string;
    body: string;
    html?: string;
    replyTo?: string;
  }) {
    // No provider is configured, so we don't actually send an email.
    // Instead we hand the caller a mailto: URL pre-filled with
    // recipient/subject/body — the Telegram bot turns this into a
    // single tap-to-open button and the user's native email app
    // sends from their own account. That's the zero-config path:
    // supplier sees a personal email from the café owner, we do
    // nothing on the wire.
    const mailto = buildMailtoUrl({
      to: input.recipient,
      subject: input.subject,
      body: input.body,
    });
    return {
      providerMessageId: `mailto-${Date.now()}`,
      simulated: true as const,
      mailto,
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
