import { env } from "@/lib/env";
import { MockAiProvider } from "@/providers/ai/mock-ai";
import { OpenAiProvider } from "@/providers/ai/openai-ai";
import type { AiProvider } from "@/providers/contracts";

// Groq exposes an OpenAI-compatible chat-completions endpoint, so the
// existing OpenAiProvider works against it unchanged. Llama 4 Scout is
// the same model the operator-bot uses — supports JSON mode and tool
// calling on the free tier.
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const GROQ_DEFAULT_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

export function getAiProvider(): AiProvider {
  // Read process.env directly (not the cached `env` object) so the
  // selection responds to runtime env mutations — important for tests
  // and for code paths that set keys after module load. Each call is
  // a few property reads; cheap.
  const defaultProvider = process.env.DEFAULT_AI_PROVIDER ?? env.DEFAULT_AI_PROVIDER;
  const openaiKey = process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  // Explicit OpenAI selection wins.
  if (defaultProvider === "openai" && openaiKey) {
    return new OpenAiProvider({
      apiKey: openaiKey,
      model: process.env.OPENAI_MODEL ?? env.OPENAI_MODEL,
      baseUrl: process.env.OPENAI_BASE_URL ?? env.OPENAI_BASE_URL,
    });
  }

  // Auto-fall-through to Groq when GROQ_API_KEY is set — production
  // already configures it for the bot, so recipe suggestions / risk
  // explanations / ops Q&A get a real LLM instead of canned mock
  // strings without any extra setup.
  if (groqKey) {
    return new OpenAiProvider({
      apiKey: groqKey,
      model: process.env.GROQ_AI_MODEL ?? GROQ_DEFAULT_MODEL,
      baseUrl: GROQ_BASE_URL,
    });
  }

  return new MockAiProvider();
}
