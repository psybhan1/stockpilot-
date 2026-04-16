// Synthetic end-to-end test of the bot pipeline. Runs many scenarios
// through `runBotAgent`, mocking the Groq HTTP call so we can pretend
// the model called specific tools and assert the resulting DB state +
// reply text.
//
// What this catches that unit tests don't:
//   - Tool dispatch wiring (tool name → tool handler) is correct
//   - Per-tool DB writes happen and are queryable afterwards
//   - The tool-call loop terminates correctly when the model emits a
//     final text reply
//   - The PO → approve buttons → callback flow is internally
//     consistent (we don't actually push the button — we hit the
//     callback handler the way the route does)
//   - The system prompt + live-data block is built without crashing
//     on real DB rows
//
// What it does NOT catch:
//   - Whether Llama 4 Scout actually picks the right tool for a
//     natural-language input (that's a model-behaviour test, requires
//     the real Groq key + a different harness)
//   - Whether headless Chrome launches on Railway (separate health
//     endpoint covers that)
//
// The mock works by replacing global fetch BEFORE importing the agent
// module, so `process.env.GROQ_API_KEY` doesn't even need to be set
// for these tests to run.

// Run with `tsx` (already in devDeps) so the script can import the
// agent module directly. tsx handles the .ts → .js transpile on the
// fly without needing a build step.
import { PrismaClient } from "../src/generated/prisma-postgres/client.js";

const db = new PrismaClient();

// ── Mocked Groq endpoint ─────────────────────────────────────────
// The agent calls fetch("https://api.groq.com/openai/v1/chat/completions").
// We intercept those calls and return scripted responses indexed by
// the active scenario. Each scenario can supply N responses so we can
// model multi-turn tool loops.
let scenarioResponses = [];
let scenarioIndex = 0;
const realFetch = globalThis.fetch;

globalThis.fetch = async function mockedFetch(url, init) {
  const target = typeof url === "string" ? url : url instanceof URL ? url.toString() : "";
  if (target.includes("api.groq.com/openai/v1/chat/completions")) {
    const next = scenarioResponses[scenarioIndex++];
    if (!next) {
      throw new Error(`Mocked Groq ran out of scripted responses at index ${scenarioIndex}`);
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: next }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  // Pass anything else through to the real network (Telegram API, etc.)
  return realFetch(url, init);
};

// Allow the agent to think GROQ_API_KEY is set even if it isn't.
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || "test-mock-key";

// Now safe to import the agent — it'll see the mocked fetch.
const { runBotAgent } = await import("../src/modules/operator-bot/agent.ts");

// ── Test harness ─────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`    ✅ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`    ❌ ${label}`);
  }
}

async function runScenario(name, mockResponses, fn) {
  console.log(`\n━━ ${name}`);
  scenarioResponses = mockResponses;
  scenarioIndex = 0;
  try {
    await fn();
    if (scenarioIndex < scenarioResponses.length) {
      console.log(`    ⚠ unused mock responses: ${scenarioResponses.length - scenarioIndex}`);
    }
  } catch (err) {
    failed += 1;
    failures.push(`${name}: ${err.message}`);
    console.log(`    ❌ THREW: ${err.message}`);
    if (err.stack) console.log(err.stack.split("\n").slice(1, 4).join("\n"));
  }
}

// ── Setup ────────────────────────────────────────────────────────
async function findOrCreateLocation() {
  const loc = await db.location.findFirst({ select: { id: true, name: true } });
  if (loc) return loc;
  const business = await db.business.create({
    data: { name: "Test Cafe", slug: `test-${Date.now()}` },
  });
  return db.location.create({
    data: { businessId: business.id, name: "Test", timezone: "America/Toronto" },
    select: { id: true, name: true },
  });
}

async function findOrCreateUser(locationId) {
  const user = await db.user.findFirst({
    where: { roles: { some: { locationId } } },
    select: { id: true, email: true },
  });
  if (user) return user;
  return db.user.create({
    data: {
      email: `test-${Date.now()}@example.com`,
      name: "Test User",
      passwordHash: "x",
      roles: { create: { locationId, role: "MANAGER" } },
    },
    select: { id: true, email: true },
  });
}

// Helper: build a mock Groq response that calls one tool with given args.
function toolCallResponse(toolName, args) {
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: `call_${Math.random().toString(36).slice(2)}`,
        type: "function",
        function: { name: toolName, arguments: JSON.stringify(args) },
      },
    ],
  };
}

function textResponse(content) {
  return { role: "assistant", content, tool_calls: [] };
}

// ── Tests ────────────────────────────────────────────────────────
async function main() {
  const loc = await findOrCreateLocation();
  const user = await findOrCreateUser(loc.id);
  const stamp = Date.now().toString(36);

  console.log(`Location: ${loc.name}`);
  console.log(`Stamp: ${stamp}\n`);

  const cleanup = async () => {
    await db.purchaseOrderLine.deleteMany({
      where: { description: { contains: stamp } },
    });
    await db.purchaseOrder.deleteMany({
      where: { locationId: loc.id, orderNumber: { contains: stamp } },
    });
    await db.supplierItem.deleteMany({
      where: { inventoryItem: { name: { contains: stamp } } },
    });
    await db.inventoryItem.deleteMany({
      where: { locationId: loc.id, name: { contains: stamp } },
    });
    await db.supplier.deleteMany({
      where: { locationId: loc.id, name: { contains: stamp } },
    });
  };
  await cleanup();

  const ctx = (text, conversation = []) => ({
    locationId: loc.id,
    userId: user.id,
    channel: "TELEGRAM",
    senderId: "test-sender",
    sourceMessageId: null,
    conversation: [...conversation, { role: "user", content: text }],
  });

  // ── Scenario 1: pure text reply, no tools ───────────────────
  await runScenario(
    "Greeting → text reply, no tools",
    [textResponse("Hey! What can I help with?")],
    async () => {
      const result = await runBotAgent(ctx("hi"));
      assert(result.ok, "ok");
      assert(result.reply === "Hey! What can I help with?", "reply text passed through");
      assert(!result.purchaseOrderId, "no PO id");
    }
  );

  // ── Scenario 2: list_inventory tool then text reply ─────────
  await runScenario(
    "list_inventory → text reply",
    [
      toolCallResponse("list_inventory", {}),
      textResponse("You've got a few items in stock."),
    ],
    async () => {
      const result = await runBotAgent(ctx("what do I have"));
      assert(result.ok, "ok");
      assert(result.reply === "You've got a few items in stock.", "synth reply after tool");
    }
  );

  // ── Scenario 3: quick_add_and_order with URL ────────────────
  // Most tools (incl. quick_add_and_order) DON'T short-circuit the
  // tool loop — only workflow-starting tools do. So we provide a
  // follow-up text response that simulates the model summarising
  // the tool result for the user.
  await runScenario(
    "quick_add_and_order with Amazon URL → PO created",
    [
      toolCallResponse("quick_add_and_order", {
        item_name: `E2E Test Item ${stamp}-quickadd`,
        category: "CLEANING",
        quantity: "1",
        supplier_name: `E2E Amazon ${stamp}`,
        website_url: "https://www.amazon.com/Urnex-Cafiza/dp/B005YJZE2I",
      }),
      textResponse("✅ Drafted PO. Approve when ready."),
    ],
    async () => {
      const result = await runBotAgent(
        ctx("order this https://www.amazon.com/Urnex-Cafiza/dp/B005YJZE2I")
      );
      assert(result.ok, "ok");
      assert(result.purchaseOrderId, "purchaseOrderId returned");
      assert(result.orderNumber?.startsWith("PO-"), "orderNumber set");

      const supplier = await db.supplier.findFirst({
        where: { locationId: loc.id, name: `E2E Amazon ${stamp}` },
        select: { website: true, orderingMode: true },
      });
      assert(supplier?.website === "https://www.amazon.com",
        `supplier.website is hostname root (got ${supplier?.website})`);
      assert(supplier?.orderingMode === "WEBSITE", "supplier in WEBSITE mode");

      const po = await db.purchaseOrder.findUnique({
        where: { id: result.purchaseOrderId },
        include: { lines: true },
      });
      assert(po?.status === "AWAITING_APPROVAL", `PO status ${po?.status}`);
      assert(po?.lines[0]?.notes?.includes("Product URL: https://www.amazon.com/Urnex-Cafiza/dp/B005YJZE2I"),
        "PO line carries pasted URL");
    }
  );

  // ── Scenario 4: place_restock_order ─────────────────────────
  // Pre-create an item + supplier so place_restock_order has something to act on.
  const supplier4 = await db.supplier.create({
    data: {
      locationId: loc.id,
      name: `E2E Supplier4 ${stamp}`,
      orderingMode: "EMAIL",
      email: "test@example.com",
      leadTimeDays: 2,
    },
  });
  const item4 = await db.inventoryItem.create({
    data: {
      locationId: loc.id,
      name: `Test Item4 ${stamp}`,
      sku: `E2E-${stamp}-4`,
      category: "DAIRY",
      baseUnit: "MILLILITER",
      countUnit: "MILLILITER",
      displayUnit: "LITER",
      purchaseUnit: "LITER",
      packSizeBase: 1000,
      stockOnHandBase: 2000,
      parLevelBase: 10000,
      lowStockThresholdBase: 3000,
      safetyStockBase: 2000,
      primarySupplierId: supplier4.id,
    },
  });
  await db.supplierItem.create({
    data: {
      supplierId: supplier4.id,
      inventoryItemId: item4.id,
      packSizeBase: 1000,
      minimumOrderQuantity: 1,
      preferred: true,
    },
  });

  await runScenario(
    "place_restock_order → PO created via service",
    [
      toolCallResponse("place_restock_order", {
        item_id: item4.id,
        current_quantity: "2",
        requested_quantity: "10",
        requested_unit: "L",
      }),
      textResponse("📋 Drafted PO. Approve when ready."),
    ],
    async () => {
      const result = await runBotAgent(ctx("oat milk 2 left, order 10L"));
      assert(result.ok, "ok");
      assert(result.purchaseOrderId, "PO created");
      assert(/Approve|approve/i.test(result.reply) || /Drafted|drafted/i.test(result.reply),
        "reply has approve/draft language");
    }
  );

  // ── Scenario 5: list_low_stock + final reply ────────────────
  await runScenario(
    "list_low_stock returns critical items",
    [
      toolCallResponse("list_low_stock", {}),
      textResponse("Got it — running low on a couple things."),
    ],
    async () => {
      const result = await runBotAgent(ctx("what's running out"));
      assert(result.ok, "ok");
      assert(result.reply === "Got it — running low on a couple things.", "final reply preserved");
    }
  );

  // ── Scenario 6: approve_recent_order ────────────────────────
  await runScenario(
    "approve_recent_order on the PO from scenario 4",
    [
      toolCallResponse("approve_recent_order", {}),
      textResponse("✅ Approved and sent."),
    ],
    async () => {
      const result = await runBotAgent(ctx("approve"));
      assert(result.ok, "ok");
      assert(
        /✅|approved|sent/i.test(result.reply),
        `reply confirms approval (got: ${result.reply.slice(0, 80)})`
      );
    }
  );

  // ── Scenario 7: cancel_recent_order ─────────────────────────
  // Make a fresh AWAITING_APPROVAL PO to cancel.
  const cancelPo = await db.purchaseOrder.create({
    data: {
      locationId: loc.id,
      supplierId: supplier4.id,
      orderNumber: `PO-CANCEL-${stamp}`,
      status: "AWAITING_APPROVAL",
      totalLines: 1,
      placedById: user.id,
    },
  });
  await db.purchaseOrderLine.create({
    data: {
      purchaseOrderId: cancelPo.id,
      inventoryItemId: item4.id,
      description: `cancel test ${stamp}`,
      quantityOrdered: 5,
      expectedQuantityBase: 5000,
      purchaseUnit: "LITER",
      packSizeBase: 1000,
    },
  });
  await runScenario(
    "cancel_recent_order on a pending PO",
    [
      toolCallResponse("cancel_recent_order", {}),
      textResponse("✖ Cancelled."),
    ],
    async () => {
      const result = await runBotAgent(ctx("nvm cancel that"));
      assert(result.ok, "ok");
      assert(/cancel|✖/i.test(result.reply), `reply confirms cancel (got: ${result.reply.slice(0, 80)})`);
      const po = await db.purchaseOrder.findUnique({
        where: { id: cancelPo.id },
        select: { status: true },
      });
      assert(po?.status === "CANCELLED", `PO state CANCELLED (got ${po?.status})`);
    }
  );

  // ── Scenario 8: graceful exit when no tool & empty content ──
  await runScenario(
    "Empty model response → fallback message",
    [textResponse("")],
    async () => {
      const result = await runBotAgent(ctx("???"));
      assert(result.ok, "ok");
      assert(result.reply.length > 0, "reply non-empty (sanitiser fallback)");
    }
  );

  // ── Scenario 9: tool loop hits 3-turn cap ───────────────────
  await runScenario(
    "Infinite tool loop is capped at 3 iterations",
    [
      toolCallResponse("list_inventory", {}),
      toolCallResponse("list_suppliers", {}),
      toolCallResponse("list_low_stock", {}),
      // Loop should exit here even though the model would call more.
    ],
    async () => {
      const result = await runBotAgent(ctx("inspect everything"));
      assert(result.ok, "ok");
      // After 3 iterations with no text reply, sanitiser fallback fires.
      assert(result.reply.length > 0, "reply non-empty after loop cap");
    }
  );

  // ── Scenario 10: tool error doesn't crash the bot ───────────
  await runScenario(
    "Tool error → bot replies gracefully",
    [
      toolCallResponse("place_restock_order", { item_id: "non-existent-item-id" }),
      textResponse("Couldn't find that item."),
    ],
    async () => {
      const result = await runBotAgent(ctx("order foo"));
      assert(result.ok, "ok");
      assert(result.reply === "Couldn't find that item.", "graceful reply after tool failure");
    }
  );

  // ── Cleanup ─────────────────────────────────────────────────
  await cleanup();

  // ── Summary ─────────────────────────────────────────────────
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  } else {
    console.log("\n🎉 ALL E2E SCENARIOS PASSED");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
