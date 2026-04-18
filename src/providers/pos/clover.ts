import { PosProviderType, ServiceMode } from "@/lib/prisma";

import { env } from "@/lib/env";
import type {
  PosProvider,
  ProviderCatalogItem,
  ProviderSaleEvent,
} from "@/providers/contracts";

/**
 * Clover native OAuth + REST provider.
 *
 * Flow mirrors Square's — connect() returns a redirect_required for
 * the Clover OAuth page, callback route calls exchangeCode() to turn
 * the auth code into an access+refresh token pair, and the webhook
 * route feeds `handleWebhook` the raw Clover payload.
 *
 * Key Clover quirks vs Square:
 *   - Auth domain != API domain (www.clover.com vs api.clover.com)
 *   - Token endpoint is /oauth/v2/token (not /oauth2/token)
 *   - Merchant is embedded in every API path (/v3/merchants/{mId}/...)
 *     so we MUST capture merchant_id from the callback querystring,
 *     not just from the token response — Clover's token response
 *     historically didn't include it.
 *   - Prices come in cents directly (no money object wrapping)
 *
 * Scopes requested are fixed at the app-config level in Clover's
 * dev dashboard (REQUESTED PERMISSIONS) — there's no `scope=` param
 * in the authorize URL, so we just ask for Merchants/Inventory/Orders
 * Read when the user creates the app, and nothing here.
 */

type CloverMerchant = {
  id: string;
  name?: string;
  address?: Record<string, unknown>;
  defaultCurrency?: string;
};

type CloverCategory = {
  id: string;
  name?: string;
};

type CloverItem = {
  id: string;
  name?: string;
  price?: number;
  sku?: string;
  code?: string;
  hidden?: boolean;
  categories?: { elements?: CloverCategory[] };
  itemStock?: { stockCount?: number; quantity?: number };
};

type CloverLineItem = {
  id: string;
  name?: string;
  item?: { id?: string };
  price?: number;
  unitQty?: number;
  note?: string;
  modifications?: {
    elements?: Array<{ id?: string; name?: string }>;
  };
};

type CloverOrder = {
  id: string;
  state?: string;
  createdTime?: number;
  modifiedTime?: number;
  total?: number;
  lineItems?: { elements?: CloverLineItem[] };
};

export class CloverProvider implements PosProvider {
  provider = PosProviderType.CLOVER;

  async connect(input: {
    integrationId: string;
    callbackUrl: string;
    state: string;
    accessToken?: string | null;
  }) {
    if (!env.CLOVER_CLIENT_ID || !env.CLOVER_CLIENT_SECRET) {
      throw new Error(
        "Clover client credentials are not configured. Set CLOVER_CLIENT_ID and CLOVER_CLIENT_SECRET."
      );
    }

    // PAT fallback — not a Clover-native concept, but we allow a
    // stored token to short-circuit the OAuth dance when an admin has
    // already completed the dance once and we just need to re-verify.
    if (input.accessToken) {
      const merchant = await this.fetchMerchant(input.accessToken, null);
      if (merchant) {
        return {
          status: "connected" as const,
          sandbox: this.isSandbox(),
          externalMerchantId: merchant.id,
          accessToken: input.accessToken,
        };
      }
    }

    const params = new URLSearchParams({
      client_id: env.CLOVER_CLIENT_ID,
      response_type: "code",
      redirect_uri: input.callbackUrl,
      state: input.state,
    });

    return {
      status: "redirect_required" as const,
      sandbox: this.isSandbox(),
      authUrl: `${this.getAuthorizeBaseUrl()}/oauth/authorize?${params.toString()}`,
    };
  }

  async exchangeCode(input: { code: string; callbackUrl: string }) {
    if (!env.CLOVER_CLIENT_ID || !env.CLOVER_CLIENT_SECRET) {
      throw new Error("Clover client credentials are not configured.");
    }

    const response = await fetch(`${this.getApiBaseUrl()}/oauth/v2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: env.CLOVER_CLIENT_ID,
        client_secret: env.CLOVER_CLIENT_SECRET,
        code: input.code,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      access_token_expiration?: number;
      message?: string;
    };

    if (!response.ok || !payload.access_token) {
      throw new Error(
        payload.message ??
          `Clover OAuth token exchange failed with status ${response.status}`
      );
    }

    return {
      sandbox: this.isSandbox(),
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
    };
  }

  async syncCatalog(input?: {
    accessToken?: string | null;
    locationId?: string | null;
  }): Promise<ProviderCatalogItem[]> {
    const accessToken = this.requireAccessToken(input?.accessToken);
    const merchantId = input?.locationId;
    if (!merchantId) {
      throw new Error("Clover merchant id is required for catalog sync.");
    }

    const items = await this.listItems(accessToken, merchantId);

    return items
      .filter((item) => item.name && !item.hidden)
      .map((item) => {
        const categoryName = item.categories?.elements?.[0]?.name ?? undefined;
        return {
          externalItemId: item.id,
          name: item.name ?? "Unnamed item",
          category: categoryName,
          // Clover's concept of "variations" doesn't map 1:1 — most
          // items have no variations, only modifier groups. We model
          // the item itself as a single variation for parity with the
          // Square shape expected downstream.
          variations: [
            {
              externalVariationId: item.id,
              name: item.name ?? "Default",
              priceCents: typeof item.price === "number" ? item.price : undefined,
              externalSku: item.sku ?? item.code ?? undefined,
            },
          ],
        };
      });
  }

  async syncOrders(input?: {
    accessToken?: string | null;
    locationId?: string | null;
  }): Promise<ProviderSaleEvent[]> {
    const accessToken = this.requireAccessToken(input?.accessToken);
    const merchantId = input?.locationId;
    if (!merchantId) {
      throw new Error("Clover merchant id is required for order sync.");
    }

    // Only "locked" / paid orders depleting inventory. Clover leaves
    // orders in "open" while being edited on the POS.
    const since = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const searchParams = new URLSearchParams({
      filter: `state=locked`,
      expand: "lineItems",
      limit: "100",
    });

    const response = await this.cloverRequest<{ elements?: CloverOrder[] }>(
      accessToken,
      `/v3/merchants/${encodeURIComponent(merchantId)}/orders?${searchParams.toString()}`,
      { method: "GET" }
    );

    const orders = response.elements ?? [];

    return orders
      .filter((order) => (order.createdTime ?? 0) >= since)
      .map((order) => ({
        externalOrderId: order.id,
        occurredAt: new Date(order.modifiedTime ?? order.createdTime ?? Date.now()),
        status: (order.state ?? "UNKNOWN").toUpperCase(),
        lines: (order.lineItems?.elements ?? []).map((line) => ({
          externalLineId: line.id,
          externalVariationId: line.item?.id ?? line.id,
          quantity: typeof line.unitQty === "number" && line.unitQty > 0
            ? line.unitQty / 1000 // Clover expresses fractional qty in thousandths
            : 1,
          unitPriceCents: typeof line.price === "number" ? line.price : undefined,
          serviceMode: undefined as ServiceMode | undefined,
          modifiers: (line.modifications?.elements ?? [])
            .map((m) => m.name?.trim())
            .filter((n): n is string => Boolean(n)),
        })),
      }));
  }

  async handleWebhook(input: {
    payload: unknown;
    rawBody: string;
    signature: string | null;
    notificationUrl: string;
  }) {
    // Clover webhooks send an HMAC-SHA256 of the raw body keyed by the
    // app's webhook signature secret, in an `X-Clover-Auth` header.
    // We defer full verification to the webhook route handler — this
    // method just parses + normalises the payload shape.
    const payload =
      input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
        ? (input.payload as Record<string, unknown>)
        : null;

    return {
      accepted: true,
      message: "Clover webhook payload received.",
      eventType: typeof payload?.type === "string" ? payload.type : null,
      eventId: typeof payload?.objectId === "string" ? payload.objectId : null,
      merchantId:
        typeof payload?.merchantId === "string"
          ? payload.merchantId
          : typeof payload?.merchants === "string"
            ? payload.merchants
            : null,
      locationId:
        typeof payload?.merchantId === "string" ? payload.merchantId : null,
    };
  }

  // ---- private helpers ----

  private async fetchMerchant(
    accessToken: string,
    merchantId: string | null
  ): Promise<CloverMerchant | null> {
    if (!merchantId) return null;
    try {
      return await this.cloverRequest<CloverMerchant>(
        accessToken,
        `/v3/merchants/${encodeURIComponent(merchantId)}`,
        { method: "GET" }
      );
    } catch {
      return null;
    }
  }

  private async listItems(
    accessToken: string,
    merchantId: string
  ): Promise<CloverItem[]> {
    const items: CloverItem[] = [];
    let offset = 0;
    const limit = 100;

    // Pagination: Clover returns up to 100 items per call. Use offset
    // until we get a short page back — no `cursor` in Clover's v3 API.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const searchParams = new URLSearchParams({
        expand: "categories,itemStock",
        limit: String(limit),
        offset: String(offset),
      });
      const page = await this.cloverRequest<{ elements?: CloverItem[] }>(
        accessToken,
        `/v3/merchants/${encodeURIComponent(merchantId)}/items?${searchParams.toString()}`,
        { method: "GET" }
      );
      const chunk = page.elements ?? [];
      items.push(...chunk);
      if (chunk.length < limit) break;
      offset += chunk.length;
      if (offset > 10_000) break; // paranoia bound
    }
    return items;
  }

  private async cloverRequest<T>(
    accessToken: string,
    path: string,
    init: RequestInit
  ): Promise<T> {
    const response = await fetch(`${this.getApiBaseUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    const payload = (await response.json().catch(() => ({}))) as T & {
      message?: string;
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(
        payload.error?.message ??
          payload.message ??
          `Clover request failed with status ${response.status}`
      );
    }

    return payload;
  }

  private getAuthorizeBaseUrl() {
    return this.isSandbox()
      ? "https://sandbox.dev.clover.com"
      : "https://www.clover.com";
  }

  private getApiBaseUrl() {
    return this.isSandbox()
      ? "https://apisandbox.dev.clover.com"
      : "https://api.clover.com";
  }

  private requireAccessToken(accessToken?: string | null) {
    if (!accessToken) {
      throw new Error("Clover access token is required for this operation.");
    }
    return accessToken;
  }

  private isSandbox() {
    return env.CLOVER_ENVIRONMENT === "sandbox";
  }
}
