import type {
  AutomationProvider,
  WebsiteOrderAutomationInput,
} from "@/providers/contracts";

type N8nAutomationProviderOptions = {
  webhookUrl: string;
  secret?: string;
};

export class N8nAutomationProvider implements AutomationProvider {
  constructor(private readonly options: N8nAutomationProviderOptions) {}

  async dispatchWebsiteOrderTask(input: WebsiteOrderAutomationInput) {
    const response = await fetch(this.options.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "stockpilot/0.1",
        ...(this.options.secret
          ? { "X-StockPilot-Webhook-Secret": this.options.secret }
          : {}),
      },
      body: JSON.stringify({
        event: "stockpilot.website_order_prep",
        occurredAt: new Date().toISOString(),
        task: input,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!response.ok) {
      const message =
        typeof payload.message === "string"
          ? payload.message
          : `n8n dispatch failed with status ${response.status}`;
      throw new Error(message);
    }

    return {
      provider: "n8n",
      summary:
        (typeof payload.message === "string" && payload.message) ||
        `Dispatched website-order prep for ${input.supplierName} to n8n.`,
      dispatchState: "pending" as const,
      externalRunId:
        typeof payload.runId === "string"
          ? payload.runId
          : typeof payload.executionId === "string"
          ? payload.executionId
          : undefined,
      externalUrl:
        typeof payload.runUrl === "string"
          ? payload.runUrl
          : typeof payload.executionUrl === "string"
          ? payload.executionUrl
          : undefined,
      metadata: payload,
    };
  }
}
