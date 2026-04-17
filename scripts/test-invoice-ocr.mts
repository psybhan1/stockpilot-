// Tests for the supplier-invoice-OCR surface:
//
//   - parseInvoiceImage sends the right prompt shape + image to the
//     vision API and coerces the response into our typed schema
//   - coerceParsedResponse tolerates malformed / hallucinated JSON
//     (e.g. model invents a lineId, returns a negative quantity,
//     emits a non-number unit cost)
//   - classifyPriceVariance & classifyQuantityShortfall return the
//     right severity buckets at the threshold boundaries
//   - deliverPurchaseOrder, when given actual unit costs, writes
//     them to the PO line, updates SupplierItem.lastUnitCostCents,
//     and emits the variance audit row
//
// Vision-API calls are mocked with a fake fetch so we never hit
// Groq during tests. The live model's accuracy is checked manually.

process.env.N8N_WEBHOOK_SECRET =
  process.env.N8N_WEBHOOK_SECRET ?? "test-webhook-secret-for-invoice-ocr";

import { PrismaClient } from "../src/generated/prisma-postgres/client.js";

const { Role } = await import("../src/lib/domain-enums.ts");
const {
  parseInvoiceImage,
  coerceParsedResponse,
  classifyPriceVariance,
  classifyQuantityShortfall,
} = await import("../src/modules/invoices/parse.ts");
const { deliverPurchaseOrder } = await import(
  "../src/modules/purchasing/service.ts"
);

const db = new PrismaClient();

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

async function scenario(name: string, fn: () => Promise<void> | void) {
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

// ── Variance classification ─────────────────────────────────────────

await scenario("classifyPriceVariance: below 5% is 'none'", () => {
  const v = classifyPriceVariance(1000, 1030);
  assert(v.severity === "none", `severity=${v.severity}`);
  assert(v.deltaPct != null && Math.abs(v.deltaPct - 0.03) < 0.0001, "deltaPct ~ 0.03");
});

await scenario("classifyPriceVariance: exactly 5% is 'watch'", () => {
  const v = classifyPriceVariance(1000, 1050);
  assert(v.severity === "watch", `severity=${v.severity}`);
});

await scenario("classifyPriceVariance: exactly 15% is 'review'", () => {
  const v = classifyPriceVariance(1000, 1150);
  assert(v.severity === "review", `severity=${v.severity}`);
});

await scenario("classifyPriceVariance: negative (supplier discount) still flagged", () => {
  // Covers the "supplier billed me LESS than quoted" case — user
  // should know about this too (maybe they got a promo, maybe the
  // invoice is wrong).
  const v = classifyPriceVariance(1000, 800);
  assert(v.severity === "review", `20% under flagged for review (got ${v.severity})`);
  assert(v.deltaPct != null && v.deltaPct === -0.2, `deltaPct=-0.2 (got ${v.deltaPct})`);
});

await scenario("classifyPriceVariance: null inputs → none", () => {
  assert(classifyPriceVariance(null, 100).severity === "none", "null expected");
  assert(classifyPriceVariance(100, null).severity === "none", "null actual");
  assert(classifyPriceVariance(0, 100).severity === "none", "zero expected (can't divide)");
});

await scenario("classifyQuantityShortfall: overage → none", () => {
  // Getting MORE than ordered isn't a problem worth flagging here —
  // just surfaces on the form. Shortfall is the one that hurts the menu.
  assert(classifyQuantityShortfall(10, 12) === "none", "12 of 10 is none");
});

await scenario("classifyQuantityShortfall: thresholds", () => {
  assert(classifyQuantityShortfall(10, 10) === "none", "exactly 10 of 10");
  assert(classifyQuantityShortfall(100, 99) === "none", "1% shortfall → none");
  assert(classifyQuantityShortfall(10, 9) === "watch", "10% shortfall → watch");
  assert(classifyQuantityShortfall(20, 19) === "watch", "5% shortfall → watch");
  assert(classifyQuantityShortfall(10, 7) === "review", "30% shortfall → review");
  assert(classifyQuantityShortfall(10, null) === "none", "null receipt → none");
});

// ── coerceParsedResponse: malformed input handling ──────────────────

const poContext = [
  {
    lineId: "line-1",
    description: "Milk 2% 4L",
    inventoryItemName: "Milk 2%",
    quantityOrdered: 3,
    purchaseUnit: "case",
    packSizeBase: 4000,
    expectedUnitCostCents: 1200,
  },
  {
    lineId: "line-2",
    description: "Tomatoes Roma",
    inventoryItemName: "Tomatoes",
    quantityOrdered: 5,
    purchaseUnit: "pound",
    packSizeBase: 454,
    expectedUnitCostCents: 250,
  },
];

await scenario("coerceParsedResponse: happy path preserves well-formed lines", () => {
  const raw = JSON.stringify({
    lines: [
      {
        lineId: "line-1",
        rawDescription: "MILK 2% 4L BAG",
        quantityPacks: 3,
        unitCostCents: 1245,
        confidence: "high",
        note: "clear line",
      },
    ],
    totals: { subtotalCents: 3735, taxCents: 374, totalCents: 4109 },
    summary: "Milk delivery, normal",
  });
  const res = coerceParsedResponse(raw, poContext);
  assert(res.ok, "ok=true");
  assert(res.lines.length === 1, "one line returned");
  assert(res.lines[0].lineId === "line-1", "lineId kept");
  assert(res.lines[0].unitCostCents === 1245, "cost preserved");
  assert(res.totals?.totalCents === 4109, "total preserved");
  assert(res.summary === "Milk delivery, normal", "summary preserved");
});

await scenario("coerceParsedResponse: invalid JSON → ok=false, no throw", () => {
  const res = coerceParsedResponse("{ malformed", poContext);
  assert(!res.ok, "ok=false");
  assert(res.lines.length === 0, "no lines");
  assert(typeof res.reason === "string" && res.reason.length > 0, "reason set");
});

await scenario("coerceParsedResponse: model invents a lineId → coerced to null", () => {
  const raw = JSON.stringify({
    lines: [
      {
        lineId: "line-999-made-up",
        rawDescription: "Mystery Product",
        quantityPacks: 1,
        unitCostCents: 500,
        confidence: "low",
        note: "unmatched",
      },
    ],
  });
  const res = coerceParsedResponse(raw, poContext);
  assert(res.ok, "ok=true");
  assert(res.lines.length === 1, "line kept but...");
  assert(res.lines[0].lineId === null, "invalid lineId nulled (UI lists as 'new item')");
});

await scenario("coerceParsedResponse: negative / NaN / string numbers rejected", () => {
  const raw = JSON.stringify({
    lines: [
      {
        lineId: "line-1",
        rawDescription: "Milk",
        quantityPacks: -5,
        unitCostCents: "twelve",
        confidence: "high",
      },
      {
        lineId: "line-2",
        rawDescription: "Tomato",
        quantityPacks: NaN,
        unitCostCents: 250,
        confidence: "medium",
      },
    ],
  });
  const res = coerceParsedResponse(raw, poContext);
  assert(res.ok, "ok=true");
  assert(res.lines[0].quantityPacks === null, "negative qty nulled");
  assert(res.lines[0].unitCostCents === null, "non-number cost nulled");
  assert(res.lines[1].quantityPacks === null, "NaN qty nulled");
  assert(res.lines[1].unitCostCents === 250, "good cost kept on line 2");
});

await scenario("coerceParsedResponse: bad confidence coerced to 'low'", () => {
  const raw = JSON.stringify({
    lines: [
      {
        lineId: "line-1",
        rawDescription: "Milk",
        quantityPacks: 3,
        unitCostCents: 1200,
        confidence: "absolutely-certain",
      },
    ],
  });
  const res = coerceParsedResponse(raw, poContext);
  assert(res.lines[0].confidence === "low", "unknown confidence string defaults to 'low'");
});

await scenario("coerceParsedResponse: missing rawDescription → row dropped", () => {
  const raw = JSON.stringify({
    lines: [
      { lineId: "line-1", quantityPacks: 3, unitCostCents: 1200 },
      { lineId: "line-2", rawDescription: "Tomato", quantityPacks: 5, unitCostCents: 250 },
    ],
  });
  const res = coerceParsedResponse(raw, poContext);
  assert(res.lines.length === 1, "row without description dropped");
  assert(res.lines[0].lineId === "line-2", "other row kept");
});

// ── parseInvoiceImage: full wire shape ──────────────────────────────

await scenario("parseInvoiceImage: fetch payload includes image + PO context", async () => {
  let capturedBody: string | null = null;
  const fakeFetch = async (_url: string, init?: RequestInit) => {
    capturedBody = init?.body as string;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                lines: [
                  {
                    lineId: "line-1",
                    rawDescription: "Milk 2% 4L",
                    quantityPacks: 3,
                    unitCostCents: 1200,
                    confidence: "high",
                    note: "ok",
                  },
                ],
                totals: { totalCents: 3600 },
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const res = await parseInvoiceImage({
    imageDataUrl: "data:image/jpeg;base64,/9j/AAAA",
    imageContentType: "image/jpeg",
    poContext: {
      orderNumber: "PO-TEST",
      supplierName: "Acme Foods",
      lines: poContext,
    },
    apiKey: "test-key",
    fetchImpl: fakeFetch as typeof fetch,
  });

  assert(res.ok, "ok=true");
  assert(res.lines.length === 1, "one line parsed");
  assert(capturedBody !== null, "body captured");
  const parsed = JSON.parse(capturedBody!);
  assert(parsed.model.includes("llama"), `llama model (got ${parsed.model})`);
  assert(parsed.temperature === 0, "deterministic temperature");
  assert(
    parsed.messages[1].content.some(
      (c: { type: string; image_url?: { url: string } }) =>
        c.type === "image_url" && c.image_url?.url?.startsWith("data:image/")
    ),
    "image payload included"
  );
  assert(
    parsed.messages[1].content.some(
      (c: { type: string; text?: string }) =>
        c.type === "text" && c.text?.includes("id=line-1")
    ),
    "PO context with line ids included"
  );
});

await scenario("parseInvoiceImage: missing API key → ok=false, no network call", async () => {
  let fetchCalls = 0;
  const res = await parseInvoiceImage({
    imageDataUrl: "data:image/jpeg;base64,/9j/AAAA",
    imageContentType: "image/jpeg",
    poContext: { orderNumber: "PO-X", supplierName: "X", lines: [] },
    apiKey: undefined,
    fetchImpl: (async () => {
      fetchCalls += 1;
      return new Response("", { status: 200 });
    }) as typeof fetch,
  });
  assert(!res.ok, "ok=false");
  assert(fetchCalls === 0, "no network call on missing key");
  assert(typeof res.reason === "string" && res.reason.includes("GROQ_API_KEY"), "reason mentions env var");
});

await scenario("parseInvoiceImage: non-data URL → ok=false", async () => {
  const res = await parseInvoiceImage({
    imageDataUrl: "https://example.com/invoice.jpg",
    imageContentType: "image/jpeg",
    poContext: { orderNumber: "PO-X", supplierName: "X", lines: [] },
    apiKey: "test-key",
    fetchImpl: fetch,
  });
  assert(!res.ok, "ok=false");
  assert(typeof res.reason === "string" && res.reason.includes("data URL"), "reason mentions data URL requirement");
});

await scenario("parseInvoiceImage: vision API 500 → ok=false with reason", async () => {
  const res = await parseInvoiceImage({
    imageDataUrl: "data:image/jpeg;base64,/9j/AAAA",
    imageContentType: "image/jpeg",
    poContext: { orderNumber: "PO-X", supplierName: "X", lines: [] },
    apiKey: "test-key",
    fetchImpl: (async () =>
      new Response("upstream gone", { status: 503 })) as typeof fetch,
  });
  assert(!res.ok, "ok=false");
  assert(typeof res.reason === "string" && res.reason.includes("503"), "reason includes status");
});

// ── Full DB roundtrip: delivery with actuals ────────────────────────

const stamp = Date.now().toString(36);
let businessCounter = 0;

async function buildBusiness() {
  const suffix = `${stamp}-${++businessCounter}-${Math.random().toString(36).slice(2, 6)}`;
  const business = await db.business.create({
    data: { name: `Invoice Test ${suffix}`, slug: `inv-${suffix}` },
  });
  const location = await db.location.create({
    data: {
      businessId: business.id,
      name: "Test Cafe",
      timezone: "America/Toronto",
    },
  });
  const user = await db.user.create({
    data: {
      email: `inv-${suffix}@example.com`,
      name: "Invoice Tester",
      passwordHash: "test-password-hash",
      roles: { create: { locationId: location.id, role: Role.MANAGER } },
    },
  });
  return { business, location, user, suffix };
}

await scenario(
  "deliverPurchaseOrder with actualUnitCostsCents updates PO line + SupplierItem + audits variance",
  async () => {
    const { location, user } = await buildBusiness();
    const supplier = await db.supplier.create({
      data: {
        locationId: location.id,
        name: "Acme Foods",
        orderingMode: "EMAIL",
        email: "acme@example.com",
      },
    });
    const item = await db.inventoryItem.create({
      data: {
        locationId: location.id,
        name: "Milk 2%",
        sku: `MILK-${stamp}-${businessCounter}`,
        category: "DAIRY",
        displayUnit: "LITER",
        baseUnit: "MILLILITER",
        countUnit: "MILLILITER",
        purchaseUnit: "LITER",
        packSizeBase: 4000,
        parLevelBase: 20000,
        lowStockThresholdBase: 8000,
        safetyStockBase: 4000,
      },
    });
    await db.supplierItem.create({
      data: {
        supplierId: supplier.id,
        inventoryItemId: item.id,
        packSizeBase: 4000,
        lastUnitCostCents: 1200,
      },
    });

    const po = await db.purchaseOrder.create({
      data: {
        locationId: location.id,
        supplierId: supplier.id,
        orderNumber: `PO-INV-${stamp}`,
        status: "DRAFT",
        totalLines: 1,
        lines: {
          create: {
            inventoryItemId: item.id,
            description: "Milk 2% 4L case",
            quantityOrdered: 3,
            expectedQuantityBase: 12000,
            purchaseUnit: "CASE",
            packSizeBase: 4000,
            latestCostCents: 1200,
          },
        },
      },
      include: { lines: true },
    });

    // Move to SENT directly (canDeliver is status-gated).
    await db.purchaseOrder.update({
      where: { id: po.id },
      data: { status: "SENT", sentAt: new Date() },
    });

    const line = po.lines[0];
    const delivered = await deliverPurchaseOrder({
      purchaseOrderId: po.id,
      userId: user.id,
      notes: "invoice scanned + applied",
      lineReceipts: { [line.id]: 3 },
      actualUnitCostsCents: { [line.id]: 1400 }, // 16.67% over → review
    });

    assert(delivered.status === "DELIVERED", "PO reached DELIVERED");

    const updatedLine = await db.purchaseOrderLine.findUnique({
      where: { id: line.id },
      select: { actualUnitCostCents: true, actualQuantityBase: true, notes: true },
    });
    assert(updatedLine?.actualUnitCostCents === 1400, "actualUnitCostCents stored");
    assert(updatedLine?.actualQuantityBase === 12000, "actualQuantityBase stored");
    assert(
      typeof updatedLine?.notes === "string" && updatedLine.notes.includes("$14.00"),
      "line note mentions actual price"
    );

    // SupplierItem should now reflect the 1400 as the latest paid.
    const supplierItem = await db.supplierItem.findUnique({
      where: {
        supplierId_inventoryItemId: {
          supplierId: supplier.id,
          inventoryItemId: item.id,
        },
      },
      select: { lastUnitCostCents: true },
    });
    assert(
      supplierItem?.lastUnitCostCents === 1400,
      `SupplierItem price history updated (got ${supplierItem?.lastUnitCostCents})`
    );

    // Variance audit log emitted?
    const audits = await db.auditLog.findMany({
      where: {
        entityId: line.id,
        entityType: "purchaseOrderLine",
        action: "purchaseOrder.priceVariance.review",
      },
    });
    assert(audits.length === 1, "1 variance-review audit row written");
    const details = audits[0].details as {
      deltaPct?: number;
      actualCents?: number;
      expectedCents?: number;
    };
    assert(details.actualCents === 1400, "audit has actualCents");
    assert(details.expectedCents === 1200, "audit has expectedCents");
    assert(
      details.deltaPct != null && Math.abs(details.deltaPct - 0.1667) < 0.001,
      `audit deltaPct ≈ 0.1667 (got ${details.deltaPct})`
    );
  }
);

await scenario(
  "deliverPurchaseOrder without actual costs still works (nothing written, no variance audit)",
  async () => {
    const { location, user } = await buildBusiness();
    const supplier = await db.supplier.create({
      data: {
        locationId: location.id,
        name: "Acme2",
        orderingMode: "EMAIL",
        email: "acme2@example.com",
      },
    });
    const item = await db.inventoryItem.create({
      data: {
        locationId: location.id,
        name: "Tomato",
        sku: `TOM-${stamp}-${businessCounter}`,
        category: "BAKERY_INGREDIENT",
        displayUnit: "KILOGRAM",
        baseUnit: "GRAM",
        countUnit: "GRAM",
        purchaseUnit: "KILOGRAM",
        packSizeBase: 454,
        parLevelBase: 4540,
        lowStockThresholdBase: 908,
        safetyStockBase: 908,
      },
    });
    await db.supplierItem.create({
      data: {
        supplierId: supplier.id,
        inventoryItemId: item.id,
        packSizeBase: 454,
        lastUnitCostCents: 250,
      },
    });
    const po = await db.purchaseOrder.create({
      data: {
        locationId: location.id,
        supplierId: supplier.id,
        orderNumber: `PO-NOACT-${stamp}`,
        status: "SENT",
        sentAt: new Date(),
        totalLines: 1,
        lines: {
          create: {
            inventoryItemId: item.id,
            description: "Roma 1kg",
            quantityOrdered: 5,
            expectedQuantityBase: 2270,
            purchaseUnit: "KILOGRAM",
            packSizeBase: 454,
            latestCostCents: 250,
          },
        },
      },
      include: { lines: true },
    });
    const line = po.lines[0];

    await deliverPurchaseOrder({
      purchaseOrderId: po.id,
      userId: user.id,
      lineReceipts: { [line.id]: 5 },
      // No actualUnitCostsCents passed — manual "just received" flow.
    });

    const updatedLine = await db.purchaseOrderLine.findUnique({
      where: { id: line.id },
      select: { actualUnitCostCents: true, actualQuantityBase: true },
    });
    assert(updatedLine?.actualUnitCostCents == null, "actual cost stays null");
    assert(updatedLine?.actualQuantityBase === 2270, "actualQuantityBase still captured");

    const si = await db.supplierItem.findUnique({
      where: {
        supplierId_inventoryItemId: {
          supplierId: supplier.id,
          inventoryItemId: item.id,
        },
      },
      select: { lastUnitCostCents: true },
    });
    assert(si?.lastUnitCostCents === 250, "SupplierItem price unchanged (no actuals to apply)");

    const audits = await db.auditLog.findMany({
      where: {
        entityId: line.id,
        action: { startsWith: "purchaseOrder.priceVariance" },
      },
    });
    assert(audits.length === 0, "no variance audit without actuals");
  }
);

// ── Cleanup ─────────────────────────────────────────────────────────

async function cleanup() {
  const biz = await db.business.findMany({
    where: { slug: { startsWith: `inv-${stamp}` } },
    select: { id: true, locations: { select: { id: true } } },
  });
  const locIds = biz.flatMap((b) => b.locations.map((l) => l.id));
  if (locIds.length > 0) {
    await db.auditLog.deleteMany({ where: { locationId: { in: locIds } } });
    await db.stockMovement.deleteMany({
      where: { inventoryItem: { locationId: { in: locIds } } },
    });
    await db.supplierItem.deleteMany({
      where: { supplier: { locationId: { in: locIds } } },
    });
    await db.purchaseOrderLine.deleteMany({
      where: { purchaseOrder: { locationId: { in: locIds } } },
    });
    await db.purchaseOrder.deleteMany({ where: { locationId: { in: locIds } } });
    await db.inventoryItem.deleteMany({ where: { locationId: { in: locIds } } });
    await db.supplier.deleteMany({ where: { locationId: { in: locIds } } });
    await db.userLocationRole.deleteMany({ where: { locationId: { in: locIds } } });
    await db.location.deleteMany({ where: { id: { in: locIds } } });
  }
  await db.user.deleteMany({
    where: { email: { contains: `inv-${stamp}` } },
  });
  await db.business.deleteMany({
    where: { slug: { startsWith: `inv-${stamp}` } },
  });
}
await cleanup();

// ── Report ──────────────────────────────────────────────────────────

console.log(
  `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPassed: ${passed}\nFailed: ${failed}${
    failed > 0 ? "\n\nFailures:\n  - " + failures.join("\n  - ") : ""
  }`
);
if (failed > 0) process.exit(1);
else console.log("\n🎉 ALL INVOICE-OCR TESTS PASSED");

await db.$disconnect();
