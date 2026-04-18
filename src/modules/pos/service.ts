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
import { getPosProvider } from "@/providers/pos-provider";

function getSquareCallbackUrl() {
  return `${env.APP_URL.replace(/\/$/, "")}/api/integrations/square/callback`;
}

function getStoredAccessToken(accessTokenEncrypted?: string | null) {
  // When SQUARE_ACCESS_TOKEN is set in the env, we're in PAT mode —
  // the env value is authoritative and lets an admin rotate the token
  // by editing the env var alone (no DB cleanup needed). Only fall
  // back to the DB-stored token for OAuth mode, where env has no
  // token and each tenant's per-merchant token lives in the DB.
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

export function getSquareWebhookJobType(eventType?: string | null) {
  const normalized = eventType?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (
    normalized.startsWith("catalog.") ||
    normalized.startsWith("item.") ||
    normalized.startsWith("category.")
  ) {
    return "SYNC_CATALOG" as const;
  }

  if (
    normalized.startsWith("order.") ||
    normalized.startsWith("payment.") ||
    normalized.startsWith("refund.")
  ) {
    return "SYNC_SALES" as const;
  }

  return null;
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

