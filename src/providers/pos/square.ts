import { createHmac, timingSafeEqual } from "node:crypto";
import { PosProviderType, ServiceMode } from "@/lib/prisma";

import { env } from "@/lib/env";
import type {
  PosProvider,
  ProviderCatalogItem,
  ProviderModifierHint,
  ProviderSaleEvent,
} from "@/providers/contracts";

type SquareLocation = {
  id: string;
  status?: string;
  name?: string;
};

type SquareMerchant = {
  id: string;
};

type SquareCatalogObject = {
  id: string;
  type: string;
  category_data?: {
    name?: string;
  };
  image_data?: {
    url?: string;
  };
  modifier_list_data?: {
    name?: string;
    selection_type?: "SINGLE" | "MULTIPLE";
    modifiers?: Array<{
      id: string;
      modifier_data?: {
        name?: string;
        price_money?: { amount?: number };
        on_by_default?: boolean;
      };
    }>;
  };
  item_data?: {
    name?: string;
    category_id?: string;
    image_ids?: string[];
    modifier_list_info?: Array<{
      modifier_list_id: string;
      enabled?: boolean;
      min_selected_modifiers?: number;
      max_selected_modifiers?: number;
    }>;
    variations?: Array<{
      id: string;
      item_variation_data?: {
        name?: string;
        sku?: string;
        price_money?: { amount?: number };
      };
    }>;
  };
};

type SquareOrder = {
  id: string;
  state?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  fulfillments?: Array<{ type?: string }>;
  line_items?: Array<{
    uid?: string;
    catalog_object_id?: string;
    quantity?: string;
    base_price_money?: { amount?: number };
    modifiers?: Array<{
      catalog_object_id?: string;
      name?: string;
    }>;
  }>;
};

export class SquareProvider implements PosProvider {
  provider = PosProviderType.SQUARE;

  async connect(input: {
    integrationId: string;
    callbackUrl: string;
    state: string;
    accessToken?: string | null;
  }) {
    const hasOAuth = Boolean(env.SQUARE_CLIENT_ID && env.SQUARE_CLIENT_SECRET);
    const accessToken = input.accessToken ?? env.SQUARE_ACCESS_TOKEN;

    // When OAuth creds are configured, prefer the OAuth redirect flow —
    // that's the "Log in with Square" UX the merchant expects and the
    // only path that supports multi-tenant per-merchant tokens. PAT is
    // the fallback for single-tenant setups where no OAuth app exists.
    if (hasOAuth) {
      const params = new URLSearchParams({
        client_id: env.SQUARE_CLIENT_ID!,
        scope: env.SQUARE_SCOPES,
        state: input.state,
        redirect_uri: input.callbackUrl,
      });

      return {
        status: "redirect_required" as const,
        sandbox: this.isSandbox(),
        authUrl: `${this.getAuthorizeBaseUrl()}?${params.toString()}`,
      };
    }

    if (accessToken) {
      const context = await this.fetchMerchantContext(accessToken);
      return {
        status: "connected" as const,
        sandbox: this.isSandbox(),
        externalMerchantId: context.merchant.id,
        externalLocationId: context.location.id,
        accessToken,
      };
    }

    throw new Error(
      "Square client credentials or a Square access token are not configured."
    );
  }

  async exchangeCode(input: { code: string; callbackUrl: string }) {
    if (!env.SQUARE_CLIENT_ID || !env.SQUARE_CLIENT_SECRET) {
      throw new Error("Square client credentials are not configured.");
    }

    const tokenResponse = await fetch(`${this.getTokenBaseUrl()}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Square-Version": env.SQUARE_API_VERSION,
      },
      body: JSON.stringify({
        client_id: env.SQUARE_CLIENT_ID,
        client_secret: env.SQUARE_CLIENT_SECRET,
        code: input.code,
        grant_type: "authorization_code",
        redirect_uri: input.callbackUrl,
      }),
    });

    const tokenPayload = (await tokenResponse.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      merchant_id?: string;
      message?: string;
      errors?: Array<{ detail?: string }>;
    };

    if (!tokenResponse.ok || !tokenPayload.access_token) {
      throw new Error(
        tokenPayload.errors?.[0]?.detail ??
          tokenPayload.message ??
          "Square OAuth token exchange failed."
      );
    }

    const context = await this.fetchMerchantContext(tokenPayload.access_token);

    return {
      sandbox: this.isSandbox(),
      externalMerchantId: tokenPayload.merchant_id ?? context.merchant.id,
      externalLocationId: context.location.id,
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token,
    };
  }

  /**
   * Exchange a refresh_token for a fresh access_token pair. Square's
   * access tokens live ~30 days; refresh tokens live ~90. Called by
   * the daily cron (`refreshExpiringPosTokens`) so connected merchants
   * don't silently go dead a month after connecting.
   */
  async refreshAccessToken(input: { refreshToken: string }): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt: Date | null;
  }> {
    if (!env.SQUARE_CLIENT_ID || !env.SQUARE_CLIENT_SECRET) {
      throw new Error("Square client credentials are not configured.");
    }

    const response = await fetch(`${this.getTokenBaseUrl()}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Square-Version": env.SQUARE_API_VERSION,
      },
      body: JSON.stringify({
        client_id: env.SQUARE_CLIENT_ID,
        client_secret: env.SQUARE_CLIENT_SECRET,
        refresh_token: input.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: string;
      message?: string;
      errors?: Array<{ detail?: string }>;
    };

    if (!response.ok || !payload.access_token) {
      throw new Error(
        payload.errors?.[0]?.detail ??
          payload.message ??
          `Square token refresh failed with status ${response.status}`
      );
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: payload.expires_at ? new Date(payload.expires_at) : null,
    };
  }

  async syncCatalog(input?: {
    accessToken?: string | null;
    locationId?: string | null;
  }): Promise<ProviderCatalogItem[]> {
    const accessToken = this.requireAccessToken(input?.accessToken);
    const objects = await this.listCatalogObjects(accessToken);
    const categories = new Map(
      objects
        .filter((object) => object.type === "CATEGORY")
        .map((object) => [object.id, object.category_data?.name ?? undefined])
    );
    // Square returns IMAGE objects separately; items reference them
    // by id in item_data.image_ids. Build a lookup once so we can
    // resolve the first image url per item on the fly.
    const imagesById = new Map(
      objects
        .filter((object) => object.type === "IMAGE" && object.image_data?.url)
        .map((object) => [object.id, object.image_data!.url!])
    );
    // MODIFIER_LIST objects are the tree the user cares about —
    // "Milk", "Size", "Syrup". Each item references them via
    // item_data.modifier_list_info[]. Build a normalised hint per
    // list once so we can attach to each item that uses it.
    const modifierHintsById = new Map<string, ProviderModifierHint>();
    for (const obj of objects) {
      if (obj.type !== "MODIFIER_LIST") continue;
      const data = obj.modifier_list_data;
      if (!data?.name) continue;
      const name = data.name.trim();
      const category = slugCategory(name);
      const isSizeGroup = /size|sizes/i.test(name);
      const options = (data.modifiers ?? [])
        .filter((m) => m.modifier_data?.name)
        .map((m) => {
          const label = m.modifier_data!.name!.trim();
          const slug = slugValue(label);
          const sizeScaleFactor = isSizeGroup
            ? inferSizeScale(label)
            : undefined;
          return {
            externalModifierId: m.id,
            label,
            modifierKey: `${category}:${slug}`,
            isDefault: m.modifier_data!.on_by_default === true,
            sizeScaleFactor,
            priceCents: m.modifier_data!.price_money?.amount,
          };
        });
      if (options.length === 0) continue;
      modifierHintsById.set(obj.id, {
        externalModifierListId: obj.id,
        name,
        modifierCategory: category,
        required: false, // per-item enablement carries minimums; keep simple
        isSizeGroup,
        options,
      });
    }

    return objects
      .filter((object) => object.type === "ITEM" && object.item_data?.name)
      .map((item) => {
        const variations =
          item.item_data?.variations?.map((variation) => {
            const variationName = variation.item_variation_data?.name?.trim() || "Default";
            return {
              externalVariationId: variation.id,
              name:
                variationName.toLowerCase() === "regular"
                  ? item.item_data?.name ?? variationName
                  : variationName,
              sizeLabel: inferSizeLabel(variationName),
              serviceMode: inferServiceMode(
                variationName,
                item.item_data?.name ?? variationName
              ),
              priceCents: variation.item_variation_data?.price_money?.amount,
              externalSku: variation.item_variation_data?.sku,
            };
          }) ?? [];

        const firstImageId = item.item_data?.image_ids?.[0];
        const imageUrl = firstImageId ? imagesById.get(firstImageId) : undefined;
        // Attach enabled modifier list hints so the recipe-draft AI
        // can auto-populate choiceGroups[] from the POS tree.
        const modifierHints: ProviderModifierHint[] = [];
        for (const ref of item.item_data?.modifier_list_info ?? []) {
          if (ref.enabled === false) continue;
          const hint = modifierHintsById.get(ref.modifier_list_id);
          if (!hint) continue;
          modifierHints.push({
            ...hint,
            required:
              typeof ref.min_selected_modifiers === "number" &&
              ref.min_selected_modifiers > 0,
          });
        }
        return {
          externalItemId: item.id,
          name: item.item_data?.name ?? "Unnamed item",
          category: item.item_data?.category_id
            ? categories.get(item.item_data.category_id)
            : undefined,
          imageUrl,
          modifierHints: modifierHints.length > 0 ? modifierHints : undefined,
          variations,
        };
      });
  }

  async syncOrders(input?: {
    accessToken?: string | null;
    locationId?: string | null;
  }): Promise<ProviderSaleEvent[]> {
    const accessToken = this.requireAccessToken(input?.accessToken);
    const locationId = input?.locationId ?? env.SQUARE_LOCATION_ID;

    if (!locationId) {
      throw new Error("Square location ID is required to sync orders.");
    }

    const response = await this.squareRequest<{ orders?: SquareOrder[] }>(
      "/orders/search",
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          location_ids: [locationId],
          limit: 50,
          query: {
            sort: {
              sort_field: "CLOSED_AT",
              sort_order: "DESC",
            },
            filter: {
              state_filter: {
                states: ["COMPLETED"],
              },
              date_time_filter: {
                closed_at: {
                  start_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
                },
              },
            },
          },
        }),
      }
    );

    return (response.orders ?? [])
      .filter((order) => (order.line_items?.length ?? 0) > 0)
      .map((order) => ({
        externalOrderId: order.id,
        occurredAt: new Date(
          order.closed_at ?? order.updated_at ?? order.created_at ?? new Date().toISOString()
        ),
        status: order.state ?? "COMPLETED",
        serviceMode: inferOrderServiceMode(order),
        lines:
          order.line_items
            ?.filter((line) => line.catalog_object_id)
            .map((line) => ({
              externalLineId: line.uid ?? `${order.id}-${line.catalog_object_id}`,
              externalVariationId: line.catalog_object_id ?? "",
              quantity: Math.max(1, Math.round(Number(line.quantity ?? "1"))),
              unitPriceCents: line.base_price_money?.amount,
              serviceMode: inferOrderServiceMode(order),
              modifiers: extractLineModifiers(line),
            })) ?? [],
      }));
  }

  async handleWebhook(input: {
    payload: unknown;
    rawBody: string;
    signature: string | null;
    notificationUrl: string;
  }) {
    if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY) {
      return {
        accepted: false,
        message: "Square webhook signature key is not configured.",
      };
    }

    if (!input.signature) {
      return {
        accepted: false,
        message: "Square webhook signature header is missing.",
      };
    }

    const computedSignature = createHmac(
      "sha256",
      env.SQUARE_WEBHOOK_SIGNATURE_KEY
    )
      .update(input.notificationUrl + input.rawBody)
      .digest("base64");

    const expected = Buffer.from(computedSignature);
    const actual = Buffer.from(input.signature);
    const valid =
      expected.length === actual.length && timingSafeEqual(expected, actual);

    return {
      accepted: valid,
      message: valid
        ? "Square webhook signature validated."
        : "Square webhook signature validation failed.",
      eventType: readString(payloadRecord(input.payload), "type"),
      eventId: readString(payloadRecord(input.payload), "event_id"),
      merchantId: readString(payloadRecord(input.payload), "merchant_id"),
      locationId: extractWebhookLocationId(input.payload),
    };
  }

  private async listCatalogObjects(accessToken: string) {
    const objects: SquareCatalogObject[] = [];
    let cursor: string | undefined;

    do {
      const searchParams = new URLSearchParams({
        // Pull IMAGE + MODIFIER_LIST too so catalog sync populates
        // product photos and the modifier tree in one pass.
        types: "ITEM,CATEGORY,IMAGE,MODIFIER_LIST",
      });

      if (cursor) {
        searchParams.set("cursor", cursor);
      }

      const response = await this.squareRequest<{
        objects?: SquareCatalogObject[];
        cursor?: string;
      }>(`/catalog/list?${searchParams.toString()}`, accessToken, {
        method: "GET",
      });

      objects.push(...(response.objects ?? []));
      cursor = response.cursor;
    } while (cursor);

    return objects;
  }

  private async fetchMerchantContext(accessToken: string) {
    const [merchantResponse, locationsResponse] = await Promise.all([
      this.squareRequest<{ merchant?: SquareMerchant }>("/merchants/me", accessToken, {
        method: "GET",
      }),
      this.squareRequest<{ locations?: SquareLocation[] }>("/locations", accessToken, {
        method: "GET",
      }),
    ]);

    const location =
      locationsResponse.locations?.find((entry) => entry.status === "ACTIVE") ??
      locationsResponse.locations?.[0];

    if (!merchantResponse.merchant || !location) {
      throw new Error("Square merchant context could not be resolved.");
    }

    return {
      merchant: merchantResponse.merchant,
      location,
    };
  }

  private async squareRequest<T>(
    path: string,
    accessToken: string,
    init: RequestInit
  ): Promise<T> {
    const response = await fetch(`${this.getApiBaseUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Square-Version": env.SQUARE_API_VERSION,
        ...(init.headers ?? {}),
      },
    });

    const payload = (await response.json().catch(() => ({}))) as T & {
      message?: string;
      errors?: Array<{ detail?: string }>;
    };

    if (!response.ok) {
      throw new Error(
        payload.errors?.[0]?.detail ??
          payload.message ??
          `Square request failed with status ${response.status}`
      );
    }

    return payload;
  }

  private getAuthorizeBaseUrl() {
    // Square's OAuth authorize endpoint lives under the `connect.`
    // subdomain alongside the API, per their current docs. The bare
    // squareup.com variants 404, which means the old code 404'd the
    // "Log in with Square" button the first time it ran.
    return this.isSandbox()
      ? "https://connect.squareupsandbox.com/oauth2/authorize"
      : "https://connect.squareup.com/oauth2/authorize";
  }

  private getApiBaseUrl() {
    return this.isSandbox()
      ? "https://connect.squareupsandbox.com/v2"
      : "https://connect.squareup.com/v2";
  }

  private getTokenBaseUrl() {
    return this.isSandbox()
      ? "https://connect.squareupsandbox.com"
      : "https://connect.squareup.com";
  }

  private requireAccessToken(accessToken?: string | null) {
    const token = accessToken ?? env.SQUARE_ACCESS_TOKEN;
    if (!token) {
      throw new Error("Square access token is required for this operation.");
    }

    return token;
  }

  private isSandbox() {
    return env.SQUARE_ENVIRONMENT === "sandbox";
  }
}

function inferSizeLabel(name: string) {
  const lowerName = name.toLowerCase();
  if (lowerName.includes("small")) return "Small";
  if (lowerName.includes("medium")) return "Medium";
  if (lowerName.includes("large")) return "Large";
  return undefined;
}

/** Map a modifier-list name to the <category> half of modifier keys. */
function slugCategory(name: string): string {
  const lower = name.toLowerCase();
  if (/milk/.test(lower)) return "milk";
  if (/size|sizes/.test(lower)) return "size";
  if (/syrup|flavou?r/.test(lower)) return "syrup";
  if (/shot|espresso/.test(lower)) return "shot";
  if (/temp|iced|hot/.test(lower)) return "temp";
  if (/sweet|sugar/.test(lower)) return "sweet";
  if (/topping|add.?on/.test(lower)) return "topping";
  if (/prep|style/.test(lower)) return "prep";
  return lower.replace(/[^a-z0-9]+/g, "-").slice(0, 32) || "modifier";
}

function slugValue(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Best-effort size-scale inference. Parses "8oz/12oz/16oz/20oz" or
 * "small/medium/large" and returns a multiplier anchored at medium/12oz
 * = 1.0. Used as a starting hint — the user can tweak in chat.
 */
function inferSizeScale(label: string): number | undefined {
  const lower = label.toLowerCase();
  const ozMatch = lower.match(/(\d{1,2})\s*oz/);
  if (ozMatch) {
    const oz = Number(ozMatch[1]);
    if (oz > 0) return oz / 12; // 12oz = 1.0
  }
  if (/xs|extra small/.test(lower)) return 0.67;
  if (/small/.test(lower)) return 0.83;
  if (/medium|reg|regular/.test(lower)) return 1.0;
  if (/large/.test(lower)) return 1.25;
  if (/xl|extra large/.test(lower)) return 1.5;
  return undefined;
}

function inferServiceMode(...candidates: string[]) {
  const joined = candidates.join(" ").toLowerCase();
  if (
    joined.includes("to go") ||
    joined.includes("togo") ||
    joined.includes("takeout") ||
    joined.includes("iced")
  ) {
    return ServiceMode.TO_GO;
  }

  if (joined.includes("dine in") || joined.includes("for here")) {
    return ServiceMode.DINE_IN;
  }

  return ServiceMode.TO_GO;
}

function inferOrderServiceMode(order: SquareOrder) {
  if (order.fulfillments?.some((fulfillment) => fulfillment.type === "PICKUP")) {
    return ServiceMode.TO_GO;
  }

  return ServiceMode.DINE_IN;
}

function extractLineModifiers(line: NonNullable<SquareOrder["line_items"]>[number]) {
  return line.modifiers
    ?.map((modifier) => modifier.catalog_object_id ?? modifier.name)
    .filter((modifier): modifier is string => Boolean(modifier?.trim()))
    .map((modifier) => modifier.trim());
}

function payloadRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown> | null, key: string) {
  return typeof record?.[key] === "string" ? (record[key] as string) : null;
}

function extractWebhookLocationId(payload: unknown) {
  const record = payloadRecord(payload);
  const directLocationId = readString(record, "location_id");
  if (directLocationId) {
    return directLocationId;
  }

  const data = payloadRecord(record?.data);
  const object = payloadRecord(data?.object);
  const locationId =
    readString(object, "location_id") ??
    readString(payloadRecord(object?.order_created), "location_id") ??
    readString(payloadRecord(object?.order_updated), "location_id");

  return locationId ?? null;
}

