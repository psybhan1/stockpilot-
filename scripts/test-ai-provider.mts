// Standalone tsx-runnable test for the AI provider wiring. Lives in
// scripts/ instead of src/ because src/providers/ai-provider.ts uses
// `@/...` alias imports that the test:compile (CommonJS) pipeline
// can't resolve, while tsx handles them natively.
//
// Verifies:
//   1. Defaults to MockAiProvider when no LLM keys set
//   2. Uses OpenAiProvider when DEFAULT_AI_PROVIDER=openai + key
//   3. Auto-falls-through to Groq via OpenAiProvider when GROQ_API_KEY
//      is set and OpenAI isn't (the "free tier in production" path)
//   4. Groq path actually hits api.groq.com with correct auth header
//   5. Groq path falls back to canned recipe on bad LLM output

const ENV_KEYS = ["DEFAULT_AI_PROVIDER", "OPENAI_API_KEY", "GROQ_API_KEY", "GROQ_AI_MODEL"] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
  delete process.env[key];
}
function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: unknown, label: string) {
  if (cond) {
    passed += 1;
    console.log(`    ✅ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`    ❌ ${label}`);
  }
}

async function runScenario(name: string, fn: () => Promise<void>) {
  console.log(`\n━━ ${name}`);
  try {
    await fn();
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`    ❌ THREW: ${msg}`);
  }
}

// Re-import getAiProvider fresh each scenario so env changes are
// picked up (env.ts captures process.env at import time).
async function freshGetAiProvider() {
  const moduleUrl = `../src/providers/ai-provider.ts?v=${Math.random()}`;
  const mod = await import(moduleUrl);
  return mod.getAiProvider as () => unknown;
}
async function freshClasses() {
  const mock = await import(`../src/providers/ai/mock-ai.ts?v=${Math.random()}`);
  const openai = await import(`../src/providers/ai/openai-ai.ts?v=${Math.random()}`);
  return {
    MockAiProvider: mock.MockAiProvider,
    OpenAiProvider: openai.OpenAiProvider,
  };
}

await runScenario("Default → MockAiProvider when no keys", async () => {
  const getProvider = await freshGetAiProvider();
  const { MockAiProvider } = await freshClasses();
  const provider = getProvider();
  assert(provider instanceof MockAiProvider, "expected MockAiProvider");
});

await runScenario("DEFAULT_AI_PROVIDER=openai + key → OpenAiProvider", async () => {
  process.env.DEFAULT_AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "sk-test";
  const getProvider = await freshGetAiProvider();
  const { OpenAiProvider } = await freshClasses();
  const provider = getProvider();
  assert(provider instanceof OpenAiProvider, "expected OpenAiProvider");
  delete process.env.DEFAULT_AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
});

await runScenario("GROQ_API_KEY only → auto-falls-through to Groq via OpenAiProvider", async () => {
  process.env.GROQ_API_KEY = "gsk-test";
  const getProvider = await freshGetAiProvider();
  const { OpenAiProvider, MockAiProvider } = await freshClasses();
  const provider = getProvider();
  assert(provider instanceof OpenAiProvider, "Groq path reuses OpenAiProvider");
  assert(!(provider instanceof MockAiProvider), "must NOT be MockAiProvider");
  delete process.env.GROQ_API_KEY;
});

await runScenario("Groq provider hits api.groq.com with correct auth", async () => {
  process.env.GROQ_API_KEY = "gsk-correct-key";
  const getProvider = await freshGetAiProvider();
  const provider = getProvider() as {
    explainRisk: (input: { inventoryName: string; daysLeft: number | null; projectedRunoutAt: Date | null }) => Promise<string>;
  };

  let capturedUrl = "";
  let capturedAuth = "";
  let capturedBody = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    capturedUrl = String(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    capturedAuth = headers["Authorization"] ?? "";
    capturedBody = String(init?.body ?? "");
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "Test risk explanation." } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const reply = await provider.explainRisk({
      inventoryName: "Oat Milk",
      daysLeft: 1.2,
      projectedRunoutAt: new Date(),
    });
    assert(reply === "Test risk explanation.", `got reply: ${reply}`);
    assert(capturedUrl.includes("api.groq.com"), `URL is Groq: ${capturedUrl}`);
    assert(capturedUrl.includes("/chat/completions"), "uses chat completions endpoint");
    assert(capturedAuth === "Bearer gsk-correct-key", `auth header from key: ${capturedAuth}`);
    assert(capturedBody.includes("llama-4-scout"), "default model includes llama-4-scout");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GROQ_API_KEY;
  }
});

await runScenario("GROQ_AI_MODEL env var overrides default model", async () => {
  process.env.GROQ_API_KEY = "gsk-test";
  process.env.GROQ_AI_MODEL = "llama-3.1-70b-versatile";
  const getProvider = await freshGetAiProvider();
  const provider = getProvider() as {
    explainRisk: (input: { inventoryName: string; daysLeft: number | null; projectedRunoutAt: Date | null }) => Promise<string>;
  };

  let capturedBody = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    capturedBody = String(init?.body ?? "");
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    await provider.explainRisk({
      inventoryName: "x",
      daysLeft: 1,
      projectedRunoutAt: new Date(),
    });
    assert(capturedBody.includes("llama-3.1-70b-versatile"), "uses overridden model");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_AI_MODEL;
  }
});

await runScenario("Groq suggestRecipe falls back to canned data on bad JSON", async () => {
  process.env.GROQ_API_KEY = "gsk-test";
  const getProvider = await freshGetAiProvider();
  const provider = getProvider() as {
    suggestRecipe: (input: { menuItemName: string; variationName: string }) => Promise<{ summary: string; components: unknown[] }>;
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: "this is definitely not json {" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as typeof fetch;

  try {
    const result = await provider.suggestRecipe({
      menuItemName: "Iced Vanilla Latte",
      variationName: "Large iced vanilla latte",
    });
    assert(typeof result.summary === "string" && result.summary.length > 0, "fell back to canned summary");
    assert(Array.isArray(result.components) && result.components.length > 0, "got canned components");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GROQ_API_KEY;
  }
});

await runScenario("Mock provider returns deterministic recipe for known menu item", async () => {
  const getProvider = await freshGetAiProvider();
  const provider = getProvider() as {
    suggestRecipe: (input: { menuItemName: string; variationName: string }) => Promise<{ summary: string; components: Array<{ inventorySku: string }> }>;
  };
  const result = await provider.suggestRecipe({
    menuItemName: "Iced Vanilla Latte",
    variationName: "Large iced vanilla latte",
  });
  assert(/oat milk|vanilla|espresso/i.test(result.summary), `summary references the drink: ${result.summary}`);
  const skus = result.components.map((c) => c.inventorySku);
  assert(skus.includes("INV-OAT-01"), "includes oat milk SKU");
  assert(skus.includes("INV-BEANS-ESP"), "includes espresso beans SKU");
});

restoreEnv();

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\n🎉 ALL AI-PROVIDER TESTS PASSED");
