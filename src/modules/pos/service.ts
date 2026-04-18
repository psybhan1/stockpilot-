import {
  IntegrationStatus,
  JobStatus,
  MappingStatus,
  PosProviderType,
  PosSyncType,
  RecipeStatus,
} from "@/lib/prisma";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@/lib/prisma";

import { createAuditLogTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { processSaleEventById } from "@/modules/inventory/ledger";
import { enqueueJob, enqueueJobTx } from "@/modules/jobs/dispatcher";
import { getAiProvider } from "@/providers/ai-provider";
import type { ProviderCatalogItem } from "@/providers/contracts";
import { CloverProvider } from "@/providers/pos/clover";
import { getPosProvider } from "@/providers/pos-provider";

function getSquareCallbackUrl() {
  return `${env.APP_URL.replace(/\/$/, "")}/api/integrations/square/callback`;
}

function getCloverCallbackUrl() {
  return `${env.APP_URL.replace(/\/$/, "")}/api/integrations/clover/callback`;
}

function getStoredAccessToken(accessTokenEncrypted?: string | null) {
  // Mode detection:
  // - OAuth mode (CLIENT_ID+SECRET set): per-tenant token lives in DB.
  //   DB wins because each merchant has their own token from the
  //   OAuth callback — env has no meaningful fallback here.
  // - PAT mode (only ACCESS_TOKEN set): env wins so admins can rotate
  //   by editing Railway alone; stale encrypted DB copies don't override.
  const hasOAuth = Boolean(env.SQUARE_CLIENT_ID && env.SQUARE_CLIENT_SECRET);

  if (hasOAuth) {
    if (accessTokenEncrypted) {
      return decryptSecret(accessTokenEncrypted);
    }
    return env.SQUARE_ACCESS_TOKEN ?? null;
  }

  if (env.SQUARE_ACCESS_TOKEN) {
    return env.SQUARE_ACCESS_TOKEN;
  }
  if (accessTokenEncrypted) {
    return decryptSecret(accessTokenEncrypted);
  }

  return null;
}

export async function ensureSquareIntegration(locationId: string, userId: string) {
  const provider = getPosProvider();
  const existing = await db.posIntegration.findFirst({
    where: {
      locationId,
      provider: PosProviderType.SQUARE,
    },
    select: {
      id: true,
      accessTokenEncrypted: true,
    },
  });

  const integration = existing
    ? await db.posIntegration.update({
        where: { id: existing.id },
        data: {
          status: IntegrationStatus.CONNECTING,
        },
      })
    : await db.posIntegration.create({
        data: {
          locationId,
          provider: PosProviderType.SQUARE,
          status: IntegrationStatus.CONNECTING,
        },
      });

  const state = `${integration.id}.${randomBytes(16).toString("hex")}`;
  const result = await provider.connect({
    integrationId: integration.id,
    callbackUrl: getSquareCallbackUrl(),
    state,
    accessToken: getStoredAccessToken(existing?.accessTokenEncrypted),
  });

  if (result.status === "redirect_required" && result.authUrl) {
    await db.posIntegration.update({
      where: { id: integration.id },
      data: {
        status: IntegrationStatus.CONNECTING,
        sandbox: result.sandbox,
        settings: {
          oauthState: state,
        },
      },
    });

    await db.$transaction(async (tx) => {
      await createAuditLogTx(tx, {
        locationId,
        userId,
        action: "integration.square.oauth_started",
        entityType: "posIntegration",
        entityId: integration.id,
      });
    });

    return {
      integration,
      requiresRedirect: true,
      authUrl: result.authUrl,
    };
  }

  const updatedIntegration = await db.posIntegration.update({
    where: { id: integration.id },
    data: {
      status: IntegrationStatus.CONNECTED,
      sandbox: result.sandbox,
      externalMerchantId: result.externalMerchantId,
      externalLocationId: result.externalLocationId ?? env.SQUARE_LOCATION_ID,
      accessTokenEncrypted: result.accessToken
        ? encryptSecret(result.accessToken)
        : existing?.accessTokenEncrypted,
      refreshTokenEncrypted: result.refreshToken
        ? encryptSecret(result.refreshToken)
        : undefined,
      settings: {
        oauthState: null,
        connectedVia: result.accessToken ? "token" : "oauth",
      },
      lastSyncedAt: new Date(),
    },
  });

  await db.$transaction(async (tx) => {
    await createAuditLogTx(tx, {
      locationId,
      userId,
      action: "integration.square.connected",
      entityType: "posIntegration",
      entityId: updatedIntegration.id,
    });
  });

  await enqueueJob({
    locationId,
    type: "SYNC_CATALOG",
    payload: { integrationId: updatedIntegration.id, userId },
  });

  return {
    integration: updatedIntegration,
    requiresRedirect: false,
  };
}

export async function completeSquareOAuth(input: {
  integrationId: string;
  state: string;
  code: string;
}) {
  const integration = await db.posIntegration.findUniqueOrThrow({
    where: {
      id: input.integrationId,
    },
  });

  const expectedState =
    integration.settings &&
    typeof integration.settings === "object" &&
    !Array.isArray(integration.settings)
      ? (integration.settings as Record<string, unknown>).oauthState
      : null;

  if (!expectedState || expectedState !== input.state) {
    throw new Error("Square OAuth state could not be verified.");
  }

  const provider = getPosProvider();

  if (!provider.exchangeCode) {
    throw new Error("Current POS provider does not support OAuth callbacks.");
  }

  const result = await provider.exchangeCode({
    code: input.code,
    callbackUrl: getSquareCallbackUrl(),
  });

  const updatedIntegration = await db.posIntegration.update({
    where: { id: integration.id },
    data: {
      status: IntegrationStatus.CONNECTED,
      sandbox: result.sandbox,
      externalMerchantId: result.externalMerchantId,
      externalLocationId: result.externalLocationId,
      accessTokenEncrypted: encryptSecret(result.accessToken),
      refreshTokenEncrypted: result.refreshToken
        ? encryptSecret(result.refreshToken)
        : undefined,
      settings: {
        oauthState: null,
        connectedVia: "oauth",
      },
      lastSyncedAt: new Date(),
    },
  });

  await enqueueJob({
    locationId: integration.locationId,
    type: "SYNC_CATALOG",
    payload: { integrationId: integration.id },
  });

  await db.$transaction(async (tx) => {
    await createAuditLogTx(tx, {
      locationId: integration.locationId,
      action: "integration.square.oauth_connected",
      entityType: "posIntegration",
      entityId: integration.id,
      details: {
        externalMerchantId: updatedIntegration.externalMerchantId,
        externalLocationId: updatedIntegration.externalLocationId,
      },
    });
  });

  return updatedIntegration;
}

// ---- Clover ---------------------------------------------------------

/**
 * Clover-specific integration initialisation. Mirrors the Square path
 * but uses CloverProvider directly (rather than going through
 * getPosProvider, which picks Square based on env vars). Each POS
 * keeps its own PosIntegration row keyed by (locationId, provider).
 */
export async function ensureCloverIntegration(
  locationId: string,
  userId: string
) {
  if (!env.CLOVER_CLIENT_ID || !env.CLOVER_CLIENT_SECRET) {
    throw new Error(
      "Clover isn't configured. Set CLOVER_CLIENT_ID and CLOVER_CLIENT_SECRET on the server."
    );
  }

  const provider = new CloverProvider();
  const existing = await db.posIntegration.findFirst({
    where: {
      locationId,
      provider: PosProviderType.CLOVER,
    },
    select: {
      id: true,
      accessTokenEncrypted: true,
    },
  });

  const integration = existing
    ? await db.posIntegration.update({
        where: { id: existing.id },
        data: { status: IntegrationStatus.CONNECTING },
      })
    : await db.posIntegration.create({
        data: {
          locationId,
          provider: PosProviderType.CLOVER,
          status: IntegrationStatus.CONNECTING,
        },
      });

  const state = `${integration.id}.${randomBytes(16).toString("hex")}`;
  const result = await provider.connect({
    integrationId: integration.id,
    callbackUrl: getCloverCallbackUrl(),
    state,
    accessToken: existing?.accessTokenEncrypted
      ? decryptSecret(existing.accessTokenEncrypted)
      : null,
  });

  if (result.status === "redirect_required" && result.authUrl) {
    await db.posIntegration.update({
      where: { id: integration.id },
      data: {
        status: IntegrationStatus.CONNECTING,
        sandbox: result.sandbox,
        settings: { oauthState: state },
      },
    });

    await db.$transaction(async (tx) => {
      await createAuditLogTx(tx, {
        locationId,
        userId,
        action: "integration.clover.oauth_started",
        entityType: "posIntegration",
        entityId: integration.id,
      });
    });

    return {
      integration,
      requiresRedirect: true,
      authUrl: result.authUrl,
    };
  }

  const updated = await db.posIntegration.update({
    where: { id: integration.id },
    data: {
      status: IntegrationStatus.CONNECTED,
      sandbox: result.sandbox,
      externalMerchantId: result.externalMerchantId,
      // Clover merchant IS the location — no separate locationId concept.
      externalLocationId: result.externalMerchantId,
      accessTokenEncrypted: result.accessToken
        ? encryptSecret(result.accessToken)
        : existing?.accessTokenEncrypted,
      settings: { oauthState: null, connectedVia: "oauth" },
      lastSyncedAt: new Date(),
    },
  });

  await enqueueJob({
    locationId,
    type: "SYNC_CATALOG",
    payload: { integrationId: updated.id, userId },
  });

  return { integration: updated, requiresRedirect: false };
}

export async function completeCloverOAuth(input: {
  integrationId: string;
  state: string;
  code: string;
  merchantId: string;
}) {
  const integration = await db.posIntegration.findUniqueOrThrow({
    where: { id: input.integrationId },
  });

  const expectedState =
    integration.settings &&
    typeof integration.settings === "object" &&
    !Array.isArray(integration.settings)
      ? (integration.settings as Record<string, unknown>).oauthState
      : null;

  if (!expectedState || expectedState !== input.state) {
    throw new Error("Clover OAuth state could not be verified.");
  }

  const provider = new CloverProvider();
  const result = await provider.exchangeCode({
    code: input.code,
    callbackUrl: getCloverCallbackUrl(),
  });

  const updated = await db.posIntegration.update({
    where: { id: integration.id },
    data: {
      status: IntegrationStatus.CONNECTED,
      sandbox: result.sandbox,
      // Clover's token exchange doesn't return merchant_id — it comes
      // from the callback querystring, passed in as input.merchantId.
      externalMerchantId: input.merchantId,
      externalLocationId: input.merchantId,
      accessTokenEncrypted: encryptSecret(result.accessToken),
      refreshTokenEncrypted: result.refreshToken
        ? encryptSecret(result.refreshToken)
        : undefined,
      settings: { oauthState: null, connectedVia: "oauth" },
      lastSyncedAt: new Date(),
    },
  });

  await enqueueJob({
    locationId: integration.locationId,
    type: "SYNC_CATALOG",
    payload: { integrationId: integration.id },
  });

  await db.$transaction(async (tx) => {
    await createAuditLogTx(tx, {
      locationId: integration.locationId,
      action: "integration.clover.oauth_connected",
      entityType: "posIntegration",
      entityId: integration.id,
      details: { externalMerchantId: updated.externalMerchantId },
    });
  });

  return updated;
}

export async function syncCatalog(integrationId: string, userId?: string | null) {
  const provider = getPosProvider();
  const ai = getAiProvider();
  const integration = await db.posIntegration.findUniqueOrThrow({
    where: {
      id: integrationId,
    },
  });
  const catalog = await provider.syncCatalog({
    accessToken: getStoredAccessToken(integration.accessTokenEncrypted),
    locationId: integration.externalLocationId,
  });

  const syncRun = await db.posSyncRun.create({
    data: {
      integrationId,
      syncType: "CATALOG",
      status: JobStatus.RUNNING,
    },
  });

  let recordsProcessed = 0;

  await db.$transaction(async (tx) => {
    const inventoryItems = await tx.inventoryItem.findMany({
      where: {
        locationId: integration.locationId,
      },
      select: {
        id: true,
        sku: true,
      },
    });

    for (const item of catalog) {
      recordsProcessed += 1;

      const posItem = await tx.posCatalogItem.upsert({
        where: {
          integrationId_externalId: {
            integrationId,
            externalId: item.externalItemId,
          },
        },
        update: {
          name: item.name,
          category: item.category,
          imageUrl: item.imageUrl,
          rawData: item,
        },
        create: {
          integrationId,
          externalId: item.externalItemId,
          name: item.name,
          category: item.category,
          imageUrl: item.imageUrl,
          rawData: item,
        },
      });

      const menuItem = await resolveMenuItemForCatalogItemTx(tx, {
        locationId: integration.locationId,
        posItemId: posItem.id,
        item,
      });

      for (const variation of item.variations) {
        const posVariation = await tx.posCatalogVariation.upsert({
          where: {
            catalogItemId_externalId: {
              catalogItemId: posItem.id,
              externalId: variation.externalVariationId,
            },
          },
          update: {
            name: variation.name,
            sizeLabel: variation.sizeLabel,
            serviceMode: variation.serviceMode,
            priceCents: variation.priceCents,
            externalSku: variation.externalSku,
            rawData: variation,
          },
          create: {
            catalogItemId: posItem.id,
            externalId: variation.externalVariationId,
            name: variation.name,
            sizeLabel: variation.sizeLabel,
            serviceMode: variation.serviceMode,
            priceCents: variation.priceCents,
            externalSku: variation.externalSku,
            rawData: variation,
          },
        });

        const existingMapping = await tx.posVariationMapping.findUnique({
          where: {
            posVariationId: posVariation.id,
          },
          include: {
            menuItemVariant: true,
            recipe: true,
          },
        });

        const menuItemVariant = existingMapping?.menuItemVariant
          ? await tx.menuItemVariant.update({
              where: { id: existingMapping.menuItemVariant.id },
              data: {
                serviceMode: variation.serviceMode,
                sizeLabel: variation.sizeLabel,
                externalSku: variation.externalSku,
              },
            })
          : await tx.menuItemVariant.create({
              data: {
                menuItemId: menuItem.id,
                name: variation.name,
                serviceMode: variation.serviceMode,
                sizeLabel: variation.sizeLabel,
                externalSku: variation.externalSku,
              },
            });

        const existingRecipe =
          existingMapping?.recipe ??
          (await tx.recipe.findFirst({
            where: {
              menuItemVariantId: menuItemVariant.id,
            },
            orderBy: {
              version: "desc",
            },
          }));

        let recipeId = existingRecipe?.id;
        let mappingStatus: MappingStatus = MappingStatus.NEEDS_REVIEW;

        if (!existingRecipe) {
          const suggestion = await ai.suggestRecipe({
            menuItemName: item.name,
            variationName: variation.name,
            serviceMode: variation.serviceMode,
          });

          // Auto-approve high-confidence recipes so a brand-new café
          // starts depleting inventory on its first sale — not after
          // the owner has manually reviewed every drink. Low-confidence
          // suggestions still land in DRAFT for review (safer when AI
          // isn't sure). Owners can edit any auto-approved recipe from
          // the /recipes page; mis-estimates will surface as shrinkage
          // and can be corrected without data loss.
          const autoApprove = suggestion.confidenceScore >= 0.75;

          const recipe = await tx.recipe.create({
            data: {
              locationId: integration.locationId,
              menuItemVariantId: menuItemVariant.id,
              version: 1,
              status: autoApprove ? RecipeStatus.APPROVED : RecipeStatus.DRAFT,
              aiSuggestedBy: env.DEFAULT_AI_PROVIDER,
              aiSummary: suggestion.summary,
              confidenceScore: suggestion.confidenceScore,
              completenessScore: 0.88,
              approvedAt: autoApprove ? new Date() : null,
            },
          });

          recipeId = recipe.id;
          mappingStatus = autoApprove
            ? MappingStatus.READY
            : MappingStatus.RECIPE_DRAFT;

          await createAuditLogTx(tx, {
            locationId: integration.locationId,
            userId: userId ?? undefined,
            action: autoApprove
              ? "recipe.ai_auto_approved"
              : "recipe.ai_suggested_draft",
            entityType: "recipe",
            entityId: recipe.id,
            details: {
              confidenceScore: suggestion.confidenceScore,
              menuItem: item.name,
              variation: variation.name,
              componentCount: suggestion.components.length,
            },
          });

          for (const component of suggestion.components) {
            const inventory = inventoryItems.find(
              (entry) => entry.sku === component.inventorySku
            );

            if (!inventory) {
              continue;
            }

            await tx.recipeComponent.create({
              data: {
                recipeId: recipe.id,
                inventoryItemId: inventory.id,
                componentType: component.componentType,
                quantityBase: component.quantityBase,
                displayUnit: component.displayUnit,
                suggestedMinBase: component.suggestedMinBase,
                suggestedMaxBase: component.suggestedMaxBase,
                confidenceScore: component.confidenceScore,
                conditionServiceMode: component.conditionServiceMode,
                optional: component.optional ?? false,
                notes: component.notes,
              },
            });
          }
        } else {
          mappingStatus =
            existingRecipe.status === RecipeStatus.APPROVED
              ? MappingStatus.READY
              : MappingStatus.RECIPE_DRAFT;
        }

        await tx.posVariationMapping.upsert({
          where: {
            posVariationId: posVariation.id,
          },
          update: {
            menuItemVariantId: menuItemVariant.id,
            recipeId,
            mappingStatus,
            packagingMode: variation.serviceMode,
          },
          create: {
            locationId: integration.locationId,
            posVariationId: posVariation.id,
            menuItemVariantId: menuItemVariant.id,
            recipeId,
            mappingStatus,
            packagingMode: variation.serviceMode,
          },
        });
      }
    }

    await tx.posIntegration.update({
      where: { id: integrationId },
      data: { lastSyncedAt: new Date() },
    });

    await tx.posSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: JobStatus.COMPLETED,
        recordsProcessed,
        completedAt: new Date(),
      },
    });

    await createAuditLogTx(tx, {
      locationId: integration.locationId,
      userId: userId ?? undefined,
      action: "integration.square.catalog_synced",
      entityType: "posIntegration",
      entityId: integrationId,
      details: { recordsProcessed },
    });
  }, {
    // Real Square catalogs can have dozens to hundreds of items, and
    // each one triggers an AI recipe suggestion call. Default 5s
    // transaction timeout blows up on anything non-trivial. 60s gives
    // headroom for realistic café menus. Larger catalogs should
    // still be chunked — that's a follow-up.
    maxWait: 30_000,
    timeout: 60_000,
  });
}

export async function importSampleSales(integrationId: string, userId?: string | null) {
  const provider = getPosProvider();
  const integration = await db.posIntegration.findUniqueOrThrow({
    where: {
      id: integrationId,
    },
  });
  const saleEvents = await provider.syncOrders({
    accessToken: getStoredAccessToken(integration.accessTokenEncrypted),
    locationId: integration.externalLocationId,
  });

  for (const event of saleEvents) {
    const createdEvent = await db.posSaleEvent.upsert({
      where: {
        integrationId_externalOrderId: {
          integrationId,
          externalOrderId: event.externalOrderId,
        },
      },
      update: {
        status: event.status,
        serviceMode: event.serviceMode,
        rawData: event,
      },
      create: {
        locationId: integration.locationId,
        integrationId,
        externalOrderId: event.externalOrderId,
        status: event.status,
        source: PosProviderType.SQUARE,
        serviceMode: event.serviceMode,
        rawData: event,
        occurredAt: event.occurredAt,
      },
    });

    for (const line of event.lines) {
      const posVariation = await db.posCatalogVariation.findFirst({
        where: {
          externalId: line.externalVariationId,
          catalogItem: {
            integrationId,
          },
        },
        include: {
          mappings: true,
        },
      });

      await db.posSaleLine.upsert({
        where: {
          saleEventId_externalLineId: {
            saleEventId: createdEvent.id,
            externalLineId: line.externalLineId,
          },
        },
        update: {
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          posVariationId: posVariation?.id,
          menuItemVariantId: posVariation?.mappings[0]?.menuItemVariantId,
          serviceMode: line.serviceMode,
          modifierKeys: line.modifiers ?? undefined,
          rawData: line,
        },
        create: {
          saleEventId: createdEvent.id,
          externalLineId: line.externalLineId,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          posVariationId: posVariation?.id,
          menuItemVariantId: posVariation?.mappings[0]?.menuItemVariantId,
          serviceMode: line.serviceMode,
          modifierKeys: line.modifiers ?? undefined,
          rawData: line,
        },
      });
    }

    await processSaleEventById(createdEvent.id, userId ?? undefined);
  }

  await db.$transaction(async (tx) => {
    await createAuditLogTx(tx, {
      locationId: integration.locationId,
      userId: userId ?? undefined,
      action: "integration.square.sales_synced",
      entityType: "posIntegration",
      entityId: integrationId,
      details: { saleEvents: saleEvents.length },
    });
  });
}

export async function queueSquareWebhookSyncs(input: {
  eventType?: string | null;
  eventId?: string | null;
  merchantId?: string | null;
  locationId?: string | null;
}) {
  const jobType = getSquareWebhookJobType(input.eventType);

  if (!jobType) {
    return {
      enqueued: false,
      matchedIntegrations: 0,
      message: "Square webhook did not map to a syncable event type.",
    };
  }

  const integrations = await db.posIntegration.findMany({
    where: {
      provider: PosProviderType.SQUARE,
      status: IntegrationStatus.CONNECTED,
      AND: [
        ...(input.merchantId
          ? [
              {
                OR: [
                  { externalMerchantId: input.merchantId },
                  { externalMerchantId: null },
                ],
              },
            ]
          : []),
        ...(input.locationId
          ? [
              {
                OR: [
                  { externalLocationId: input.locationId },
                  { externalLocationId: null },
                ],
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      locationId: true,
    },
  });

  if (integrations.length === 0) {
    return {
      enqueued: false,
      matchedIntegrations: 0,
      message: "Square webhook validated, but no connected integrations matched it.",
    };
  }

  await db.$transaction(async (tx) => {
    for (const integration of integrations) {
      await tx.posSyncRun.create({
        data: {
          integrationId: integration.id,
          syncType: PosSyncType.WEBHOOK,
          status: JobStatus.COMPLETED,
          details: {
            eventType: input.eventType ?? null,
            eventId: input.eventId ?? null,
            merchantId: input.merchantId ?? null,
            locationId: input.locationId ?? null,
            queuedJobType: jobType,
          },
          completedAt: new Date(),
        },
      });

      await enqueueJobTx(tx, {
        locationId: integration.locationId,
        type: jobType,
        payload: {
          integrationId: integration.id,
          webhookEventType: input.eventType ?? null,
          webhookEventId: input.eventId ?? null,
        },
      });

      await createAuditLogTx(tx, {
        locationId: integration.locationId,
        action: "integration.square.webhook_received",
        entityType: "posIntegration",
        entityId: integration.id,
        details: {
          eventType: input.eventType ?? null,
          eventId: input.eventId ?? null,
          merchantId: input.merchantId ?? null,
          locationId: input.locationId ?? null,
          queuedJobType: jobType,
        },
      });
    }
  });

  return {
    enqueued: true,
    matchedIntegrations: integrations.length,
    jobType,
    message: `Queued ${jobType.toLowerCase().replaceAll("_", " ")} for ${integrations.length} integration${integrations.length === 1 ? "" : "s"}.`,
  };
}

import { getSquareWebhookJobType } from "./square-webhook";
export { getSquareWebhookJobType } from "./square-webhook";

/**
 * Disconnect a POS integration. Flips status to DISCONNECTED, clears
 * the access + refresh tokens, and best-effort revokes the token at
 * the vendor (Square has /oauth2/revoke; Clover has no public revoke,
 * so we let it expire naturally).
 *
 * We deliberately DON'T delete the PosIntegration row — PosSaleEvent,
 * PosCatalogItem, and PosSimpleMapping all relate back to it, and
 * deleting would nuke historical sales data. Next time the merchant
 * clicks Connect, ensureSquare/CloverIntegration re-uses the same
 * row and flips it back to CONNECTED without losing anything.
 */
export async function disconnectPosIntegration(input: {
  locationId: string;
  provider: PosProviderType;
  userId: string;
}): Promise<{ ok: true; revokedAtVendor: boolean }> {
  const integration = await db.posIntegration.findFirst({
    where: {
      locationId: input.locationId,
      provider: input.provider,
    },
    select: {
      id: true,
      accessTokenEncrypted: true,
    },
  });

  if (!integration) {
    return { ok: true, revokedAtVendor: false };
  }

  let revokedAtVendor = false;

  // Best-effort vendor-side revoke. If it fails, we still disconnect
  // locally — the merchant expects the button to "do what it says."
  if (integration.accessTokenEncrypted) {
    try {
      const accessToken = decryptSecret(integration.accessTokenEncrypted);
      if (input.provider === PosProviderType.SQUARE) {
        if (env.SQUARE_CLIENT_ID) {
          const revokeBase =
            env.SQUARE_ENVIRONMENT === "production"
              ? "https://connect.squareup.com"
              : "https://connect.squareupsandbox.com";
          const response = await fetch(`${revokeBase}/oauth2/revoke`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Client ${env.SQUARE_CLIENT_SECRET ?? ""}`,
              "Square-Version": env.SQUARE_API_VERSION,
            },
            body: JSON.stringify({
              client_id: env.SQUARE_CLIENT_ID,
              access_token: accessToken,
            }),
          });
          revokedAtVendor = response.ok;
        }
      }
      // Clover: no public revoke endpoint — token will die on its
      // own at the expiration stored when exchangeCode ran. Merchants
      // can uninstall from Clover's "My Apps" dashboard if they want
      // to fully sever the connection at Clover's side.
    } catch {
      // Swallow — we still want the local disconnect to succeed.
    }
  }

  await db.posIntegration.update({
    where: { id: integration.id },
    data: {
      status: IntegrationStatus.DISCONNECTED,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      settings: { oauthState: null },
    },
  });

  await db.$transaction(async (tx) => {
    await createAuditLogTx(tx, {
      locationId: input.locationId,
      userId: input.userId,
      action: `integration.${input.provider.toLowerCase()}.disconnected`,
      entityType: "posIntegration",
      entityId: integration.id,
      details: { revokedAtVendor },
    });
  });

  return { ok: true, revokedAtVendor };
}

/**
 * Clean up PosIntegration rows stuck in CONNECTING. Happens when a
 * merchant opens the Square/Clover OAuth popup, then closes it before
 * clicking Allow — the row stays in CONNECTING forever, making the
 * /settings UI lie about state and blocking fresh connects from
 * appearing correctly.
 *
 * Rules:
 *   - Only delete rows with NO access token AND no externalMerchantId
 *     (i.e. purely abandoned OAuth attempts). Rows that DID connect
 *     once and simply have a stale re-connect attempt in progress
 *     keep their credentials and get reverted to CONNECTED.
 *   - Only act on rows older than 30 minutes so a slow real-OAuth
 *     (merchant typing password) never trips the cleanup.
 */
export async function cleanupStaleConnectingPosIntegrations(): Promise<{
  deleted: number;
  reverted: number;
}> {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  const stale = await db.posIntegration.findMany({
    where: {
      status: IntegrationStatus.CONNECTING,
      updatedAt: { lt: cutoff },
    },
    select: {
      id: true,
      accessTokenEncrypted: true,
      externalMerchantId: true,
    },
  });

  let deleted = 0;
  let reverted = 0;

  for (const row of stale) {
    if (!row.accessTokenEncrypted && !row.externalMerchantId) {
      await db.posIntegration.delete({ where: { id: row.id } });
      deleted += 1;
    } else {
      await db.posIntegration.update({
        where: { id: row.id },
        data: { status: IntegrationStatus.CONNECTED },
      });
      reverted += 1;
    }
  }

  return { deleted, reverted };
}

/**
 * Daily-ish token refresh sweep.
 *
 * Square access tokens live ~30 days; Clover tokens live up to a year
 * but their refresh tokens expire 60 days after the access token. So
 * we refresh every CONNECTED integration every time this runs — the
 * vendors handle the "no change if not needed" case for us, and the
 * cost is two HTTP requests per integration per day.
 *
 * Called from the in-process worker loop on a 12h interval. Safe to
 * re-run: each provider's refresh endpoint is idempotent for the
 * current refresh_token, and we only update the DB on success.
 */
export async function refreshExpiringPosTokens(): Promise<{
  scanned: number;
  refreshed: number;
  failed: number;
  details: Array<{
    integrationId: string;
    provider: string;
    outcome: "ok" | "no-refresh-token" | "error";
    error?: string;
  }>;
}> {
  const integrations = await db.posIntegration.findMany({
    where: { status: IntegrationStatus.CONNECTED },
    select: {
      id: true,
      provider: true,
      refreshTokenEncrypted: true,
    },
  });

  let refreshed = 0;
  let failed = 0;
  const details: Array<{
    integrationId: string;
    provider: string;
    outcome: "ok" | "no-refresh-token" | "error";
    error?: string;
  }> = [];

  for (const integration of integrations) {
    if (!integration.refreshTokenEncrypted) {
      details.push({
        integrationId: integration.id,
        provider: integration.provider,
        outcome: "no-refresh-token",
      });
      continue;
    }

    try {
      const refreshToken = decryptSecret(integration.refreshTokenEncrypted);
      let result: {
        accessToken: string;
        refreshToken?: string;
        expiresAt: Date | null;
      };

      if (integration.provider === PosProviderType.SQUARE) {
        const { SquareProvider } = await import("@/providers/pos/square");
        result = await new SquareProvider().refreshAccessToken({ refreshToken });
      } else if (integration.provider === PosProviderType.CLOVER) {
        result = await new CloverProvider().refreshAccessToken({ refreshToken });
      } else {
        // Other providers don't have refresh methods yet — skip.
        details.push({
          integrationId: integration.id,
          provider: integration.provider,
          outcome: "no-refresh-token",
        });
        continue;
      }

      await db.posIntegration.update({
        where: { id: integration.id },
        data: {
          accessTokenEncrypted: encryptSecret(result.accessToken),
          refreshTokenEncrypted: result.refreshToken
            ? encryptSecret(result.refreshToken)
            : undefined,
        },
      });
      refreshed += 1;
      details.push({
        integrationId: integration.id,
        provider: integration.provider,
        outcome: "ok",
      });
    } catch (err) {
      failed += 1;
      details.push({
        integrationId: integration.id,
        provider: integration.provider,
        outcome: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { scanned: integrations.length, refreshed, failed, details };
}

/**
 * Clover webhook → job enqueue. Same shape as queueSquareWebhookSyncs
 * but scoped to CLOVER integrations. The event-type mapping already
 * happened upstream (extractCloverEvents), so `eventType` here is
 * already our internal "SYNC_CATALOG" | "SYNC_SALES" enum.
 */
export async function queueCloverWebhookSyncs(input: {
  eventType?: string | null;
  eventId?: string | null;
  merchantId?: string | null;
  locationId?: string | null;
}) {
  const jobType =
    input.eventType === "SYNC_CATALOG" || input.eventType === "SYNC_SALES"
      ? input.eventType
      : null;

  if (!jobType) {
    return {
      enqueued: false,
      matchedIntegrations: 0,
      message: "Clover webhook did not map to a syncable job type.",
    };
  }

  const integrations = await db.posIntegration.findMany({
    where: {
      provider: PosProviderType.CLOVER,
      status: IntegrationStatus.CONNECTED,
      ...(input.merchantId
        ? { externalMerchantId: input.merchantId }
        : {}),
    },
    select: { id: true, locationId: true },
  });

  if (integrations.length === 0) {
    return {
      enqueued: false,
      matchedIntegrations: 0,
      message:
        "Clover webhook validated, but no connected Clover integrations matched it.",
    };
  }

  await db.$transaction(async (tx) => {
    for (const integration of integrations) {
      await tx.posSyncRun.create({
        data: {
          integrationId: integration.id,
          syncType: PosSyncType.WEBHOOK,
          status: JobStatus.COMPLETED,
          details: {
            eventType: input.eventType ?? null,
            eventId: input.eventId ?? null,
            merchantId: input.merchantId ?? null,
            queuedJobType: jobType,
          },
          completedAt: new Date(),
        },
      });

      await enqueueJobTx(tx, {
        locationId: integration.locationId,
        type: jobType,
        payload: {
          integrationId: integration.id,
          webhookEventType: input.eventType ?? null,
          webhookEventId: input.eventId ?? null,
        },
      });

      await createAuditLogTx(tx, {
        locationId: integration.locationId,
        action: "integration.clover.webhook_received",
        entityType: "posIntegration",
        entityId: integration.id,
        details: {
          eventType: input.eventType ?? null,
          eventId: input.eventId ?? null,
          merchantId: input.merchantId ?? null,
          queuedJobType: jobType,
        },
      });
    }
  });

  return {
    enqueued: true,
    matchedIntegrations: integrations.length,
    jobType,
    message: `Queued ${jobType.toLowerCase().replaceAll("_", " ")} for ${integrations.length} Clover integration${integrations.length === 1 ? "" : "s"}.`,
  };
}

async function resolveMenuItemForCatalogItemTx(
  tx: Prisma.TransactionClient,
  input: {
    locationId: string;
    posItemId: string;
    item: ProviderCatalogItem;
  }
) {
  const mappedMenuItem = await tx.posVariationMapping.findFirst({
    where: {
      locationId: input.locationId,
      posVariation: {
        catalogItemId: input.posItemId,
      },
    },
    select: {
      menuItemVariant: {
        select: {
          menuItem: {
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  if (mappedMenuItem?.menuItemVariant.menuItem.id) {
    return tx.menuItem.update({
      where: {
        id: mappedMenuItem.menuItemVariant.menuItem.id,
      },
      data: {
        category: input.item.category,
        imageUrl: input.item.imageUrl,
      },
    });
  }

  return tx.menuItem.create({
    data: {
      locationId: input.locationId,
      name: input.item.name,
      category: input.item.category,
      imageUrl: input.item.imageUrl,
      source: PosProviderType.SQUARE,
    },
  });
}

