import type {
  AutomationProvider,
  WebsiteOrderAutomationInput,
} from "@/providers/contracts";

export class InternalAutomationProvider implements AutomationProvider {
  async dispatchWebsiteOrderTask(input: WebsiteOrderAutomationInput) {
    const website = input.website ?? "supplier portal";
    const browserAutomation =
      input.input &&
      typeof input.input === "object" &&
      !Array.isArray(input.input) &&
      "browserAutomation" in input.input
        ? (input.input as Record<string, unknown>).browserAutomation
        : null;

    return {
      provider: "internal",
      summary:
        browserAutomation && typeof browserAutomation === "object"
          ? `Prepared a Playwright-ready website-order workflow for ${input.supplierName}. Review the script, capture evidence in StockPilot, and stop before checkout.`
          : `Prepared an internal website-order brief for ${input.supplierName}. Review the steps, capture evidence in StockPilot, and stop before checkout.`,
      dispatchState: "ready_for_review" as const,
      metadata: {
        destination: website,
        reviewUrl: input.reviewUrl,
        orderNumber: input.orderNumber,
        mode: "internal-review",
      },
    };
  }
}
