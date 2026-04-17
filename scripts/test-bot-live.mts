// Real LLM validation — makes actual Groq calls against carefully
// crafted ambiguity scenarios and reports what the model does.
// This is the test that proves (or disproves) the new system-prompt
// rules actually land with Llama-4-Scout.
//
// SKIPS if GROQ_API_KEY isn't set. Costs a few pennies to run a
// full pass (10–15 turns at Llama-4-Scout pricing).
//
// Usage:
//   # set GROQ_API_KEY in .env or the shell first
//   npm run test:bot-live
//
// Each scenario:
//   1. Builds a real DB café with named inventory + suppliers.
//   2. Sends a specific nasty message.
//   3. Calls the real runBotAgent (which calls real Groq).
//   4. Asserts the observable outcome:
//      - `tool_calls_included`: did the model commit (bad) or ask (good)?
//      - `reply_mentions_X`: did the reply reference the right things?
//   5. Logs the full tool-call trace so you can see what actually happened.
//
// Failing scenarios are the most useful output — they tell you
// exactly what prompt tweaks would help next.

process.env.N8N_WEBHOOK_SECRET =
  process.env.N8N_WEBHOOK_SECRET ?? "test-bot-live-secret";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-bot-live-session";

// Early exit if no API key — prints a clear instruction instead of crashing.
if (!process.env.GROQ_API_KEY) {
  console.log(
    "\n⚠  GROQ_API_KEY not set — skipping live bot validation.\n\n" +
      "   Add it to .env (or the shell) and rerun. This test makes real\n" +
      "   Groq API calls against the bot's new ambiguity-resolution\n" +
      "   rules — it's the only way to verify the prompt changes\n" +
      "   actually land with Llama-4-Scout.\n\n" +
      "   get a key:  https://console.groq.com/keys\n"
  );
  process.exit(0);
}

import { PrismaClient } from "../src/generated/prisma-postgres/client.js";

const { runBotAgent } = await import("../src/modules/operator-bot/agent.ts");

const db = new PrismaClient();

// ── Harness ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: Array<{ scenario: string; detail: string }> = [];

function assert(cond: unknown, label: string, detail?: string) {
  if (cond) {
    passed += 1;
    console.log(`    ✅ ${label}`);
  } else {
    failed += 1;
    failures.push({ scenario: currentScenario, detail: `${label}${detail ? ` — ${detail}` : ""}` });
    console.log(`    ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

let currentScenario = "";
async function scenario(name: string, fn: () => Promise<void>) {
  currentScenario = name;
  console.log(`\n━━ ${name}`);
  try {
    await fn();
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push({ scenario: name, detail: `THREW: ${msg}` });
    console.log(`    ❌ THREW: ${msg}`);
  }
}

const STAMP = Date.now().toString(36) + Math.random().toString(36).slice(2, 4);

// ── World setup ────────────────────────────────────────────────────

type World = {
  locationId: string;
  userId: string;
  supplierFreshCoId: string;
  supplierCostcoId: string;
  milk2Id: string;
  oatMilkId: string;
  wholeMilkId: string;
  espressoBeansId: string;
  groundCoffeeId: string;
  paperCupsId: string;
};

async function buildCafe(): Promise<World> {
  const suffix = `${STAMP}-${Math.random().toString(36).slice(2, 6)}`;
  const biz = await db.business.create({
    data: { name: `Live Test ${suffix}`, slug: `live-${suffix}` },
  });
  const loc = await db.location.create({
    data: {
      businessId: biz.id,
      name: "Kingsway Cafe",
      timezone: "America/Toronto",
    },
  });
  const user = await db.user.create({
    data: {
      email: `live-${suffix}@test.example`,
      name: "Anna Manager",
      passwordHash: "x",
      roles: { create: { locationId: loc.id, role: "MANAGER" } },
    },
  });
  const freshCo = await db.supplier.create({
    data: {
      locationId: loc.id,
      name: "FreshCo",
      orderingMode: "EMAIL",
      email: `fresh-${suffix}@test.example`,
      leadTimeDays: 2,
    },
  });
  const costco = await db.supplier.create({
    data: {
      locationId: loc.id,
      name: "Costco",
      orderingMode: "WEBSITE",
      website: "costco.com",
      leadTimeDays: 3,
    },
  });

  async function makeItem(
    name: string,
    category:
      | "DAIRY"
      | "ALT_DAIRY"
      | "COFFEE"
      | "PACKAGING",
    baseUnit: "MILLILITER" | "GRAM" | "COUNT",
    packSizeBase: number,
    parLevelBase: number,
    stockOnHandBase: number,
    suppliers: string[]
  ) {
    const item = await db.inventoryItem.create({
      data: {
        locationId: loc.id,
        name,
        sku: `${name.replace(/\W+/g, "").toUpperCase().slice(0, 6)}-${suffix}`,
        category,
        displayUnit:
          baseUnit === "MILLILITER"
            ? "LITER"
            : baseUnit === "GRAM"
              ? "KILOGRAM"
              : "COUNT",
        baseUnit,
        countUnit: baseUnit,
        purchaseUnit:
          baseUnit === "MILLILITER"
            ? "LITER"
            : baseUnit === "GRAM"
              ? "KILOGRAM"
              : "COUNT",
        packSizeBase,
        parLevelBase,
        lowStockThresholdBase: Math.floor(parLevelBase / 2),
        safetyStockBase: Math.floor(parLevelBase / 4),
        stockOnHandBase,
        primarySupplierId: suppliers[0],
      },
    });
    for (const supId of suppliers) {
      await db.supplierItem.create({
        data: {
          supplierId: supId,
          inventoryItemId: item.id,
          packSizeBase,
          lastUnitCostCents: 1200,
          preferred: supId === suppliers[0],
        },
      });
    }
    return item;
  }

  // Three milks — the canonical ambiguity scenario.
  const milk2 = await makeItem("Milk 2%", "DAIRY", "MILLILITER", 4000, 16000, 8000, [
    freshCo.id,
  ]);
  const oatMilk = await makeItem("Oat Milk", "ALT_DAIRY", "MILLILITER", 1000, 8000, 4000, [
    costco.id,
    freshCo.id, // oat milk has TWO suppliers — tests rule D
  ]);
  const wholeMilk = await makeItem(
    "Whole Milk",
    "DAIRY",
    "MILLILITER",
    4000,
    16000,
    12000,
    [freshCo.id]
  );
  // Three coffees
  const espressoBeans = await makeItem(
    "Espresso Beans",
    "COFFEE",
    "GRAM",
    1000,
    5000,
    3000,
    [costco.id]
  );
  const groundCoffee = await makeItem(
    "Ground Coffee",
    "COFFEE",
    "GRAM",
    1000,
    5000,
    2000,
    [costco.id]
  );
  const paperCups = await makeItem(
    "Paper Cups 12oz",
    "PACKAGING",
    "COUNT",
    50,
    400,
    100,
    [costco.id]
  );

  return {
    locationId: loc.id,
    userId: user.id,
    supplierFreshCoId: freshCo.id,
    supplierCostcoId: costco.id,
    milk2Id: milk2.id,
    oatMilkId: oatMilk.id,
    wholeMilkId: wholeMilk.id,
    espressoBeansId: espressoBeans.id,
    groundCoffeeId: groundCoffee.id,
    paperCupsId: paperCups.id,
  };
}

async function cleanup() {
  const biz = await db.business.findMany({
    where: { slug: { startsWith: `live-${STAMP}` } },
    select: { id: true, locations: { select: { id: true } } },
  });
  const locIds = biz.flatMap((b) => b.locations.map((l) => l.id));
  if (locIds.length === 0) return;
  await db.supplierCommunication.deleteMany({
    where: { purchaseOrder: { locationId: { in: locIds } } },
  });
  await db.auditLog.deleteMany({ where: { locationId: { in: locIds } } });
  await db.stockMovement.deleteMany({
    where: { inventoryItem: { locationId: { in: locIds } } },
  });
  await db.purchaseOrderLine.deleteMany({
    where: { purchaseOrder: { locationId: { in: locIds } } },
  });
  await db.purchaseOrder.deleteMany({ where: { locationId: { in: locIds } } });
  await db.reorderRecommendation.deleteMany({
    where: { locationId: { in: locIds } },
  });
  await db.supplierItem.deleteMany({
    where: { supplier: { locationId: { in: locIds } } },
  });
  await db.inventoryItem.deleteMany({ where: { locationId: { in: locIds } } });
  await db.supplier.deleteMany({ where: { locationId: { in: locIds } } });
  await db.userLocationRole.deleteMany({
    where: { locationId: { in: locIds } },
  });
  await db.location.deleteMany({ where: { id: { in: locIds } } });
  await db.user.deleteMany({
    where: { email: { contains: `live-${STAMP}` } },
  });
  await db.business.deleteMany({
    where: { slug: { startsWith: `live-${STAMP}` } },
  });
}

async function askBot(world: World, userMessage: string) {
  const started = Date.now();
  const result = await runBotAgent({
    locationId: world.locationId,
    userId: world.userId,
    channel: "TELEGRAM",
    senderId: `live-${world.userId}`,
    sourceMessageId: `live-${Date.now()}`,
    conversation: [{ role: "user", content: userMessage }],
  });
  const elapsed = Date.now() - started;

  // Pull the LLM turn telemetry we just wrote so we can display the
  // tool calls the model made.
  const turn = await db.auditLog.findFirst({
    where: {
      locationId: world.locationId,
      action: "bot.llm_turn",
      entityId: { startsWith: "live-" },
    },
    orderBy: { createdAt: "desc" },
  });
  const details = (turn?.details ?? {}) as {
    toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  };
  const toolCalls = details.toolCalls ?? [];

  console.log(`    📨 user: ${userMessage}`);
  console.log(`    🤖 reply (${elapsed}ms): ${result.reply.replace(/\s+/g, " ").slice(0, 200)}`);
  if (toolCalls.length > 0) {
    for (const tc of toolCalls) {
      console.log(
        `    🔧 tool: ${tc.name}(${Object.entries(tc.args)
          .filter(([, v]) => v !== undefined && v !== "")
          .slice(0, 4)
          .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 40)}`)
          .join(", ")})`
      );
    }
  } else {
    console.log(`    🔧 tool: (none — reply only)`);
  }

  return { reply: result.reply, toolCalls, purchaseOrderId: result.purchaseOrderId };
}

// ── Scenarios ──────────────────────────────────────────────────────

await scenario("AMBIGUITY A: 'we need more milk' (3 milks → should ASK)", async () => {
  const w = await buildCafe();
  const { reply, toolCalls, purchaseOrderId } = await askBot(w, "we need more milk");
  const committed =
    toolCalls.some((t) =>
      ["place_restock_order", "quick_add_and_order"].includes(t.name)
    ) || purchaseOrderId != null;
  assert(!committed, "model did NOT commit on ambiguous 'milk'", `toolCalls=${JSON.stringify(toolCalls.map((t) => t.name))}`);
  const mentionsOptions =
    /oat|whole|2%|which/i.test(reply) && /\?/.test(reply);
  assert(mentionsOptions, "reply names the options and asks", `reply="${reply.slice(0, 160)}"`);
});

await scenario("AMBIGUITY C: unit mismatch 'order 3 liters of espresso beans' (beans are grams)", async () => {
  const w = await buildCafe();
  const { reply, toolCalls, purchaseOrderId } = await askBot(
    w,
    "order 3 liters of espresso beans from costco"
  );
  const committedWrong = toolCalls.some(
    (t) => t.name === "place_restock_order" || t.name === "quick_add_and_order"
  );
  // A quick_add_and_order call is acceptable if the model converts to kg/bags.
  // place_restock_order with liters is a genuine bug.
  const badCommit =
    committedWrong &&
    toolCalls.some(
      (t) =>
        typeof t.args.quantity === "string" &&
        /liter|litre|l\b/i.test(t.args.quantity as string)
    );
  assert(!badCommit, "did not commit with 'liters' on a gram item");
  // Either asks OR converts silently — either is acceptable.
  const acceptable =
    /liter|litre|kg|kilogram|gram|bag/i.test(reply) ||
    (committedWrong && !badCommit);
  assert(acceptable, "reply addresses the unit mismatch", `reply="${reply.slice(0, 160)}"`);
  void purchaseOrderId;
});

await scenario("AMBIGUITY D: 'order more oat milk' (has 2 suppliers → should ask which)", async () => {
  const w = await buildCafe();
  const { reply, toolCalls } = await askBot(w, "order more oat milk");
  // 2 suppliers: Costco + FreshCo. Model should ask OR pick a
  // sensible default (the preferred one — Costco here).
  const askedForSupplier =
    /costco|freshco|from which|which supplier/i.test(reply) && /\?/.test(reply);
  const committedWithSupplier = toolCalls.some((t) => {
    if (t.name !== "place_restock_order" && t.name !== "quick_add_and_order") return false;
    return typeof t.args.supplier_name === "string" && (t.args.supplier_name as string).length > 0;
  });
  assert(
    askedForSupplier || committedWithSupplier,
    "asked for supplier OR committed with a named supplier",
    `reply="${reply.slice(0, 160)}"`
  );
});

await scenario("AMBIGUITY E: 'order some oat milk' (no quantity → should ask)", async () => {
  const w = await buildCafe();
  const { reply, toolCalls } = await askBot(w, "order some oat milk");
  const committedWithQty = toolCalls.some((t) => {
    if (t.name !== "place_restock_order" && t.name !== "quick_add_and_order") return false;
    return t.args.quantity != null && String(t.args.quantity).length > 0;
  });
  const asksForQty = /how many|how much|quantity|\d+/i.test(reply) && /\?/.test(reply);
  assert(
    asksForQty || committedWithQty,
    "asked for quantity OR committed with a sensible default",
    `reply="${reply.slice(0, 160)}"`
  );
});

await scenario("HAPPY: 'order 3 bags of oat milk from costco' (unambiguous → should commit)", async () => {
  const w = await buildCafe();
  const { reply, toolCalls, purchaseOrderId } = await askBot(
    w,
    "order 3 bags of oat milk from costco"
  );
  const committed =
    toolCalls.some((t) =>
      ["place_restock_order", "quick_add_and_order"].includes(t.name)
    ) || purchaseOrderId != null;
  assert(committed, "clear order is committed, not asked about", `reply="${reply.slice(0, 160)}"`);
});

await scenario("RECALL: 'is my milk order ready?' (recent PO is for ground coffee)", async () => {
  const w = await buildCafe();
  // Seed an approved + sent PO for Ground Coffee so MOST_RECENT is NOT milk.
  await db.purchaseOrder.create({
    data: {
      locationId: w.locationId,
      supplierId: w.supplierCostcoId,
      orderNumber: `PO-LIVE-${STAMP}`,
      status: "SENT",
      sentAt: new Date(),
      totalLines: 1,
      lines: {
        create: {
          inventoryItemId: w.groundCoffeeId,
          description: "Ground Coffee bag",
          quantityOrdered: 3,
          expectedQuantityBase: 3000,
          purchaseUnit: "KILOGRAM",
          packSizeBase: 1000,
          latestCostCents: 2500,
        },
      },
    },
  });
  const { reply } = await askBot(w, "is my milk order ready?");
  const noPretendingYes = !/yes[,.]?\s+(it|your|that)/i.test(reply);
  assert(
    noPretendingYes,
    "did not falsely confirm 'yes' when no milk PO exists",
    `reply="${reply.slice(0, 200)}"`
  );
  const mentionsActualPO = /coffee|ground/i.test(reply);
  assert(
    mentionsActualPO,
    "mentions the actually-open PO (ground coffee) or notes there's no milk PO",
    `reply="${reply.slice(0, 200)}"`
  );
});

await scenario("APPROVAL: 'yes approve it' (after a draft PO exists)", async () => {
  const w = await buildCafe();
  await db.purchaseOrder.create({
    data: {
      locationId: w.locationId,
      supplierId: w.supplierCostcoId,
      orderNumber: `PO-APPROVE-${STAMP}`,
      status: "AWAITING_APPROVAL",
      totalLines: 1,
      lines: {
        create: {
          inventoryItemId: w.oatMilkId,
          description: "Oat Milk bag",
          quantityOrdered: 3,
          expectedQuantityBase: 3000,
          purchaseUnit: "LITER",
          packSizeBase: 1000,
          latestCostCents: 380,
        },
      },
    },
  });
  const { toolCalls, reply } = await askBot(w, "yes approve");
  const approved = toolCalls.some((t) => t.name === "approve_recent_order");
  assert(approved, "called approve_recent_order", `reply="${reply.slice(0, 160)}"`);
});

await scenario("REFUSAL: 'nvm cancel that' (after a draft PO exists)", async () => {
  const w = await buildCafe();
  await db.purchaseOrder.create({
    data: {
      locationId: w.locationId,
      supplierId: w.supplierCostcoId,
      orderNumber: `PO-CANCEL-${STAMP}`,
      status: "AWAITING_APPROVAL",
      totalLines: 1,
      lines: {
        create: {
          inventoryItemId: w.oatMilkId,
          description: "Oat Milk bag",
          quantityOrdered: 3,
          expectedQuantityBase: 3000,
          purchaseUnit: "LITER",
          packSizeBase: 1000,
          latestCostCents: 380,
        },
      },
    },
  });
  const { toolCalls, reply } = await askBot(w, "nvm cancel that");
  const cancelled = toolCalls.some((t) => t.name === "cancel_recent_order");
  assert(cancelled, "called cancel_recent_order", `reply="${reply.slice(0, 160)}"`);
});

await scenario("STATUS: 'what do I need?' (Ground Coffee is below threshold → should list it)", async () => {
  const w = await buildCafe();
  const { reply } = await askBot(w, "what do i need?");
  // Below threshold items in the world: Paper Cups (100/400) + Ground Coffee (2000/5000) + Oat Milk (4000/8000)
  const mentionsLow = /ground coffee|paper cups|oat milk|below|par|low|stock/i.test(reply);
  assert(mentionsLow, "mentions at least one low-stock item", `reply="${reply.slice(0, 200)}"`);
});

await scenario("CLARIFY: 'order 5 coffees' (3 coffee-ish items exist → should ask which)", async () => {
  const w = await buildCafe();
  const { reply, toolCalls } = await askBot(w, "order 5 coffees");
  const asks = /\?/.test(reply) && /ground|espresso|beans|coffee/i.test(reply);
  const committedRight = toolCalls.some((t) => {
    if (t.name !== "place_restock_order" && t.name !== "quick_add_and_order") return false;
    const name = (t.args.item_name as string | undefined) ?? "";
    return /espresso|ground|beans/i.test(name);
  });
  assert(
    asks || committedRight,
    "asked which coffee OR committed with a specific coffee item",
    `reply="${reply.slice(0, 200)}"`
  );
});

// ── Cleanup + report ──────────────────────────────────────────────

await cleanup();

console.log(
  `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPassed: ${passed}\nFailed: ${failed}${
    failed > 0
      ? "\n\nFailures (these reveal prompt gaps — tune system prompt or tool descs):\n" +
        failures.map((f) => `  • [${f.scenario}]\n     ${f.detail}`).join("\n")
      : ""
  }`
);

if (failed > 0) {
  console.log("\nNote: live-LLM tests are probabilistic. Rerun once before concluding the prompt is wrong.");
  process.exit(1);
} else {
  console.log("\n🎉 THE REAL BOT ACTUALLY BEHAVES CORRECTLY ON ALL SCENARIOS");
}

await db.$disconnect();
