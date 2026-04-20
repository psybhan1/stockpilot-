/**
 * StockPilot → Square catalog push. Phase 2: update an existing Square
 * variation that's already mapped to a StockPilot recipe. Updates:
 *
 *   - variation.name  (from recipe.menuItemVariant.name)
 *   - item.description (from recipe.aiSummary, if set)
 *   - variation.price_money (from recipe.salePriceCents, ONLY when
 *     recipe.stockPilotOwnsPrice is true)
 *
 * Flow:
 *   1. Resolve Square access token from the integration.
 *   2. GET the item object (to retrieve the current version + full
 *      data). Square requires sending the latest version on upsert
 *      or it rejects as stale.
 *   3. Build a minimal upsert payload that carries both the item and
 *      its variations (Square upserts the whole item at once).
 *   4. POST to /v2/catalog/object with a fresh idempotency key.
 *   5. Stamp lastPushedToPosAt on the recipe.
 *
 * Errors are returned, not thrown — the caller surfaces them in the
 * UI via the server action's { ok:false, reason } path.
 */

import { randomBytes } from "node:crypto";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { decryptSecret } from "@/lib/secrets";
import { PosProviderType } from "@/lib/prisma";

export type PushResult =
  | { ok: true; pushedFields: string[]; pushedAt: Date }
  | { ok: false; reason: string };

export async function pushRecipeToSquare(input: {
  locationId: string;
  recipeId: string;
}): Promise<PushResult> {
  const recipe = await db.recipe.findFirst({
    where: { id: input.recipeId, locationId: input.locationId },
    include: {
      menuItemVariant: { include: { menuItem: true } },
      mappings: {
        include: {
          posVariation: { include: { catalogItem: true } },
        },
      },
    },
  });
  if (!recipe) return { ok: false, reason: "Recipe not found." };

  const mapping = recipe.mappings.find(
    (m) =>
      m.posVariation.catalogItem.integrationId && m.posVariation.externalId,
  );
  if (!mapping) {
    return {
      ok: false,
      reason:
        "No Square variation linked to this recipe. Map the POS variant first.",
    };
  }

  const integration = await db.posIntegration.findFirst({
    where: {
      id: mapping.posVariation.catalogItem.integrationId,
      provider: PosProviderType.SQUARE,
    },
    select: { accessTokenEncrypted: true },
  });
  if (!integration) {
    return { ok: false, reason: "Square integration not connected." };
  }
  const token = resolveToken(integration.accessTokenEncrypted);
  if (!token) {
    return {
      ok: false,
      reason: "No Square access token — reconnect Square from Settings.",
    };
  }

  const itemExternalId = mapping.posVariation.catalogItem.externalId;
  const variationExternalId = mapping.posVariation.externalId;

  // Step 1: retrieve the item to get its current version + full shape.
  // Square rejects upserts sent with a stale version.
  const retrieveUrl = `${getApiBase()}/catalog/object/${itemExternalId}`;
  const retrieveRes = await fetch(retrieveUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Square-Version": env.SQUARE_API_VERSION,
      "Content-Type": "application/json",
    },
  });
  if (!retrieveRes.ok) {
    const text = await retrieveRes.text().catch(() => "");
    return {
      ok: false,
      reason: `Square retrieve failed (${retrieveRes.status}): ${text.slice(0, 200)}`,
    };
  }
  const retrieved = (await retrieveRes.json()) as {
    object?: SquareItemObject;
  };
  const current = retrieved.object;
  if (!current || current.type !== "ITEM" || !current.item_data) {
    return { ok: false, reason: "Square object is not an ITEM." };
  }

  // Step 2: build the upsert payload.
  const pushedFields: string[] = [];
  const newName = recipe.menuItemVariant.name;
  const newDescription = recipe.aiSummary ?? "";

  const itemData: SquareItemData = {
    ...current.item_data,
    name: newName,
    description: newDescription || current.item_data.description,
  };
  if (newName !== current.item_data.name) pushedFields.push("name");
  if (newDescription && newDescription !== current.item_data.description)
    pushedFields.push("description");

  const updatedVariations = (current.item_data.variations ?? []).map((v) => {
    if (v.id !== variationExternalId) return v;
    // Only push price when StockPilot owns it AND a sale price is set.
    if (
      recipe.stockPilotOwnsPrice &&
      recipe.salePriceCents &&
      recipe.salePriceCents > 0
    ) {
      pushedFields.push("price");
      return {
        ...v,
        item_variation_data: {
          ...v.item_variation_data,
          pricing_type: "FIXED_PRICING" as const,
          price_money: {
            amount: recipe.salePriceCents,
            currency:
              v.item_variation_data?.price_money?.currency || "USD",
          },
        },
      };
    }
    return v;
  });
  itemData.variations = updatedVariations;

  if (pushedFields.length === 0) {
    return {
      ok: false,
      reason: "Nothing to push — Square already matches StockPilot.",
    };
  }

  const upsertPayload = {
    idempotency_key: randomBytes(16).toString("hex"),
    object: {
      type: "ITEM",
      id: current.id,
      version: current.version,
      item_data: itemData,
    },
  };

  const upsertRes = await fetch(`${getApiBase()}/catalog/object`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Square-Version": env.SQUARE_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(upsertPayload),
  });
  if (!upsertRes.ok) {
    const text = await upsertRes.text().catch(() => "");
    return {
      ok: false,
      reason: `Square upsert failed (${upsertRes.status}): ${text.slice(0, 200)}`,
    };
  }

  const now = new Date();
  await db.recipe.update({
    where: { id: recipe.id },
    data: { lastPushedToPosAt: now },
  });

  return { ok: true, pushedFields, pushedAt: now };
}

function resolveToken(encrypted: string | null): string | null {
  const hasOAuth = Boolean(env.SQUARE_CLIENT_ID && env.SQUARE_CLIENT_SECRET);
  if (hasOAuth) {
    if (encrypted) return decryptSecret(encrypted);
    return env.SQUARE_ACCESS_TOKEN ?? null;
  }
  if (env.SQUARE_ACCESS_TOKEN) return env.SQUARE_ACCESS_TOKEN;
  if (encrypted) return decryptSecret(encrypted);
  return null;
}

function getApiBase() {
  return env.SQUARE_ENVIRONMENT === "sandbox"
    ? "https://connect.squareupsandbox.com/v2"
    : "https://connect.squareup.com/v2";
}

// ── Square API shapes (narrow to what we touch) ────────────────────

type SquareVariationObject = {
  type: "ITEM_VARIATION";
  id: string;
  version?: number;
  item_variation_data?: {
    item_id?: string;
    name?: string;
    sku?: string;
    pricing_type?: "FIXED_PRICING" | "VARIABLE_PRICING";
    price_money?: { amount?: number; currency?: string };
  };
};

type SquareItemData = {
  name?: string;
  description?: string;
  category_id?: string;
  image_ids?: string[];
  variations?: SquareVariationObject[];
  [k: string]: unknown;
};

type SquareItemObject = {
  type: string;
  id: string;
  version?: number;
  item_data?: SquareItemData;
};
