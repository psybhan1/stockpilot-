import assert from "node:assert/strict";
import test from "node:test";

import { LocalBotLanguageProvider } from "../../providers/bot-language/local-bot-language";
import { N8nBotLanguageProvider } from "../../providers/bot-language/n8n-bot-language";

const inventoryChoices = [
  { id: "milk", name: "Whole Milk", sku: "INV-MILK-DAIRY" },
  { id: "oat", name: "Oat Milk", sku: "INV-OAT-01" },
  { id: "beans", name: "Espresso Beans", sku: "INV-BEANS-ESP" },
];

const defaultLlmConfig = {
  provider: "ollama",
  url: "http://127.0.0.1:11434/api/chat",
  model: "qwen2.5:3b",
  headers: {
    "Content-Type": "application/json",
  },
} as const;

test("local bot language: interprets restock requests", async () => {
  const provider = new LocalBotLanguageProvider();

  const result = await provider.interpretMessage({
    channel: "TELEGRAM",
    text: "Whole milk 2 left, order more.",
    inventoryChoices,
  });

  assert.equal(result.intent, "RESTOCK_TO_PAR");
  assert.equal(result.inventoryItemId, "milk");
  assert.equal(result.reportedOnHand, 2);
  assert.equal(result.needsClarification, false);
});

test("local bot language: interprets stock questions", async () => {
  const provider = new LocalBotLanguageProvider();

  const result = await provider.interpretMessage({
    channel: "WHATSAPP",
    text: "How much oat milk do we have?",
    inventoryChoices,
  });

  assert.equal(result.intent, "STOCK_STATUS");
  assert.equal(result.inventoryItemId, "oat");
  assert.equal(result.needsClarification, false);
});

test("local bot language: treats casual greetings as greetings", async () => {
  const provider = new LocalBotLanguageProvider();

  const result = await provider.interpretMessage({
    channel: "TELEGRAM",
    text: "how are u",
    inventoryChoices,
  });

  assert.equal(result.intent, "GREETING");
  assert.equal(result.needsClarification, false);
});

test("n8n bot language: normalizes valid workflow responses", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        provider: "n8n-ollama",
        interpretation: {
          intent: "restock_to_par",
          inventoryItemId: "milk",
          inventoryItemName: "Whole Milk",
          reportedOnHand: 2,
          confidence: 0.88,
          needsClarification: false,
          summary: "Manager wants to reorder whole milk.",
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    )) as typeof fetch;

  try {
    const provider = new N8nBotLanguageProvider({
      interpretWebhookUrl: "http://127.0.0.1:5678/webhook/stockpilot-bot-interpret",
      replyWebhookUrl: "http://127.0.0.1:5678/webhook/stockpilot-bot-reply",
      secret: "test-secret",
      fallback: new LocalBotLanguageProvider(),
      llmConfig: defaultLlmConfig,
    });

    const result = await provider.interpretMessage({
      channel: "TELEGRAM",
      text: "Whole milk 2 left, order more.",
      inventoryChoices,
    });

    assert.equal(result.provider, "n8n-ollama");
    assert.equal(result.intent, "RESTOCK_TO_PAR");
    assert.equal(result.inventoryItemId, "milk");
    assert.equal(result.reportedOnHand, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("n8n bot language: accepts hosted cloud workflow responses", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        provider: "n8n-cloudflare",
        interpretation: {
          intent: "stock_status",
          inventoryItemId: "oat",
          inventoryItemName: "Oat Milk",
          reportedOnHand: null,
          confidence: 0.84,
          needsClarification: false,
          summary: "Manager is asking about oat milk stock.",
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    )) as typeof fetch;

  try {
    const provider = new N8nBotLanguageProvider({
      interpretWebhookUrl: "http://127.0.0.1:5678/webhook/stockpilot-bot-interpret",
      replyWebhookUrl: "http://127.0.0.1:5678/webhook/stockpilot-bot-reply",
      secret: "test-secret",
      fallback: new LocalBotLanguageProvider(),
      llmConfig: defaultLlmConfig,
    });

    const result = await provider.interpretMessage({
      channel: "TELEGRAM",
      text: "How much oat milk do we have?",
      inventoryChoices,
    });

    assert.equal(result.provider, "n8n-cloudflare");
    assert.equal(result.intent, "STOCK_STATUS");
    assert.equal(result.inventoryItemId, "oat");
    assert.equal(result.reportedOnHand, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("n8n bot language: falls back cleanly when the workflow is unavailable", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("n8n unavailable");
  }) as typeof fetch;

  try {
    const provider = new N8nBotLanguageProvider({
      interpretWebhookUrl: "http://127.0.0.1:5678/webhook/stockpilot-bot-interpret",
      replyWebhookUrl: "http://127.0.0.1:5678/webhook/stockpilot-bot-reply",
      secret: "test-secret",
      fallback: new LocalBotLanguageProvider(),
      llmConfig: defaultLlmConfig,
    });

    const result = await provider.interpretMessage({
      channel: "WHATSAPP",
      text: "hi",
      inventoryChoices,
    });

    assert.equal(result.provider, "local");
    assert.equal(result.intent, "GREETING");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("n8n bot language: uses local guardrails when the llm misses an obvious reorder", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        provider: "n8n-ollama",
        interpretation: {
          intent: "stock_status",
          inventoryItemId: null,
          inventoryItemName: "Whole Milk",
          reportedOnHand: 2,
          confidence: 0.91,
          needsClarification: false,
          summary: "There are 2 units of Whole Milk left.",
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    )) as typeof fetch;

  try {
    const provider = new N8nBotLanguageProvider({
      interpretWebhookUrl: "http://127.0.0.1:5678/webhook/stockpilot-bot-interpret",
      replyWebhookUrl: "http://127.0.0.1:5678/webhook/stockpilot-bot-reply",
      secret: "test-secret",
      fallback: new LocalBotLanguageProvider(),
      llmConfig: defaultLlmConfig,
    });

    const result = await provider.interpretMessage({
      channel: "TELEGRAM",
      text: "Whole milk 2 left, order more.",
      inventoryChoices,
    });

    assert.equal(result.intent, "RESTOCK_TO_PAR");
    assert.equal(result.inventoryItemId, "milk");
    assert.equal(result.reportedOnHand, 2);
    assert.match(result.provider, /local-guardrail/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("n8n bot language: rejects mismatched llm ids and null counts for strong restock matches", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        provider: "n8n-ollama",
        interpretation: {
          intent: "restock_to_par",
          inventoryItemId: "oat",
          inventoryItemName: "Whole Milk",
          reportedOnHand: null,
          confidence: 0.99,
          needsClarification: false,
          summary: "Manager wants to reorder Whole Milk.",
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    )) as typeof fetch;

  try {
    const provider = new N8nBotLanguageProvider({
      interpretWebhookUrl: "http://127.0.0.1:5678/webhook/stockpilot-bot-interpret",
      replyWebhookUrl: "http://127.0.0.1:5678/webhook/stockpilot-bot-reply",
      secret: "test-secret",
      fallback: new LocalBotLanguageProvider(),
      llmConfig: defaultLlmConfig,
    });

    const result = await provider.interpretMessage({
      channel: "TELEGRAM",
      text: "Whole milk 2 left, order more.",
      inventoryChoices,
    });

    assert.equal(result.intent, "RESTOCK_TO_PAR");
    assert.equal(result.inventoryItemId, "milk");
    assert.equal(result.reportedOnHand, 2);
    assert.match(result.provider, /local-guardrail/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("n8n bot language: prefers local greeting guardrails over unrelated stock answers", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        provider: "n8n-cloudflare",
        interpretation: {
          intent: "stock_status",
          inventoryItemId: null,
          inventoryItemName: null,
          reportedOnHand: null,
          confidence: 0.94,
          needsClarification: false,
          summary: "Manager wants a stock summary.",
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    )) as typeof fetch;

  try {
    const provider = new N8nBotLanguageProvider({
      interpretWebhookUrl: "http://127.0.0.1:5678/webhook/stockpilot-bot-interpret",
      replyWebhookUrl: "http://127.0.0.1:5678/webhook/stockpilot-bot-reply",
      secret: "test-secret",
      fallback: new LocalBotLanguageProvider(),
      llmConfig: defaultLlmConfig,
    });

    const result = await provider.interpretMessage({
      channel: "TELEGRAM",
      text: "yo",
      inventoryChoices,
    });

    assert.equal(result.intent, "GREETING");
    assert.match(result.provider, /local-guardrail/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("n8n bot language: keeps the local greeting reply when the llm gets too generic", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes("stockpilot-bot-reply")) {
      return new Response(
        JSON.stringify({
          provider: "n8n-ollama",
          reply:
            "Hello! Ready to assist with your inventory needs. Ask about items that are low, check on specific items, or let me know if you need anything else.",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    throw new Error("unexpected webhook call");
  }) as typeof fetch;

  try {
    const provider = new N8nBotLanguageProvider({
      interpretWebhookUrl: "http://127.0.0.1:5678/webhook/stockpilot-bot-interpret",
      replyWebhookUrl: "http://127.0.0.1:5678/webhook/stockpilot-bot-reply",
      secret: "test-secret",
      fallback: new LocalBotLanguageProvider(),
      llmConfig: defaultLlmConfig,
    });

    const result = await provider.draftReply({
      channel: "TELEGRAM",
      managerText: "how are u",
      scenario: "greeting",
      fallbackReply:
        "Hey. I'm here and ready to help with stock. You can ask what's low, check an item, or say something like 'Whole milk 2 left, order more.'",
      facts: {},
    });

    assert.equal(
      result.reply,
      "Hey. I'm here and ready to help with stock. You can ask what's low, check an item, or say something like 'Whole milk 2 left, order more.'"
    );
    assert.equal(result.provider, "n8n+local-guardrail");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
