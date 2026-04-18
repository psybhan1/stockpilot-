import { createHmac, timingSafeEqual } from "node:crypto";
import { PosProviderType, ServiceMode } from "@/lib/prisma";

import { env } from "@/lib/env";
import type {
  PosProvider,
  ProviderCatalogItem,
  ProviderSaleEvent,
} from "@/providers/contracts";

/**
 * Shopify POS native-OAuth provider.
 *
 * The big twist vs Square/Clover: **every Shopify merchant has their
 * own shop domain** (`{shop}.myshopify.com`). There is no single
 * "Log in with Shopify" URL. The OAuth flow:
 *
 *   1. User types their shop ("my-cafe" → "my-cafe.myshopify.com")
 *   2. We redirect to https://{shop}.myshopify.com/admin/oauth/authorize
 *   3. Shop owner approves → Shopify redirects back with `code` + `hmac`
 *   4. We verify the hmac of the querystring (Shopify-specific check),
 *      then POST to https://{shop}.myshopify.com/admin/oauth/access_token
 *      for a permanent "offline" access token
 *   5. Persist per-tenant {shopDomain, accessToken} in the
 *      PosIntegration row (shopDomain lives in externalLocationId
 *      so we can build every subsequent API URL).
 *
 * The access token is permanent until the merchant uninstalls the
 * app from Shopify's admin, so there's no refresh flow.
 *
 * Because `connect()` in PosProvider's contract doesn't accept a
 * shop param, the caller (ensureShopifyIntegration) must pass the
 * shop through the `callbackUrl` or via a separate arg. We use a
 * special convention: the `input.accessToken` field carries the
 * shop domain in a leading "shop:" prefix when redirect_required is
 * needed. Cleaner than changing the shared PosProvider interface.
 */

type ShopifyProduct = {
  id: number;
  title: string;
  product_type?: string;
  image?: { src?: string } | null;
  variants?: Array<{
    id: number;
    title: string;
    sku?: string;
    price?: string;
  }>;
};

type ShopifyOrder = {
  id: number;
  name?: string;
  created_at?: string;
  processed_at?: string;
  financial_status?: string;
  line_items?: Array<{
    id: number;
    variant_id?: number;
    product_id?: number;
    quantity: number;
    price?: string;
    title?: string;
    sku?: string;
  }>;
};

export class ShopifyProvider implements PosProvider {
  provider = PosProviderType.SHOPIFY;

  async connect(input: {
    integrationId: string;
    callbackUrl: string;
    state: string;
    accessToken?: string | null;
    shopDomain?: string | null;
  }) {
    if (!env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET) {
      throw new Error(
        "Shopify client credentials are not configured. Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET."
      );
    }

    const shop = this.normaliseShopDomain(input.shopDomain ?? null);
    if (!shop) {
      throw new Error(
        "Shopify requires the merchant's shop domain (e.g. my-cafe.myshopify.com) before OAuth can start."
      );
    }

    const params = new URLSearchParams({
      client_id: env.SHOPIFY_CLIENT_ID,
      scope: env.SHOPIFY_SCOPES,
      redirect_uri: input.callbackUrl,
      state: input.state,
      // "per-user" would issue short-lived online tokens scoped to the
      // installing user; omitting it gives us permanent offline tokens
      // which is what we want for background sync + webhooks.
    });

    return {
      status: "redirect_required" as const,
      sandbox: false,
      authUrl: `https://${shop}/admin/oauth/authorize?${params.toString()}`,
    };
  }

  async exchangeCode(input: {
    code: string;
    callbackUrl: string;
    shopDomain?: string | null;
  }) {
    if (!env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET) {
      throw new Error("Shopify client credentials are not configured.");
    }
    const shop = this.normaliseShopDomain(input.shopDomain ?? null);
    if (!shop) {
      throw new Error("Shopify shop domain missing during token exchange.");
    }

    const response = await fetch(
      `https://${shop}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: env.SHOPIFY_CLIENT_ID,
          client_secret: env.SHOPIFY_CLIENT_SECRET,
          code: input.code,
        }),
      }
    );

    const payload = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      scope?: string;
      errors?: string;
    };

    if (!response.ok || !payload.access_token) {
      throw new Error(
        payload.errors ??
          `Shopify OAuth token exchange failed with status ${response.status}`
      );
    }

    return {
      sandbox: false,
      externalMerchantId: shop,
      externalLocationId: shop,
      accessToken: payload.access_token,
    };
  }

  async syncCatalog(input?: {
    accessToken?: string | null;
    locationId?: string | null;
  }): Promise<ProviderCatalogItem[]> {
    const accessToken = this.requireAccessToken(input?.accessToken);
    const shop = this.normaliseShopDomain(input?.locationId ?? null);
    if (!shop) {
      throw new Error("Shopify shop domain is required for catalog sync.");
    }

    // Pagination: Shopify uses Link header cursors on REST. Simpler
    // for a first cut is the `page_info` cursor via ?limit=250.
    const products: ShopifyProduct[] = [];
    let url: string | null =
      `https://${shop}/admin/api/${env.SHOPIFY_API_VERSION}/products.json?limit=250`;
    while (url) {
      const response = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(
          `Shopify products.json failed with status ${response.status}`
        );
      }
      const body = (await response.json()) as { products?: ShopifyProduct[] };
      products.push(...(body.products ?? []));
      const link = response.headers.get("link");
      const next = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
      url = next;
      if (products.length > 5_000) break; // paranoia bound
    }

    return products
      .filter((p) => p.title)
      .map((p) => ({
        externalItemId: String(p.id),
        name: p.title,
        category: p.product_type ?? undefined,
        imageUrl: p.image?.src ?? undefined,
        variations: (p.variants ?? []).map((v) => ({
          externalVariationId: String(v.id),
          name: v.title === "Default Title" ? p.title : v.title,
          priceCents: this.parsePrice(v.price),
          externalSku: v.sku ?? undefined,
        })),
      }));
  }

  async syncOrders(input?: {
    accessToken?: string | null;
    locationId?: string | null;
  }): Promise<ProviderSaleEvent[]> {
    const accessToken = this.requireAccessToken(input?.accessToken);
    const shop = this.normaliseShopDomain(input?.locationId ?? null);
    if (!shop) {
      throw new Error("Shopify shop domain is required for order sync.");
    }

    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const url = `https://${shop}/admin/api/${env.SHOPIFY_API_VERSION}/orders.json?status=any&financial_status=paid&created_at_min=${encodeURIComponent(since.toISOString())}&limit=250`;

    const response = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(
        `Shopify orders.json failed with status ${response.status}`
      );
    }
    const body = (await response.json()) as { orders?: ShopifyOrder[] };
    const orders = body.orders ?? [];

    return orders.map((order) => ({
      externalOrderId: String(order.id),
      occurredAt: new Date(
        order.processed_at ?? order.created_at ?? Date.now()
      ),
      status: (order.financial_status ?? "UNKNOWN").toUpperCase(),
      lines: (order.line_items ?? []).map((line) => ({
        externalLineId: String(line.id),
        externalVariationId: line.variant_id ? String(line.variant_id) : String(line.id),
        quantity: line.quantity,
        unitPriceCents: this.parsePrice(line.price),
        serviceMode: undefined as ServiceMode | undefined,
      })),
    }));
  }

  async handleWebhook(input: {
    payload: unknown;
    rawBody: string;
    signature: string | null;
    notificationUrl: string;
  }) {
    // Shopify signs every webhook with HMAC-SHA256(rawBody, CLIENT_SECRET)
    // in the `X-Shopify-Hmac-Sha256` header, base64-encoded. Verify
    // BEFORE trusting any field in the payload.
    const verified = this.verifyWebhookHmac(input.rawBody, input.signature);
    if (!verified) {
      return {
        accepted: false,
        message: "Shopify webhook HMAC signature failed verification.",
      };
    }

    const payload =
      input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
        ? (input.payload as Record<string, unknown>)
        : null;

    return {
      accepted: true,
      message: "Shopify webhook payload verified.",
      eventType: null,
      eventId:
        typeof payload?.id === "number" || typeof payload?.id === "string"
          ? String(payload.id)
          : null,
      merchantId: null,
      locationId: null,
    };
  }

  // ---- private helpers ----

  private verifyWebhookHmac(rawBody: string, signature: string | null): boolean {
    if (!signature || !env.SHOPIFY_CLIENT_SECRET) return false;
    const digest = createHmac("sha256", env.SHOPIFY_CLIENT_SECRET)
      .update(rawBody, "utf8")
      .digest("base64");
    const expected = Buffer.from(digest);
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }

  /**
   * Normalise a raw user input like "my-cafe", "my-cafe.myshopify.com",
   * or "https://my-cafe.myshopify.com/admin" into just the bare
   * "my-cafe.myshopify.com" used in every OAuth + API URL.
   */
  private normaliseShopDomain(raw: string | null): string | null {
    if (!raw) return null;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return null;
    const stripped = trimmed
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");
    if (!stripped) return null;
    if (stripped.endsWith(".myshopify.com")) return stripped;
    // Accept bare shop handle: "my-cafe" → "my-cafe.myshopify.com"
    if (/^[a-z0-9][a-z0-9-]*$/.test(stripped)) {
      return `${stripped}.myshopify.com`;
    }
    return null;
  }

  private parsePrice(raw: string | undefined): number | undefined {
    if (!raw) return undefined;
    const num = Number(raw);
    if (!Number.isFinite(num)) return undefined;
    return Math.round(num * 100);
  }

  private requireAccessToken(accessToken?: string | null) {
    if (!accessToken) {
      throw new Error("Shopify access token is required for this operation.");
    }
    return accessToken;
  }
}

/**
 * Utility — same shop-normalisation logic exposed for the callback
 * route so it can use the hmac-verified `shop` querystring param.
 */
export function normaliseShopifyShopDomain(raw: string | null): string | null {
  return new ShopifyProvider()["normaliseShopDomain"](raw);
}

/**
 * Verify Shopify's OAuth redirect-querystring HMAC. This is a
 * different check from webhook HMAC: at OAuth callback, Shopify
 * signs ALL query params (minus `hmac`) with the app secret.
 * The callback route uses this before trusting `shop` or `code`.
 */
export function verifyShopifyOAuthHmac(
  query: URLSearchParams,
  clientSecret: string
): boolean {
  const hmac = query.get("hmac");
  if (!hmac) return false;
  const entries: Array<[string, string]> = [];
  for (const [k, v] of query.entries()) {
    if (k === "hmac" || k === "signature") continue;
    entries.push([k, v]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const message = entries
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const digest = createHmac("sha256", clientSecret)
    .update(message, "utf8")
    .digest("hex");
  const expected = Buffer.from(digest);
  const actual = Buffer.from(hmac);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
