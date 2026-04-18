import {
  AlertSeverity,
  MeasurementUnit,
  NotificationChannel,
  PosProviderType,
  ServiceMode,
  SupplierOrderingMode,
} from "../lib/prisma";

export type ProviderCatalogItem = {
  externalItemId: string;
  name: string;
  category?: string;
  imageUrl?: string;
  variations: Array<{
    externalVariationId: string;
    name: string;
    sizeLabel?: string;
    serviceMode?: ServiceMode;
    priceCents?: number;
    externalSku?: string;
  }>;
};

export type ProviderSaleEvent = {
  externalOrderId: string;
  occurredAt: Date;
  status: string;
  serviceMode?: ServiceMode;
  lines: Array<{
    externalLineId: string;
    externalVariationId: string;
    quantity: number;
    unitPriceCents?: number;
    serviceMode?: ServiceMode;
    modifiers?: string[];
  }>;
};

export type RecipeSuggestion = {
  summary: string;
  confidenceScore: number;
  components: Array<{
    inventorySku: string;
    componentType: "INGREDIENT" | "PACKAGING";
    quantityBase: number;
    displayUnit: MeasurementUnit;
    suggestedMinBase?: number;
    suggestedMaxBase?: number;
    confidenceScore: number;
    conditionServiceMode?: ServiceMode;
    optional?: boolean;
    notes?: string;
  }>;
};

export type AssistantAnswer = {
  answer: string;
  severity?: AlertSeverity;
  suggestedActions?: string[];
};

export type BotLanguageIntent =
  | "RESTOCK_TO_PAR"
  | "STOCK_STATUS"
  | "GREETING"
  | "HELP"
  | "UNKNOWN"
  | "ADD_INVENTORY_ITEM"
  | "ADD_SUPPLIER"
  | "ADD_RECIPE"
  | "UPDATE_ITEM"
  | "UPDATE_STOCK_COUNT";

export type BotInventoryChoice = {
  id: string;
  name: string;
  sku?: string | null;
};

export type BotConversationTurn = {
  role: "manager" | "bot";
  text: string;
};

export type BotPendingContext = {
  intent: string;
  inventoryItemId?: string | null;
  inventoryItemName?: string | null;
  reportedOnHand?: number | null;
  clarificationQuestion: string;
};

export type BotMessageInterpretation = {
  provider: string;
  intent: BotLanguageIntent;
  inventoryItemId?: string | null;
  inventoryItemName?: string | null;
  reportedOnHand?: number | null;
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion?: string | null;
  summary?: string | null;
  // For ADD_INVENTORY_ITEM: the name of the new item
  newItemName?: string | null;
  // For ADD_SUPPLIER: the supplier name
  supplierName?: string | null;
  // For ADD_RECIPE: the dish/drink name
  dishName?: string | null;
  metadata?: Record<string, unknown>;
};

export type BotReplyDraft = {
  provider: string;
  reply: string;
  metadata?: Record<string, unknown>;
};

export type WebsiteOrderAutomationInput = {
  taskId: string;
  title: string;
  description: string;
  supplierName: string;
  website?: string | null;
  purchaseOrderId?: string | null;
  orderNumber?: string | null;
  requiresApproval: boolean;
  reviewUrl: string;
  callbackUrl?: string;
  callbackSecret?: string | null;
  input: Record<string, unknown> | null;
};

export type WebsiteOrderAutomationResult = {
  provider: string;
  summary: string;
  dispatchState: "pending" | "ready_for_review";
  externalRunId?: string;
  externalUrl?: string;
  metadata?: Record<string, unknown>;
};

export type NotificationDispatchResult = {
  providerMessageId?: string;
  deliveryState: "queued" | "sent";
  metadata?: Record<string, unknown>;
};

export interface PosProvider {
  provider: PosProviderType;
  connect(input: {
    integrationId: string;
    callbackUrl: string;
    state: string;
    accessToken?: string | null;
    // Shopify-only: the merchant's shop domain (e.g.
    // "my-cafe.myshopify.com"). Ignored by Square + Clover whose
    // OAuth URLs are vendor-hosted and don't depend on merchant.
    shopDomain?: string | null;
  }): Promise<{
    status: "connected" | "redirect_required";
    sandbox: boolean;
    authUrl?: string;
    externalMerchantId?: string;
    externalLocationId?: string;
    accessToken?: string;
    refreshToken?: string;
  }>;
  exchangeCode?(input: {
    code: string;
    callbackUrl: string;
    // Shopify-only — see above.
    shopDomain?: string | null;
  }): Promise<{
    sandbox: boolean;
    externalMerchantId?: string;
    externalLocationId?: string;
    accessToken: string;
    refreshToken?: string;
  }>;
  syncCatalog(input?: {
    accessToken?: string | null;
    locationId?: string | null;
  }): Promise<ProviderCatalogItem[]>;
  syncOrders(input?: {
    accessToken?: string | null;
    locationId?: string | null;
  }): Promise<ProviderSaleEvent[]>;
  handleWebhook(input: {
    payload: unknown;
    rawBody: string;
    signature: string | null;
    notificationUrl: string;
  }): Promise<{
    accepted: boolean;
    message: string;
    eventType?: string | null;
    eventId?: string | null;
    merchantId?: string | null;
    locationId?: string | null;
  }>;
}

export interface NotificationProvider {
  sendNotification(input: {
    notificationId?: string;
    channel: NotificationChannel;
    recipient: string;
    subject?: string;
    body: string;
    callbackUrl?: string;
    callbackSecret?: string | null;
  }): Promise<NotificationDispatchResult>;
  sendAlert(input: {
    recipient: string;
    subject: string;
    body: string;
  }): Promise<NotificationDispatchResult>;
}

export interface SupplierOrderProvider {
  createDraft(input: {
    supplierName: string;
    mode: SupplierOrderingMode;
    orderNumber: string;
    lines: Array<{ description: string; quantity: number; unit: string }>;
  }): Promise<{ subject: string; body: string }>;
  sendApprovedOrder(input: {
    recipient: string;
    subject: string;
    body: string;
    /** Optional rich HTML body — providers that support it (e.g. Gmail) send multipart/alternative. */
    html?: string;
    /** Optional Reply-To override. When set, supplier replies go to
     * this address instead of the user's connected mailbox. We set
     * it to `reply+<purchaseOrderId>@<REPLY_DOMAIN>` so the inbound
     * webhook can re-attach the reply to the PO — this replaces the
     * gmail.readonly thread-poller path. */
    replyTo?: string;
  }): Promise<{
    providerMessageId?: string;
    /** Provider-specific metadata (e.g. Gmail threadId) — persisted
     * on the SupplierCommunication row so downstream workers can
     * find the conversation later. */
    metadata?: Record<string, unknown>;
    /** Set by the no-config fallback (ConsoleEmailProvider) to signal
     * the caller that nothing actually went over the wire — the
     * user still needs to hit Send in their own email app. */
    simulated?: boolean;
    /** mailto: URL pre-filled with the PO subject/body/recipient, so
     * the Telegram message can expose a tap-to-open button that
     * opens the user's native email app. Only provided when
     * simulated === true. */
    mailto?: string;
  }>;
  prepareWebsiteTask(input: {
    supplierName: string;
    website?: string | null;
    orderNumber: string;
    lines: Array<{ description: string; quantity: number; unit: string }>;
  }): Promise<{ title: string; description: string; input: Record<string, unknown> }>;
}

export interface AutomationProvider {
  dispatchWebsiteOrderTask(
    input: WebsiteOrderAutomationInput
  ): Promise<WebsiteOrderAutomationResult>;
}

export interface AiProvider {
  suggestRecipe(input: {
    menuItemName: string;
    variationName: string;
    serviceMode?: ServiceMode | null;
  }): Promise<RecipeSuggestion>;
  explainRisk(input: {
    inventoryName: string;
    daysLeft: number | null;
    projectedRunoutAt: Date | null;
  }): Promise<string>;
  explainReorder(input: {
    inventoryName: string;
    projectedRunoutAt: Date | null;
    recommendedPackCount: number;
    recommendedUnit: MeasurementUnit;
  }): Promise<string>;
  draftSupplierMessage(input: {
    supplierName: string;
    orderNumber: string;
    lines: Array<{ description: string; quantity: number; unit: string }>;
  }): Promise<{ subject: string; body: string }>;
  answerOpsQuery(input: {
    question: string;
    summary: {
      lowStockItems: string[];
      pendingApprovals: string[];
      recentAnomalies: string[];
    };
  }): Promise<AssistantAnswer>;
}

export interface BotLanguageProvider {
  interpretMessage(input: {
    channel: "WHATSAPP" | "TELEGRAM";
    text: string;
    inventoryChoices: BotInventoryChoice[];
    conversationHistory?: BotConversationTurn[];
    pendingContext?: BotPendingContext;
  }): Promise<BotMessageInterpretation>;
  draftReply(input: {
    channel: "WHATSAPP" | "TELEGRAM";
    managerText: string;
    scenario: string;
    fallbackReply: string;
    facts: Record<string, unknown>;
    conversationHistory?: BotConversationTurn[];
  }): Promise<BotReplyDraft>;
}

