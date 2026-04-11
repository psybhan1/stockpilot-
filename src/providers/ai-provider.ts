import { env } from "@/lib/env";
import { MockAiProvider } from "@/providers/ai/mock-ai";
import { OpenAiProvider } from "@/providers/ai/openai-ai";
import type { AiProvider } from "@/providers/contracts";

export function getAiProvider(): AiProvider {
  if (env.DEFAULT_AI_PROVIDER === "openai" && env.OPENAI_API_KEY) {
    return new OpenAiProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      baseUrl: env.OPENAI_BASE_URL,
    });
  }

  return new MockAiProvider();
}
