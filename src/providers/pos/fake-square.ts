import { PosProviderType } from "@/lib/prisma";

import { fakeSquareCatalog, fakeSquareOrders } from "@/modules/pos/fixtures";
import type { PosProvider } from "@/providers/contracts";

export class FakeSquareProvider implements PosProvider {
  provider = PosProviderType.SQUARE;

  async connect() {
    return {
      status: "connected" as const,
      sandbox: true,
    };
  }

  async syncCatalog() {
    return fakeSquareCatalog;
  }

  async syncOrders() {
    return fakeSquareOrders;
  }

  async handleWebhook(input: {
    payload: unknown;
    rawBody: string;
    signature: string | null;
    notificationUrl: string;
  }) {
    const payload =
      input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
        ? (input.payload as Record<string, unknown>)
        : null;

    return {
      accepted: true,
      message: "Fake Square provider accepted the webhook payload.",
      eventType: typeof payload?.type === "string" ? payload.type : null,
      eventId: typeof payload?.event_id === "string" ? payload.event_id : null,
      merchantId: typeof payload?.merchant_id === "string" ? payload.merchant_id : null,
      locationId: typeof payload?.location_id === "string" ? payload.location_id : null,
    };
  }
}

