// Tests the live-view step recorder end-to-end:
//   - recordAgentStep persists a row with correct fields + sequence
//   - screenshot Buffer roundtrips through Prisma Bytes
//   - listAgentSteps omits the screenshot column (small payload)
//   - startAgentStep + finishAgentStep bracket pattern works
//   - humaniseStepName renders known internal IDs to readable labels
//   - multiple tasks get independent sequences

import { PrismaClient } from "../src/generated/prisma-postgres/client.js";

const db = new PrismaClient();
const {
  recordAgentStep,
  listAgentSteps,
  startAgentStep,
  finishAgentStep,
  humaniseStepName,
} = await import("../src/modules/automation/agent-steps.ts");

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

async function runScenario(name: string, fn: () => void | Promise<void>) {
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

async function findOrCreateLocation() {
  const loc = await db.location.findFirst({ select: { id: true } });
  if (loc) return loc;
  const business = await db.business.create({
    data: { name: "Step Test Cafe", slug: `step-${Date.now()}` },
  });
  return db.location.create({
    data: { businessId: business.id, name: "Step Test", timezone: "America/Toronto" },
    select: { id: true },
  });
}

async function createTestTask(locationId: string, title = "live-view test"): Promise<string> {
  const task = await db.agentTask.create({
    data: {
      locationId,
      type: "WEBSITE_ORDER_PREP",
      status: "PENDING",
      title,
      description: "Test",
    },
    select: { id: true },
  });
  return task.id;
}

const stamp = Date.now().toString(36);
const loc = await findOrCreateLocation();

const cleanup = async () => {
  // Cascade removes steps too.
  await db.agentTask.deleteMany({
    where: { locationId: loc.id, title: { contains: stamp } },
  });
};
await cleanup();

// ── humaniseStepName (pure function) ──────────────────────────────
await runScenario("humaniseStepName: maps known prefixes to readable labels", () => {
  assert(humaniseStepName("launched") === "Launched Chrome", "launched");
  assert(humaniseStepName("landing") === "Loaded supplier homepage", "landing");
  assert(
    humaniseStepName("search-espresso machine") === "Searching: espresso machine",
    "search-<query>"
  );
  assert(
    humaniseStepName("product-direct-urnex cafiza") === "Loading product: urnex cafiza",
    "product-direct-<query>"
  );
  assert(
    humaniseStepName("added-urnex cafiza") === "Added to cart: urnex cafiza",
    "added-<query>"
  );
  assert(humaniseStepName("cart-final") === "Viewing cart", "cart-final");
  assert(
    humaniseStepName("login-no-email-field") === "Login failed: email field missing",
    "login-no-email-field"
  );
  assert(
    humaniseStepName("after-cookie-login") === "Signed in via saved cookies",
    "after-cookie-login"
  );
});

await runScenario("humaniseStepName: unknown prefix → title-case fallback", () => {
  assert(humaniseStepName("weird_event") === "Weird Event", "snake case");
  assert(humaniseStepName("some-thing-else") === "Some Thing Else", "kebab case");
  assert(humaniseStepName("") === "Step", "empty → 'Step'");
});

// ── recordAgentStep roundtrip ──────────────────────────────────────
await runScenario("recordAgentStep: writes row + auto-sequences", async () => {
  const taskId = await createTestTask(loc.id, `record-test ${stamp}`);
  await recordAgentStep(taskId, { name: "launched", status: "ok" });
  await recordAgentStep(taskId, { name: "landing", status: "ok", notes: "opened site" });
  await recordAgentStep(taskId, { name: "search-x", status: "ok" });

  const steps = await listAgentSteps(taskId);
  assert(steps.length === 3, `3 steps written (got ${steps.length})`);
  assert(steps[0].sequence === 1, `first sequence = 1 (got ${steps[0].sequence})`);
  assert(steps[1].sequence === 2, "second sequence = 2");
  assert(steps[2].sequence === 3, "third sequence = 3");
  assert(steps[1].notes === "opened site", "notes preserved");
  assert(steps[0].status === "ok", "status preserved");
});

await runScenario("recordAgentStep: screenshot Buffer roundtrips cleanly", async () => {
  const taskId = await createTestTask(loc.id, `screenshot-test ${stamp}`);
  // Realistic-ish JPEG: minimal valid JPEG magic bytes + body.
  const fakeJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    ...Array.from({ length: 500 }, (_, i) => i % 256),
    0xff, 0xd9,
  ]);

  await recordAgentStep(taskId, {
    name: "cart-final",
    status: "ok",
    screenshot: fakeJpeg,
    notes: "cart ready",
  });

  const row = await db.agentTaskStep.findFirst({
    where: { agentTaskId: taskId, name: "cart-final" },
    select: { screenshot: true, notes: true },
  });

  assert(row?.screenshot != null, "screenshot persisted");
  const stored = row?.screenshot as Uint8Array;
  assert(stored.length === fakeJpeg.length, "byte length matches");
  assert(stored[0] === 0xff && stored[1] === 0xd8, "JPEG magic bytes preserved");
  assert(stored[stored.length - 1] === 0xd9, "JPEG end-marker preserved");
  assert(row?.notes === "cart ready", "notes preserved with screenshot");
});

// ── listAgentSteps excludes the big screenshot column ─────────────
await runScenario("listAgentSteps: returns lean rows (no screenshot bytes)", async () => {
  const taskId = await createTestTask(loc.id, `lean-test ${stamp}`);
  await recordAgentStep(taskId, {
    name: "x",
    status: "ok",
    screenshot: Buffer.alloc(100_000, 0x42),
  });
  const steps = await listAgentSteps(taskId);
  assert(steps.length === 1, "got 1 step");
  assert(
    !("screenshot" in steps[0]),
    "screenshot field absent (would bloat the poll response)"
  );
  // Sanity-check the select: expected lean fields present.
  assert("name" in steps[0], "name present");
  assert("status" in steps[0], "status present");
  assert("sequence" in steps[0], "sequence present");
});

// ── startAgentStep + finishAgentStep bracket ──────────────────────
await runScenario("startAgentStep + finishAgentStep: 'running' → 'ok' transition", async () => {
  const taskId = await createTestTask(loc.id, `bracket-test ${stamp}`);
  const ref = await startAgentStep(taskId, "long-running", "working...");
  assert(ref !== null, "ref returned");
  const midway = await listAgentSteps(taskId);
  assert(midway.length === 1, "row exists mid-flight");
  assert(midway[0].status === "running", "status = running during work");
  assert(midway[0].endedAt === null, "endedAt null during work");

  await finishAgentStep(ref, {
    status: "ok",
    notes: "complete",
    screenshot: Buffer.from("XXXX"),
  });
  const after = await listAgentSteps(taskId);
  assert(after[0].status === "ok", "status flipped to ok");
  assert(after[0].endedAt !== null, "endedAt populated");
  assert(after[0].notes === "complete", "notes updated");
});

// ── Multiple tasks have independent sequences ─────────────────────
await runScenario("Sequences are scoped per task", async () => {
  const a = await createTestTask(loc.id, `indep-a ${stamp}`);
  const b = await createTestTask(loc.id, `indep-b ${stamp}`);
  await recordAgentStep(a, { name: "a1", status: "ok" });
  await recordAgentStep(a, { name: "a2", status: "ok" });
  await recordAgentStep(b, { name: "b1", status: "ok" });
  const aSteps = await listAgentSteps(a);
  const bSteps = await listAgentSteps(b);
  assert(aSteps.length === 2 && aSteps[1].sequence === 2, "task A → seq 1,2");
  assert(bSteps.length === 1 && bSteps[0].sequence === 1, "task B → seq 1 (independent)");
});

// ── Cleanup ───────────────────────────────────────────────────────
await cleanup();

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  await db.$disconnect();
  process.exit(1);
}
console.log("\n🎉 ALL AGENT-STEP TESTS PASSED");
await db.$disconnect();
