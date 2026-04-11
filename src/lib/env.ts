const fallbackSessionSecret = "stockpilot-local-dev-secret";
const fallbackDatabaseUrl = "file:./dev.db";

function parsePositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildN8nWebhookUrl(baseUrl: string | undefined, path: string) {
  if (!baseUrl?.trim()) {
    return undefined;
  }

  return `${baseUrl.replace(/\/$/, "")}/webhook/${path}`;
}

const n8nBaseUrl = process.env.N8N_BASE_URL;

export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? fallbackDatabaseUrl,
  SESSION_SECRET: process.env.SESSION_SECRET ?? fallbackSessionSecret,
  APP_URL: process.env.APP_URL ?? "http://localhost:3000",
  APP_AUTO_REFRESH_MS: parsePositiveNumber(process.env.APP_AUTO_REFRESH_MS, 15000),
  WORKER_POLL_MS: parsePositiveNumber(process.env.WORKER_POLL_MS, 5000),
  WORKER_BATCH_SIZE: parsePositiveNumber(process.env.WORKER_BATCH_SIZE, 25),
  DEFAULT_POS_PROVIDER:
    (process.env.DEFAULT_POS_PROVIDER as "fake-square" | "square") ??
    "fake-square",
  DEFAULT_AI_PROVIDER:
    (process.env.DEFAULT_AI_PROVIDER as "mock" | "openai") ?? "mock",
  DEFAULT_EMAIL_PROVIDER:
    (process.env.DEFAULT_EMAIL_PROVIDER as "console" | "resend") ?? "console",
  DEFAULT_AUTOMATION_PROVIDER:
    (process.env.DEFAULT_AUTOMATION_PROVIDER as "internal" | "n8n") ??
    "internal",
  SQUARE_ENVIRONMENT:
    (process.env.SQUARE_ENVIRONMENT as "sandbox" | "production") ?? "sandbox",
  SQUARE_API_VERSION: process.env.SQUARE_API_VERSION ?? "2026-01-22",
  SQUARE_ACCESS_TOKEN: process.env.SQUARE_ACCESS_TOKEN,
  SQUARE_LOCATION_ID: process.env.SQUARE_LOCATION_ID,
  SQUARE_SCOPES:
    process.env.SQUARE_SCOPES ??
    "ITEMS_READ ORDERS_READ MERCHANT_PROFILE_READ",
  SQUARE_CLIENT_ID: process.env.SQUARE_CLIENT_ID,
  SQUARE_CLIENT_SECRET: process.env.SQUARE_CLIENT_SECRET,
  SQUARE_WEBHOOK_SIGNATURE_KEY: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-5-mini",
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  BOT_LLM_PROVIDER:
    (process.env.BOT_LLM_PROVIDER as "ollama" | "cloudflare") ?? "ollama",
  BOT_LLM_BASE_URL: process.env.BOT_LLM_BASE_URL ?? "http://127.0.0.1:11434",
  BOT_LLM_MODEL: process.env.BOT_LLM_MODEL ?? "qwen2.5:3b",
  CLOUDFLARE_BOT_ACCOUNT_ID: process.env.CLOUDFLARE_BOT_ACCOUNT_ID,
  CLOUDFLARE_BOT_API_TOKEN: process.env.CLOUDFLARE_BOT_API_TOKEN,
  CLOUDFLARE_BOT_MODEL:
    process.env.CLOUDFLARE_BOT_MODEL ?? "@cf/meta/llama-3.1-8b-instruct-fast",
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM_EMAIL:
    process.env.RESEND_FROM_EMAIL ?? "StockPilot <onboarding@resend.dev>",
  EXPO_ACCESS_TOKEN: process.env.EXPO_ACCESS_TOKEN,
  EXPO_TEST_PUSH_TOKEN: process.env.EXPO_TEST_PUSH_TOKEN,
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM,
  TWILIO_TEST_WHATSAPP_TO: process.env.TWILIO_TEST_WHATSAPP_TO,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_LOGIN_CLIENT_ID: process.env.TELEGRAM_LOGIN_CLIENT_ID,
  TELEGRAM_LOGIN_CLIENT_SECRET: process.env.TELEGRAM_LOGIN_CLIENT_SECRET,
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
  TELEGRAM_BOT_API_BASE_URL:
    process.env.TELEGRAM_BOT_API_BASE_URL ?? "https://api.telegram.org",
  N8N_BASE_URL: n8nBaseUrl,
  N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL,
  N8N_NOTIFICATION_WEBHOOK_URL:
    process.env.N8N_NOTIFICATION_WEBHOOK_URL ??
    buildN8nWebhookUrl(n8nBaseUrl, "stockpilot-notification-dispatch") ??
    process.env.N8N_WEBHOOK_URL,
  N8N_AUTOMATION_WEBHOOK_URL:
    process.env.N8N_AUTOMATION_WEBHOOK_URL ??
    buildN8nWebhookUrl(n8nBaseUrl, "stockpilot-website-order-prep") ??
    process.env.N8N_WEBHOOK_URL,
  N8N_BOT_INTERPRET_WEBHOOK_URL:
    process.env.N8N_BOT_INTERPRET_WEBHOOK_URL ??
    buildN8nWebhookUrl(n8nBaseUrl, "stockpilot-bot-interpret"),
  N8N_BOT_REPLY_WEBHOOK_URL:
    process.env.N8N_BOT_REPLY_WEBHOOK_URL ??
    buildN8nWebhookUrl(n8nBaseUrl, "stockpilot-bot-reply"),
  N8N_WEBHOOK_SECRET: process.env.N8N_WEBHOOK_SECRET,
};
