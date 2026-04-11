import { parseManagerRestockMessage } from "../../modules/operator-bot/parser";
import type {
  BotConversationTurn,
  BotInventoryChoice,
  BotLanguageProvider,
  BotMessageInterpretation,
  BotPendingContext,
  BotReplyDraft,
} from "../contracts";

export class LocalBotLanguageProvider implements BotLanguageProvider {
  async interpretMessage(input: {
    channel: "WHATSAPP" | "TELEGRAM";
    text: string;
    inventoryChoices: BotInventoryChoice[];
    conversationHistory?: BotConversationTurn[];
    pendingContext?: BotPendingContext;
  }): Promise<BotMessageInterpretation> {
    // Try to resolve a pending clarification using the current message
    if (input.pendingContext?.intent === "RESTOCK_TO_PAR") {
      const resolved = tryResolvePendingRestock(input.text, input.inventoryChoices, input.pendingContext);
      if (resolved) return resolved;
    }
    const normalizedMessage = normalizeText(input.text);
    const parsed = parseManagerRestockMessage(input.text, input.inventoryChoices);

    if (parsed.kind === "matched") {
      return {
        provider: "local",
        intent: "RESTOCK_TO_PAR",
        inventoryItemId: parsed.inventoryItemId,
        inventoryItemName: parsed.inventoryItemName,
        reportedOnHand: parsed.reportedOnHandBase,
        confidence: 0.92,
        needsClarification: false,
        summary: `Matched ${parsed.inventoryItemName} for a restock-to-par request.`,
      };
    }

    if (parsed.kind === "ambiguous") {
      return {
        provider: "local",
        intent: "RESTOCK_TO_PAR",
        confidence: 0.35,
        needsClarification: true,
        reportedOnHand: parsed.reportedOnHandBase,
        clarificationQuestion: `I found more than one possible item: ${parsed.candidates
          .map((candidate) => candidate.name)
          .join(", ")}. Which one should I use?`,
        summary: "The message looked like a reorder request, but more than one inventory item matched.",
        metadata: {
          candidates: parsed.candidates,
        },
      };
    }

    if (parsed.kind === "missing_count") {
      return {
        provider: "local",
        intent: "RESTOCK_TO_PAR",
        confidence: 0.41,
        needsClarification: true,
        clarificationQuestion:
          "Tell me how many you have left so I can restock to par. Example: 'Whole milk 2 left, order more.'",
        summary: "The message sounded like a reorder request, but the count was missing.",
      };
    }

    if (parsed.kind === "missing_item") {
      return {
        provider: "local",
        intent: "RESTOCK_TO_PAR",
        confidence: 0.31,
        needsClarification: true,
        reportedOnHand: parsed.reportedOnHandBase,
        clarificationQuestion:
          parsed.reportedOnHandBase == null
            ? "I couldn't find the inventory item in that message. Try the full item name."
            : `I heard ${parsed.reportedOnHandBase} left, but I couldn't match the item name. Try the full inventory name, for example 'Whole milk 2 left, order more.'`,
        summary: "The message looked like a reorder request, but the inventory item could not be matched.",
      };
    }

    if (looksLikeGreeting(normalizedMessage)) {
      return {
        provider: "local",
        intent: "GREETING",
        confidence: 0.96,
        needsClarification: false,
        summary: "The manager sent a greeting.",
      };
    }

    if (looksLikeHelp(normalizedMessage)) {
      return {
        provider: "local",
        intent: "HELP",
        confidence: 0.9,
        needsClarification: false,
        summary: "The manager asked what the bot can do.",
      };
    }

    if (looksLikeStockStatus(normalizedMessage)) {
      const match = matchInventoryChoice(normalizedMessage, input.inventoryChoices);

      if (match.kind === "matched") {
        return {
          provider: "local",
          intent: "STOCK_STATUS",
          inventoryItemId: match.item.id,
          inventoryItemName: match.item.name,
          confidence: 0.8,
          needsClarification: false,
          summary: `The manager is asking for the current status of ${match.item.name}.`,
        };
      }

      if (match.kind === "ambiguous") {
        return {
          provider: "local",
          intent: "STOCK_STATUS",
          confidence: 0.42,
          needsClarification: true,
          clarificationQuestion: `Which item do you mean: ${match.candidates
            .map((candidate) => candidate.name)
            .join(", ")}?`,
          summary: "The manager asked for stock status, but multiple items matched.",
          metadata: {
            candidates: match.candidates,
          },
        };
      }

      return {
        provider: "local",
        intent: "STOCK_STATUS",
        confidence: 0.76,
        needsClarification: false,
        summary: "The manager asked for a general stock status update.",
      };
    }

    return {
      provider: "local",
      intent: "UNKNOWN",
      confidence: 0.25,
      needsClarification: false,
      summary: "The message did not match a supported stock or reorder pattern.",
    };
  }

  async draftReply(input: {
    channel: "WHATSAPP" | "TELEGRAM";
    managerText: string;
    scenario: string;
    fallbackReply: string;
    facts: Record<string, unknown>;
    conversationHistory?: BotConversationTurn[];
  }): Promise<BotReplyDraft> {
    return {
      provider: "local",
      reply: input.fallbackReply,
      metadata: {
        scenario: input.scenario,
      },
    };
  }
}

function looksLikeGreeting(message: string) {
  return /\b(hi|hello|hey|yo|hiya|sup|whats up|what s up|how are you|how r u|how are u|good morning|good afternoon|good evening)\b/i.test(
    message
  );
}

function looksLikeHelp(message: string) {
  return /\b(help|what can you do|how do i use this|commands|what do you understand|what can u do|what can you help with)\b/i.test(
    message
  );
}

function looksLikeStockStatus(message: string) {
  return /\b(how much|how many|do we have|what is left|what's left|what are we low on|low stock|running low|status)\b/i.test(
    message
  );
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * When we have a pending RESTOCK_TO_PAR clarification (e.g. bot asked "which item?" or "how many left?"),
 * try to resolve it from the manager's follow-up message alone.
 */
function tryResolvePendingRestock(
  text: string,
  inventoryChoices: BotInventoryChoice[],
  pending: BotPendingContext
): BotMessageInterpretation | null {
  const normalized = normalizeText(text);

  // Case 1: We had the item but needed the count
  if (pending.inventoryItemId && pending.inventoryItemName && pending.reportedOnHand == null) {
    const matches = [...normalized.matchAll(/\b\d+(?:\.\d+)?\b/g)];
    if (matches.length > 0) {
      const count = Math.max(0, Math.round(Number(matches[0]![0])));
      return {
        provider: "local-pending-resolve",
        intent: "RESTOCK_TO_PAR",
        inventoryItemId: pending.inventoryItemId,
        inventoryItemName: pending.inventoryItemName,
        reportedOnHand: count,
        confidence: 0.82,
        needsClarification: false,
        summary: `Resolved pending restock for ${pending.inventoryItemName} with count ${count} from follow-up.`,
      };
    }
  }

  // Case 2: We had the count but needed the item
  if (pending.reportedOnHand != null && !pending.inventoryItemId) {
    const match = matchInventoryChoice(normalized, inventoryChoices);
    if (match.kind === "matched") {
      return {
        provider: "local-pending-resolve",
        intent: "RESTOCK_TO_PAR",
        inventoryItemId: match.item.id,
        inventoryItemName: match.item.name,
        reportedOnHand: pending.reportedOnHand,
        confidence: 0.82,
        needsClarification: false,
        summary: `Resolved pending restock for ${match.item.name} using previously reported count ${pending.reportedOnHand}.`,
      };
    }
  }

  // Case 3: We had an ambiguous item match — manager is clarifying which one
  if (pending.reportedOnHand != null) {
    const match = matchInventoryChoice(normalized, inventoryChoices);
    if (match.kind === "matched") {
      return {
        provider: "local-pending-resolve",
        intent: "RESTOCK_TO_PAR",
        inventoryItemId: match.item.id,
        inventoryItemName: match.item.name,
        reportedOnHand: pending.reportedOnHand,
        confidence: 0.78,
        needsClarification: false,
        summary: `Resolved ambiguous item to ${match.item.name} from clarification reply.`,
      };
    }
  }

  return null;
}

function matchInventoryChoice(message: string, inventoryChoices: BotInventoryChoice[]) {
  const candidates = inventoryChoices
    .map((choice) => ({
      item: choice,
      score: scoreChoice(message, choice),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (!candidates.length) {
    return {
      kind: "missing" as const,
    };
  }

  const best = candidates[0]!;
  const ambiguous = candidates.filter((candidate) => candidate.score >= best.score - 4);

  if (ambiguous.length > 1) {
    return {
      kind: "ambiguous" as const,
      candidates: ambiguous.slice(0, 4).map((candidate) => candidate.item),
    };
  }

  return {
    kind: "matched" as const,
    item: best.item,
  };
}

function scoreChoice(message: string, choice: BotInventoryChoice) {
  const normalizedName = normalizeText(choice.name);
  const normalizedSku = normalizeText(choice.sku ?? "");
  let score = 0;

  if (normalizedSku && message.includes(normalizedSku)) {
    score += 120;
  }

  if (message.includes(normalizedName)) {
    score += 100 + normalizedName.length;
  }

  const tokens = normalizedName
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  const hits = tokens.filter((token) => message.includes(token));

  score += hits.length * 12;

  return score;
}
