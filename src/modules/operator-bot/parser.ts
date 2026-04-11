type InventoryChoice = {
  id: string;
  name: string;
  sku?: string | null;
};

export type BotRestockParseResult =
  | {
      kind: "matched";
      inventoryItemId: string;
      inventoryItemName: string;
      reportedOnHandBase: number;
    }
  | {
      kind: "ambiguous";
      candidates: Array<{ id: string; name: string }>;
      reportedOnHandBase: number | null;
    }
  | {
      kind: "missing_count";
    }
  | {
      kind: "missing_item";
      reportedOnHandBase: number | null;
    }
  | {
      kind: "unsupported";
    };

const intentPattern =
  /\b(order|reorder|restock|top up|top-up|refill|buy|get more|send|running out|low|left|remaining)\b/i;

export function parseManagerRestockMessage(
  message: string,
  inventoryChoices: InventoryChoice[]
): BotRestockParseResult {
  const normalizedMessage = normalizeText(message);

  if (!intentPattern.test(normalizedMessage)) {
    return { kind: "unsupported" };
  }

  const reportedOnHandBase = extractReportedOnHandBase(normalizedMessage);
  if (reportedOnHandBase == null) {
    return { kind: "missing_count" };
  }

  const rankedCandidates = inventoryChoices
    .map((choice) => ({
      choice,
      score: scoreInventoryChoice(normalizedMessage, choice),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (rankedCandidates.length === 0) {
    return {
      kind: "missing_item",
      reportedOnHandBase,
    };
  }

  const topCandidate = rankedCandidates[0]!;
  const ambiguousCandidates = rankedCandidates.filter(
    (candidate) => candidate.score >= topCandidate.score - 5
  );

  if (ambiguousCandidates.length > 1) {
    return {
      kind: "ambiguous",
      reportedOnHandBase,
      candidates: ambiguousCandidates.slice(0, 4).map((candidate) => ({
        id: candidate.choice.id,
        name: candidate.choice.name,
      })),
    };
  }

  return {
    kind: "matched",
    inventoryItemId: topCandidate.choice.id,
    inventoryItemName: topCandidate.choice.name,
    reportedOnHandBase,
  };
}

function extractReportedOnHandBase(message: string) {
  const matches = [...message.matchAll(/\b\d+(?:\.\d+)?\b/g)];
  if (!matches.length) {
    return null;
  }

  const parsed = Number(matches[0]![0]);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

function scoreInventoryChoice(message: string, choice: InventoryChoice) {
  const normalizedName = normalizeText(choice.name);
  const normalizedSku = normalizeText(choice.sku ?? "");
  const nameTokens = tokenize(normalizedName);

  let score = 0;

  if (normalizedSku && message.includes(normalizedSku)) {
    score += 120;
  }

  if (message.includes(normalizedName)) {
    score += 100 + normalizedName.length;
  }

  const tokenHits = nameTokens.filter((token) => message.includes(token));
  score += tokenHits.length * 14;

  if (nameTokens.length > 1 && tokenHits.length === nameTokens.length) {
    score += 20;
  }

  if (nameTokens.length === 1 && tokenHits.length === 1) {
    score += 4;
  }

  return score;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return value
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}
