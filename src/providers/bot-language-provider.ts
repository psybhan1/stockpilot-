import { env } from "@/lib/env";
import { LocalBotLanguageProvider } from "@/providers/bot-language/local-bot-language";
import { N8nBotLanguageProvider } from "@/providers/bot-language/n8n-bot-language";
import type { BotLanguageProvider } from "@/providers/contracts";

export function getBotLanguageProvider(): BotLanguageProvider {
  const fallback = new LocalBotLanguageProvider();

  if (env.N8N_BOT_INTERPRET_WEBHOOK_URL && env.N8N_BOT_REPLY_WEBHOOK_URL) {
    return new N8nBotLanguageProvider({
      interpretWebhookUrl: env.N8N_BOT_INTERPRET_WEBHOOK_URL,
      replyWebhookUrl: env.N8N_BOT_REPLY_WEBHOOK_URL,
      secret: env.N8N_WEBHOOK_SECRET,
      fallback,
      llmConfig: getBotLlmConfig(),
    });
  }

  return fallback;
}

type BotLlmConfig = {
  provider: "ollama" | "cloudflare";
  url: string;
  model: string;
  headers: Record<string, string>;
};

function getBotLlmConfig(): BotLlmConfig {
  if (
    env.BOT_LLM_PROVIDER === "cloudflare" &&
    env.CLOUDFLARE_BOT_ACCOUNT_ID &&
    env.CLOUDFLARE_BOT_API_TOKEN
  ) {
    return {
      provider: "cloudflare" as const,
      url: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_BOT_ACCOUNT_ID}/ai/v1/chat/completions`,
      model: env.CLOUDFLARE_BOT_MODEL,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.CLOUDFLARE_BOT_API_TOKEN}`,
      },
    };
  }

  return {
    provider: "ollama" as const,
    url: `${env.BOT_LLM_BASE_URL.replace(/\/$/, "")}/api/chat`,
    model: env.BOT_LLM_MODEL,
    headers: {
      "Content-Type": "application/json",
    } satisfies Record<string, string>,
  };
}
