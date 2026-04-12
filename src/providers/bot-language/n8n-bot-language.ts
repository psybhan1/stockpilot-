import type {
  BotConversationTurn,
  BotInventoryChoice,
  BotLanguageIntent,
  BotLanguageProvider,
  BotMessageInterpretation,
  BotPendingContext,
  BotReplyDraft,
} from "../contracts";

type N8nBotLanguageProviderOptions = {
  interpretWebhookUrl: string;
  replyWebhookUrl: string;
  secret?: string;
  fallback: BotLanguageProvider;
  llmConfig: {
    provider: "ollama" | "cloudflare";
    url: string;
    model: string;
    headers: Record<string, string>;
  };
};

type InterpretResponsePayload = {
  accepted?: boolean;
  provider?: string;
  interpretation?: Record<string, unknown>;
};

type ReplyResponsePayload = {
  accepted?: boolean;
  provider?: string;
  reply?: string;
  metadata?: Record<string, unknown>;
};

const INTENTS: BotLanguageIntent[] = [
  "RESTOCK_TO_PAR",
  "STOCK_STATUS",
  "GREETING",
  "HELP",
  "UNKNOWN",
  "ADD_INVENTORY_ITEM",
  "ADD_SUPPLIER",
  "ADD_RECIPE",
  "UPDATE_ITEM",
  "UPDATE_STOCK_COUNT",
];

export class N8nBotLanguageProvider implements BotLanguageProvider {
  constructor(private readonly options: N8nBotLanguageProviderOptions) {}

  async interpretMessage(input: {
    channel: "WHATSAPP" | "TELEGRAM";
    text: string;
    inventoryChoices: BotInventoryChoice[];
    conversationHistory?: BotConversationTurn[];
    pendingContext?: BotPendingContext;
  }): Promise<BotMessageInterpretation> {
    const fallbackInterpretation = await this.options.fallback.interpretMessage(input);

    try {
      const payload = await this.postJson<InterpretResponsePayload>(
        this.options.interpretWebhookUrl,
        {
          event: "stockpilot.bot.interpret",
          occurredAt: new Date().toISOString(),
          llm: this.options.llmConfig,
          request: input,
        }
      );

      const interpretation = normalizeInterpretation(
        payload.interpretation,
        input.inventoryChoices
      );

      const primaryInterpretation = {
        provider:
          typeof payload.provider === "string" && payload.provider.trim()
            ? payload.provider.trim()
            : "n8n",
        ...interpretation,
      };

      return applyGuardrails(primaryInterpretation, fallbackInterpretation);
    } catch {
      return fallbackInterpretation;
    }
  }

  async draftReply(input: {
    channel: "WHATSAPP" | "TELEGRAM";
    managerText: string;
    scenario: string;
    fallbackReply: string;
    facts: Record<string, unknown>;
    conversationHistory?: BotConversationTurn[];
  }): Promise<BotReplyDraft> {
    try {
      const payload = await this.postJson<ReplyResponsePayload>(this.options.replyWebhookUrl, {
        event: "stockpilot.bot.reply",
        occurredAt: new Date().toISOString(),
        llm: this.options.llmConfig,
        request: input,
      });

      const reply =
        typeof payload.reply === "string" && payload.reply.trim()
          ? payload.reply.trim()
          : input.fallbackReply;

      const providerName =
        typeof payload.provider === "string" && payload.provider.trim()
          ? payload.provider.trim()
          : "n8n";
      const guardedReply = applyReplyGuardrails(input, reply, providerName);

      return {
        provider: guardedReply.provider,
        reply: guardedReply.reply,
        metadata: payload.metadata,
      };
    } catch {
      return this.options.fallback.draftReply(input);
    }
  }

  private async postJson<T>(url: string, body: Record<string, unknown>) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "stockpilot/0.1",
        ...(this.options.secret
          ? { "X-StockPilot-Webhook-Secret": this.options.secret }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    const payload = (await response.json().catch(() => ({}))) as T & Record<string, unknown>;

    if (!response.ok) {
      const message =
        typeof payload.message === "string"
          ? payload.message
          : `n8n bot-language request failed with status ${response.status}`;
      throw new Error(message);
    }

    return payload as T;
  }
}

function normalizeInterpretation(
  raw: Record<string, unknown> | undefined,
  inventoryChoices: BotInventoryChoice[]
): Omit<BotMessageInterpretation, "provider"> {
  const requestedIntent = typeof raw?.intent === "string" ? raw.intent.trim().toUpperCase() : "";
  const intent = INTENTS.includes(requestedIntent as BotLanguageIntent)
    ? (requestedIntent as BotLanguageIntent)
    : "UNKNOWN";
  const allowedIds = new Set(inventoryChoices.map((choice) => choice.id));
  const rawItemId =
    typeof raw?.inventoryItemId === "string" && raw.inventoryItemId.trim()
      ? raw.inventoryItemId.trim()
      : null;
  const inventoryItemId = rawItemId && allowedIds.has(rawItemId) ? rawItemId : null;
  const inventoryItemName =
    typeof raw?.inventoryItemName === "string" && raw.inventoryItemName.trim()
      ? raw.inventoryItemName.trim()
      : inventoryChoices.find((choice) => choice.id === inventoryItemId)?.name ?? null;
  const rawReportedOnHand = raw?.reportedOnHand;
  const reportedOnHandValue =
    rawReportedOnHand == null || rawReportedOnHand === ""
      ? Number.NaN
      : Number(rawReportedOnHand);
  const reportedOnHand = Number.isFinite(reportedOnHandValue)
    ? Math.max(0, Math.round(reportedOnHandValue))
    : null;
  const clarificationQuestion =
    typeof raw?.clarificationQuestion === "string" && raw.clarificationQuestion.trim()
      ? raw.clarificationQuestion.trim()
      : null;
  const confidence = clampConfidence(Number(raw?.confidence));
  const needsClarification =
    raw?.needsClarification === true ||
    ((intent === "RESTOCK_TO_PAR" || intent === "STOCK_STATUS") &&
      (!inventoryItemId || (intent === "RESTOCK_TO_PAR" && reportedOnHand == null) ||
        Boolean(clarificationQuestion)));
  const summary =
    typeof raw?.summary === "string" && raw.summary.trim() ? raw.summary.trim() : null;
  const newItemName =
    typeof raw?.newItemName === "string" && raw.newItemName.trim() ? raw.newItemName.trim() : null;
  const supplierName =
    typeof raw?.supplierName === "string" && raw.supplierName.trim() ? raw.supplierName.trim() : null;
  const dishName =
    typeof raw?.dishName === "string" && raw.dishName.trim() ? raw.dishName.trim() : null;

  return {
    intent,
    inventoryItemId,
    inventoryItemName,
    reportedOnHand,
    confidence,
    needsClarification,
    clarificationQuestion,
    summary,
    newItemName,
    supplierName,
    dishName,
    metadata:
      raw && Object.keys(raw).length > 0
        ? {
            raw,
          }
        : undefined,
  };
}

function clampConfidence(value: number) {
  return Number.isFinite(value) ? Math.min(0.99, Math.max(0.05, value)) : 0.55;
}

function applyGuardrails(
  primary: BotMessageInterpretation,
  fallback: BotMessageInterpretation
): BotMessageInterpretation {
  const withGuardrailMetadata = (
    interpretation: BotMessageInterpretation,
    reason: string
  ): BotMessageInterpretation => ({
    ...interpretation,
    provider: `${primary.provider}+local-guardrail`,
    metadata: {
      ...(interpretation.metadata ?? {}),
      guardrailReason: reason,
      llmInterpretation: primary,
      fallbackInterpretation: fallback,
    },
  });

  // Only prefer conversational fallback when Groq is NOT detecting a workflow intent.
  // Never override ADD_INVENTORY_ITEM, ADD_SUPPLIER, ADD_RECIPE, UPDATE_ITEM, UPDATE_STOCK_COUNT.
  const workflowIntents = new Set([
    "ADD_INVENTORY_ITEM",
    "ADD_SUPPLIER",
    "ADD_RECIPE",
    "UPDATE_ITEM",
    "UPDATE_STOCK_COUNT",
  ]);
  if (
    (fallback.intent === "GREETING" || fallback.intent === "HELP") &&
    primary.intent !== fallback.intent &&
    !workflowIntents.has(primary.intent)
  ) {
    return withGuardrailMetadata(fallback, "prefer_conversational_fallback");
  }

  if (
    fallback.intent === "RESTOCK_TO_PAR" &&
    !fallback.needsClarification &&
    fallback.inventoryItemId &&
    fallback.reportedOnHand != null &&
    (primary.intent !== "RESTOCK_TO_PAR" ||
      !primary.inventoryItemId ||
      primary.reportedOnHand == null ||
      primary.inventoryItemId !== fallback.inventoryItemId ||
      primary.reportedOnHand !== fallback.reportedOnHand)
  ) {
    return withGuardrailMetadata(fallback, "prefer_matched_restock");
  }

  if (
    fallback.intent === "STOCK_STATUS" &&
    !fallback.needsClarification &&
    fallback.inventoryItemId &&
    primary.intent === "STOCK_STATUS" &&
    !primary.inventoryItemId
  ) {
    return withGuardrailMetadata(fallback, "prefer_specific_stock_item");
  }

  if (
    fallback.intent !== "UNKNOWN" &&
    !fallback.needsClarification &&
    (primary.intent === "UNKNOWN" || primary.needsClarification || primary.confidence < 0.55)
  ) {
    return withGuardrailMetadata(fallback, "prefer_confident_fallback");
  }

  return primary;
}

function applyReplyGuardrails(
  input: {
    scenario: string;
    fallbackReply: string;
  },
  reply: string,
  providerName: string
) {
  const normalizedReply = reply.trim();
  const normalizedFallback = input.fallbackReply.trim();

  // Only reject if the reply is extremely long (likely hallucination) — trust Groq otherwise
  if (normalizedReply.length > 450) {
    return {
      provider: "n8n+local-guardrail",
      reply: normalizedFallback,
    };
  }

  return {
    provider: providerName,
    reply: normalizedReply,
  };
}
