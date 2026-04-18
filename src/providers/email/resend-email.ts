import { randomUUID } from "node:crypto";
import { NotificationChannel } from "@/lib/prisma";

import type { NotificationProvider, SupplierOrderProvider } from "@/providers/contracts";
import { buildWebsiteOrderPlaywrightTemplate } from "@/modules/automation/playwright-template";

type ResendEmailProviderOptions = {
  apiKey: string;
  fromEmail: string;
};

export class ResendEmailProvider
  implements NotificationProvider, SupplierOrderProvider
{
  constructor(private readonly options: ResendEmailProviderOptions) {}

  async sendNotification(input: {
    notificationId?: string;
    channel: NotificationChannel;
    recipient: string;
    subject?: string;
    body: string;
    callbackUrl?: string;
    callbackSecret?: string | null;
  }) {
    if (input.channel === NotificationChannel.EMAIL) {
      return this.sendEmail({
        recipient: input.recipient,
        subject: input.subject ?? "StockPilot notification",
        body: input.body,
      });
    }

    console.info(`[ResendEmailProvider:${input.channel}] fallback`, input);
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
    return this.sendEmail(input);
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

  private async sendEmail(input: {
    recipient: string;
    subject: string;
    body: string;
    html?: string;
    replyTo?: string;
  }) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "stockpilot/0.1",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        from: this.options.fromEmail,
        to: [input.recipient],
        subject: input.subject,
        text: input.body,
        ...(input.html ? { html: input.html } : {}),
        // Resend accepts `reply_to`; without it, replies go to the
        // verified `from` domain which a café owner may not own yet.
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(
        payload.message ??
          payload.error?.message ??
          `Resend request failed with status ${response.status}`
      );
    }

    return {
      providerMessageId: payload.id,
      deliveryState: "sent" as const,
    };
  }
}
