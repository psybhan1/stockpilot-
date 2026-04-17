// Auto-approve rule for EMAIL-mode orders — the "while you sleep"
// path. Verifies:
//   1. Location with threshold + EMAIL supplier + PO under cap →
//      PO goes straight to SENT (status, audit log).
//   2. Same setup but PO total > cap → stays at AWAITING_APPROVAL.
//   3. WEBSITE supplier even under cap → stays at AWAITING_APPROVAL
//      (deliberate: website orders need the user's browser).
//   4. Threshold == null → no auto-approve, ever.
//   5. Missing line price → no auto-approve (safety guard).
//
// Uses the real DB + real dispatch path. No mocks.

process.env.N8N_WEBHOOK_SECRET =
  process.env.N8N_WEBHOOK_SECRET ?? "test-auto-approve-secret";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-auto-approve-session";
process.env.DEFAULT_EMAIL_PROVIDER = "console"; // no real email sends

import { PrismaClient } from "../src/generated/prisma-postgres/client.js";

const { maybeAutoApprovePurchaseOrder } = await import(
  "../src/modules/purchasing/auto-approve.ts"
);

const db = new PrismaClient();

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: unknown, label: string, detail?: string) {
  if (cond) {
    passed += 1;
    console.log(`    ✅ ${label}`);
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`    ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const STAMP = Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
let worldCounter = 0;

type World = {
  businessId: string;
  locationId: string;
  userId: string;
  emailSupplierId: string;
  websiteSupplierId: string;
  itemId: string;
};

async function seedWorld(autoApproveCents: number | null): Promise<World> {
  const n = ++worldCounter;
  const business = await db.business.create({
    data: { name: `AA-${STAMP}-${n}`, slug: `aa-${STAMP}-${n}-${Math.random().toString(36).slice(2, 6)}` },
  });
  const location = await db.location.create({
    data: {
      businessId: business.id,
      name: "Main",
      timezone: "America/Toronto",
      autoApproveEmailUnderCents: autoApproveCents,
    },
  });
  const user = await db.user.create({
    data: {
      email: `aa-${STAMP}-${Math.random().toString(36).slice(2, 6)}@test.local`,
      name: "Auto Tester",
      passwordHash: "x",
    },
  });
  await db.userLocationRole.create({
    data: { userId: user.id, locationId: location.id, role: "MANAGER" },
  });

  const emailSupplier = await db.supplier.create({
    data: {
      locationId: location.id,
      name: "Sysco",
      orderingMode: "EMAIL",
      email: "orders@sysco-test.example",
      leadTimeDays: 2,
    },
  });
  const websiteSupplier = await db.supplier.create({
    data: {
      locationId: location.id,
      name: "Costco",
      orderingMode: "WEBSITE",
      website: "https://www.costco.com",
      leadTimeDays: 2,
    },
  });

  const item = await db.inventoryItem.create({
    data: {
      locationId: location.id,
      name: "Oat Milk",
      sku: `SKU-${STAMP}-${n}-oat`,
      category: "ALT_DAIRY",
      baseUnit: "MILLILITER",
      displayUnit: "MILLILITER",
      countUnit: "MILLILITER",
      purchaseUnit: "CASE",
      packSizeBase: 1000,
      stockOnHandBase: 4000,
      parLevelBase: 16000,
      safetyStockBase: 4000,
      lowStockThresholdBase: 8000,
    },
  });

  return {
    businessId: business.id,
    locationId: location.id,
    userId: user.id,
    emailSupplierId: emailSupplier.id,
    websiteSupplierId: websiteSupplier.id,
    itemId: item.id,
  };
}

async function draftPO(params: {
  world: World;
  supplierId: string;
  quantity: number;
  unitCostCents: number | null;
}): Promise<string> {
  const orderNumber = `PO-AA-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const po = await db.purchaseOrder.create({
    data: {
      locationId: params.world.locationId,
      supplierId: params.supplierId,
      orderNumber,
      status: "AWAITING_APPROVAL",
      totalLines: 1,
      placedById: params.world.userId,
    },
  });
  await db.purchaseOrderLine.create({
    data: {
      purchaseOrderId: po.id,
      inventoryItemId: params.world.itemId,
      description: "Oat Milk",
      quantityOrdered: params.quantity,
      expectedQuantityBase: params.quantity * 1000,
      purchaseUnit: "CASE",
      packSizeBase: 1000,
      latestCostCents: params.unitCostCents,
    },
  });
  return po.id;
}

async function teardown(worlds: World[]) {
  for (const w of worlds) {
    await db.purchaseOrderLine.deleteMany({
      where: { purchaseOrder: { locationId: w.locationId } },
    });
    await db.supplierCommunication.deleteMany({
      where: { purchaseOrder: { locationId: w.locationId } },
    });
    await db.purchaseOrder.deleteMany({ where: { locationId: w.locationId } });
    await db.agentTask.deleteMany({ where: { locationId: w.locationId } });
    await db.supplierItem.deleteMany({
      where: { supplier: { locationId: w.locationId } },
    });
    await db.supplier.deleteMany({ where: { locationId: w.locationId } });
    await db.inventoryItem.deleteMany({ where: { locationId: w.locationId } });
    await db.userLocationRole.deleteMany({ where: { locationId: w.locationId } });
    await db.auditLog.deleteMany({ where: { locationId: w.locationId } });
    await db.location.deleteMany({ where: { id: w.locationId } });
    await db.user.deleteMany({ where: { id: w.userId } });
    await db.business.deleteMany({ where: { id: w.businessId } });
  }
}

const worlds: World[] = [];

try {
  // ── Scenario 1: under threshold, email supplier, priced → SENT ──
  console.log("\n━━ Under threshold + email supplier + priced → auto-sent");
  {
    const w = await seedWorld(20000); // $200 cap
    worlds.push(w);
    const poId = await draftPO({
      world: w,
      supplierId: w.emailSupplierId,
      quantity: 3,
      unitCostCents: 4200, // $42/case × 3 = $126 → under $200
    });
    const result = await maybeAutoApprovePurchaseOrder({
      purchaseOrderId: poId,
      userId: w.userId,
    });
    assert(result.autoApproved, "autoApproved=true");
    if (result.autoApproved) {
      assert(result.totalCents === 12600, `total matches (got ${result.totalCents})`);
      assert(result.thresholdCents === 20000, "threshold echoed");
      assert(result.status === "SENT", `status=SENT (got ${result.status})`);
    }
    const fresh = await db.purchaseOrder.findUnique({
      where: { id: poId },
      select: { status: true, sentAt: true },
    });
    assert(fresh?.status === "SENT", "DB row promoted to SENT");
    assert(fresh?.sentAt != null, "sentAt timestamp set");
  }

  // ── Scenario 2: over threshold → stays awaiting ──
  console.log("\n━━ Over threshold → stays AWAITING_APPROVAL");
  {
    const w = await seedWorld(5000); // $50 cap
    worlds.push(w);
    const poId = await draftPO({
      world: w,
      supplierId: w.emailSupplierId,
      quantity: 3,
      unitCostCents: 4200, // $126 > $50
    });
    const result = await maybeAutoApprovePurchaseOrder({
      purchaseOrderId: poId,
      userId: w.userId,
    });
    assert(!result.autoApproved, "autoApproved=false");
    if (!result.autoApproved) {
      assert(/total .* > cap/i.test(result.reason), `reason mentions cap (got "${result.reason}")`);
    }
    const fresh = await db.purchaseOrder.findUnique({
      where: { id: poId },
      select: { status: true },
    });
    assert(fresh?.status === "AWAITING_APPROVAL", "DB row stays AWAITING_APPROVAL");
  }

  // ── Scenario 3: website supplier, under cap → still doesn't fire ──
  console.log("\n━━ Website supplier under cap → no auto-approve");
  {
    const w = await seedWorld(20000);
    worlds.push(w);
    const poId = await draftPO({
      world: w,
      supplierId: w.websiteSupplierId,
      quantity: 1,
      unitCostCents: 1000,
    });
    const result = await maybeAutoApprovePurchaseOrder({
      purchaseOrderId: poId,
      userId: w.userId,
    });
    assert(!result.autoApproved, "autoApproved=false for website supplier");
    if (!result.autoApproved) {
      assert(/website/i.test(result.reason), "reason mentions ordering mode");
    }
  }

  // ── Scenario 4: threshold unset → never fires ──
  console.log("\n━━ No threshold set → no auto-approve");
  {
    const w = await seedWorld(null);
    worlds.push(w);
    const poId = await draftPO({
      world: w,
      supplierId: w.emailSupplierId,
      quantity: 1,
      unitCostCents: 1000,
    });
    const result = await maybeAutoApprovePurchaseOrder({
      purchaseOrderId: poId,
      userId: w.userId,
    });
    assert(!result.autoApproved, "autoApproved=false with null threshold");
    if (!result.autoApproved) {
      assert(/threshold not set/i.test(result.reason), "reason mentions threshold missing");
    }
  }

  // ── Scenario 5: line without price → refuses to auto-approve ──
  console.log("\n━━ Line missing price → refuses to auto-approve");
  {
    const w = await seedWorld(20000);
    worlds.push(w);
    const poId = await draftPO({
      world: w,
      supplierId: w.emailSupplierId,
      quantity: 3,
      unitCostCents: null, // no price
    });
    const result = await maybeAutoApprovePurchaseOrder({
      purchaseOrderId: poId,
      userId: w.userId,
    });
    assert(!result.autoApproved, "autoApproved=false when price unknown");
    if (!result.autoApproved) {
      assert(/no price|can't safely/i.test(result.reason), "reason mentions price");
    }
  }

  // ── Scenario 6: same PO called twice → second call is no-op ──
  console.log("\n━━ Idempotent: calling twice after auto-approve stays SENT");
  {
    const w = await seedWorld(20000);
    worlds.push(w);
    const poId = await draftPO({
      world: w,
      supplierId: w.emailSupplierId,
      quantity: 1,
      unitCostCents: 1000,
    });
    const first = await maybeAutoApprovePurchaseOrder({
      purchaseOrderId: poId,
      userId: w.userId,
    });
    assert(first.autoApproved, "first call: autoApproved=true");
    const second = await maybeAutoApprovePurchaseOrder({
      purchaseOrderId: poId,
      userId: w.userId,
    });
    assert(!second.autoApproved, "second call: no-op (PO already sent)");
    if (!second.autoApproved) {
      assert(/sent/i.test(second.reason), `reason mentions 'sent' (got "${second.reason}")`);
    }
  }
} finally {
  await teardown(worlds);
  await db.$disconnect();
}

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\n🎉 ALL AUTO-APPROVE TESTS PASSED");
