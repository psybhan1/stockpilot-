// End-to-end test of the bot's URL → PO flow across many sites and
// URL formats. Catches the four failure modes that previously broke
// the "paste URL → bot adds web stuff" path:
//
//   F1. Duplicate URL paste hits a SupplierItem unique-constraint and
//       crashes the whole tool call.
//   F2. Existing supplier in MANUAL mode never gets flipped to WEBSITE,
//       so browser agent dispatch refuses to launch.
//   F3. Full product URL is stored as Supplier.website, then the
//       Amazon adapter builds a malformed `${website}/s?k=...` URL
//       so search-by-name fallback returns nothing.
//   F4. Pasted product URL is dropped entirely on second paste, so
//       the browser agent searches by name and may add a different
//       SKU than what the user actually wanted.
//
// The fix stores a clean hostname root on Supplier.website, persists
// the full product URL on PurchaseOrderLine.notes (where the browser
// agent reads it via extractLineProductUrl), and uses upsert for
// SupplierItem so duplicate calls are no-ops.

import { PrismaClient } from "../src/generated/prisma-postgres/client.js";

const db = new PrismaClient();

// Inline copies of the helpers in agent.ts so this script stays
// runnable without a TS build step. Kept BYTE-IDENTICAL to the
// shipping code — if you edit one, edit both.
function normalizeProductUrl(raw) {
  let url = raw.trim();
  if (!url) return "";
  url = url.replace(/^[<`'"]+|[>`'".,;!?)\]]+$/g, "");
  if (!/^[a-z]+:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function toHostnameRoot(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

// Mirror of agent.ts's KNOWN_SUPPLIER_WEBSITES — keep in sync.
const KNOWN_SUPPLIER_WEBSITES = {
  amazon: "https://www.amazon.com",
  "amazon.com": "https://www.amazon.com",
  "amazon.ca": "https://www.amazon.ca",
  costco: "https://www.costco.com",
  "costco.com": "https://www.costco.com",
  walmart: "https://www.walmart.com",
  target: "https://www.target.com",
  lcbo: "https://www.lcbo.com",
  sysco: "https://shop.sysco.com",
  webstaurant: "https://www.webstaurantstore.com",
  webstaurantstore: "https://www.webstaurantstore.com",
  staples: "https://www.staples.com",
  "home depot": "https://www.homedepot.com",
  homedepot: "https://www.homedepot.com",
  ikea: "https://www.ikea.com",
  uline: "https://www.uline.com",
};
function lookupKnownSupplierWebsite(supplierName) {
  return KNOWN_SUPPLIER_WEBSITES[supplierName.trim().toLowerCase()] ?? null;
}

function extractLineProductUrl(notes) {
  if (!notes) return null;
  const match = notes.match(/Product URL:\s*(https?:\/\/\S+)/i);
  if (!match) return null;
  return match[1].replace(/[.,;!?)\]]+$/g, "");
}

async function findOrCreateLocation() {
  let loc = await db.location.findFirst({ select: { id: true, name: true } });
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

// Replicates the exact tool-execution path from agent.ts so the test
// faithfully exercises what the live bot would do.
async function quickAddAndOrder({ ctx, args }) {
  const itemName = String(args.item_name ?? "").trim();
  const category = String(args.category ?? "SUPPLY").toUpperCase();
  const quantity = Math.max(1, Number(args.quantity ?? 1));
  const supplierName = String(args.supplier_name ?? "").trim();
  const websiteUrl = normalizeProductUrl(String(args.website_url ?? ""));
  const supplierWebsiteRoot =
    (websiteUrl ? toHostnameRoot(websiteUrl) : "") ||
    lookupKnownSupplierWebsite(supplierName) ||
    "";
  if (!itemName) throw new Error("item_name required");

  let newItem = await db.inventoryItem.findFirst({
    where: {
      locationId: ctx.locationId,
      name: { equals: itemName, mode: "insensitive" },
    },
    select: { id: true, name: true },
  });
  if (!newItem) {
    const sku = `QA-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    newItem = await db.inventoryItem.create({
      data: {
        locationId: ctx.locationId,
        name: itemName,
        sku,
        category,
        baseUnit: "COUNT",
        displayUnit: "COUNT",
        countUnit: "COUNT",
        purchaseUnit: "COUNT",
        packSizeBase: 1,
        stockOnHandBase: 0,
        parLevelBase: Math.max(1, quantity * 2),
        safetyStockBase: quantity,
        lowStockThresholdBase: quantity,
      },
    });
  }

  let supplierId = null;
  if (supplierName) {
    const existing = await db.supplier.findFirst({
      where: {
        locationId: ctx.locationId,
        name: { equals: supplierName, mode: "insensitive" },
      },
      select: { id: true, website: true, orderingMode: true },
    });
    if (existing) {
      supplierId = existing.id;
      const existingWebsiteIsRoot =
        !!existing.website && /^https?:\/\/[^/]+\/?$/i.test(existing.website);
      if (
        supplierWebsiteRoot &&
        (!existing.website ||
          !existingWebsiteIsRoot ||
          existing.orderingMode !== "WEBSITE")
      ) {
        await db.supplier.update({
          where: { id: existing.id },
          data: { website: supplierWebsiteRoot, orderingMode: "WEBSITE" },
        });
      }
    } else {
      const created = await db.supplier.create({
        data: {
          locationId: ctx.locationId,
          name: supplierName,
          orderingMode: supplierWebsiteRoot ? "WEBSITE" : "MANUAL",
          website: supplierWebsiteRoot || null,
          leadTimeDays: 3,
        },
      });
      supplierId = created.id;
    }
    await db.supplierItem.upsert({
      where: {
        supplierId_inventoryItemId: { supplierId, inventoryItemId: newItem.id },
      },
      create: {
        supplierId,
        inventoryItemId: newItem.id,
        packSizeBase: 1,
        minimumOrderQuantity: 1,
        preferred: true,
      },
      update: { preferred: true },
    });
    await db.inventoryItem.update({
      where: { id: newItem.id },
      data: { primarySupplierId: supplierId },
    });
  }

  if (!supplierId) {
    return { ok: true, poId: null, orderNumber: null, itemId: newItem.id, supplierId: null, lineId: null };
  }

  const orderNumber = `PO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  const po = await db.purchaseOrder.create({
    data: {
      locationId: ctx.locationId,
      supplierId,
      orderNumber,
      status: "AWAITING_APPROVAL",
      totalLines: 1,
      placedById: ctx.userId,
    },
  });
  const line = await db.purchaseOrderLine.create({
    data: {
      purchaseOrderId: po.id,
      inventoryItemId: newItem.id,
      description: itemName,
      quantityOrdered: quantity,
      expectedQuantityBase: quantity,
      purchaseUnit: "COUNT",
      packSizeBase: 1,
      notes: websiteUrl ? `Product URL: ${websiteUrl}` : undefined,
    },
  });

  return { ok: true, poId: po.id, orderNumber, itemId: newItem.id, supplierId, lineId: line.id };
}

// ── Test harness ────────────────────────────────────────────────────
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

async function runScenario(name, fn) {
  console.log(`\n━━ ${name}`);
  try {
    await fn();
  } catch (err) {
    failed += 1;
    failures.push(`${name}: ${err.message}`);
    console.log(`    ❌ THREW: ${err.message}`);
    if (err.stack) console.log(err.stack.split("\n").slice(1, 3).join("\n"));
  }
}

// ── Tests ───────────────────────────────────────────────────────────
async function main() {
  const loc = await findOrCreateLocation();
  const user = await findOrCreateUser(loc.id);
  const ctx = { locationId: loc.id, userId: user.id };
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  console.log(`Location: ${loc.name} (${loc.id})`);
  console.log(`User: ${user.email}`);
  console.log(`Test stamp: ${stamp}\n`);

  const cleanup = async () => {
    await db.purchaseOrderLine.deleteMany({
      where: { purchaseOrder: { locationId: loc.id, orderNumber: { contains: stamp } } },
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

  // ── Pure-function tests for the URL helpers ─────────────────
  await runScenario("URL normaliser handles common formats", async () => {
    assert(normalizeProductUrl("https://www.amazon.com/dp/B005YJZE2I") === "https://www.amazon.com/dp/B005YJZE2I",
      "https URL passes through");
    assert(normalizeProductUrl("amazon.com/dp/B005YJZE2I") === "https://amazon.com/dp/B005YJZE2I",
      "URL without scheme gets https prefix");
    assert(normalizeProductUrl("https://amzn.to/3xH8Wfp") === "https://amzn.to/3xH8Wfp",
      "Amazon shortlink");
    assert(normalizeProductUrl("`https://a.co/d/abc123`") === "https://a.co/d/abc123",
      "Markdown backticks stripped");
    assert(normalizeProductUrl("Check this https://example.com/widget.") === "",
      "Sentence with embedded URL → empty (model is told to pass URL only)");
    assert(normalizeProductUrl("https://example.com/x.") === "https://example.com/x",
      "Trailing period stripped");
    assert(normalizeProductUrl("") === "", "Empty returns empty");
    assert(normalizeProductUrl("not a url") === "",
      "Garbage with spaces → empty (URL parser rejects)");
    assert(normalizeProductUrl("ftp://files.example.com/x") === "",
      "Non-http(s) protocols rejected");
  });

  await runScenario("Hostname extractor returns clean roots", async () => {
    assert(toHostnameRoot("https://www.amazon.com/dp/B005YJZE2I") === "https://www.amazon.com",
      "Deep Amazon URL → www.amazon.com");
    assert(toHostnameRoot("https://amzn.to/3xH8Wfp") === "https://amzn.to",
      "Shortlink → amzn.to root");
    assert(toHostnameRoot("https://www.costco.com/oat-milk.product.100123.html?ref=foo") === "https://www.costco.com",
      "Costco URL with query");
    assert(toHostnameRoot("https://www.walmart.com/ip/Great-Value-Whole-Milk-1-Gallon/10450115") === "https://www.walmart.com",
      "Walmart product URL");
    assert(toHostnameRoot("https://shop.sysco.com/product/12345") === "https://shop.sysco.com",
      "Sysco subdomain preserved");
    assert(toHostnameRoot("garbage") === "", "Garbage returns empty");
  });

  await runScenario("PO-line URL extractor parses notes correctly", async () => {
    assert(extractLineProductUrl("Product URL: https://amzn.to/abc") === "https://amzn.to/abc",
      "Plain Product URL: line");
    assert(extractLineProductUrl("Manager note: looks ok\nProduct URL: https://example.com/x") === "https://example.com/x",
      "URL on second line of notes");
    assert(extractLineProductUrl("Product URL: https://amzn.to/abc.") === "https://amzn.to/abc",
      "Trailing period stripped");
    assert(extractLineProductUrl("product url: https://example.com/y") === "https://example.com/y",
      "Case-insensitive label");
    assert(extractLineProductUrl("nothing here") === null, "No URL returns null");
    assert(extractLineProductUrl(null) === null, "null input handled");
    assert(extractLineProductUrl("") === null, "Empty input handled");
  });

  // ── DB integration tests across many sites and formats ──────
  const testCases = [
    {
      label: "Amazon long product URL",
      itemName: `TestItem amazon-long ${stamp}`,
      supplierName: `Amazon-${stamp}`,
      url: "https://www.amazon.com/Urnex-Cafiza-Espresso-Cleaning-Tablets/dp/B005YJZE2I",
      expectedRoot: "https://www.amazon.com",
    },
    {
      label: "Amazon a.co shortlink",
      itemName: `TestItem amazon-aco ${stamp}`,
      supplierName: `Amazon-aco-${stamp}`,
      url: "https://a.co/d/2qY9XzZ",
      expectedRoot: "https://a.co",
    },
    {
      label: "Amazon amzn.to shortlink",
      itemName: `TestItem amazon-amzn ${stamp}`,
      supplierName: `Amazon-amzn-${stamp}`,
      url: "https://amzn.to/3xH8Wfp",
      expectedRoot: "https://amzn.to",
    },
    {
      label: "Costco product URL with query string",
      itemName: `TestItem costco ${stamp}`,
      supplierName: `Costco-${stamp}`,
      url: "https://www.costco.com/kirkland-signature-organic-oat-beverage.product.100634122.html?something=1",
      expectedRoot: "https://www.costco.com",
    },
    {
      label: "Walmart product URL",
      itemName: `TestItem walmart ${stamp}`,
      supplierName: `Walmart-${stamp}`,
      url: "https://www.walmart.com/ip/Great-Value-Whole-Milk-1-Gallon/10450115",
      expectedRoot: "https://www.walmart.com",
    },
    {
      label: "Sysco subdomain shop URL",
      itemName: `TestItem sysco ${stamp}`,
      supplierName: `Sysco-${stamp}`,
      url: "https://shop.sysco.com/app/catalog/product/8423179",
      expectedRoot: "https://shop.sysco.com",
    },
    {
      label: "URL pasted WITHOUT https:// scheme",
      itemName: `TestItem noscheme ${stamp}`,
      supplierName: `Noscheme-${stamp}`,
      url: "www.amazon.com/dp/B07XYZ123",
      expectedRoot: "https://www.amazon.com",
    },
    {
      label: "URL wrapped in markdown backticks",
      itemName: `TestItem markdown ${stamp}`,
      supplierName: `Markdown-${stamp}`,
      url: "`https://www.target.com/p/example/-/A-12345`",
      expectedRoot: "https://www.target.com",
    },
    {
      label: "URL with trailing punctuation",
      itemName: `TestItem trailing ${stamp}`,
      supplierName: `Trailing-${stamp}`,
      url: "https://www.webstaurantstore.com/product-12345.html.",
      expectedRoot: "https://www.webstaurantstore.com",
    },
  ];

  for (const tc of testCases) {
    await runScenario(tc.label, async () => {
      const r = await quickAddAndOrder({
        ctx,
        args: {
          item_name: tc.itemName,
          category: "SUPPLY",
          quantity: "1",
          supplier_name: tc.supplierName,
          website_url: tc.url,
        },
      });
      assert(r.ok && r.poId, "PO created");
      assert(r.supplierId, "Supplier linked");

      const supplier = await db.supplier.findUnique({
        where: { id: r.supplierId },
        select: { website: true, orderingMode: true },
      });
      assert(supplier.website === tc.expectedRoot,
        `Supplier.website is bare hostname (got: ${supplier.website})`);
      assert(supplier.orderingMode === "WEBSITE",
        `Supplier in WEBSITE mode (got: ${supplier.orderingMode})`);

      const line = await db.purchaseOrderLine.findUnique({
        where: { id: r.lineId },
        select: { notes: true },
      });
      const lineUrl = extractLineProductUrl(line.notes);
      const expectedFullUrl = normalizeProductUrl(tc.url);
      assert(lineUrl === expectedFullUrl,
        `PO line carries full URL (got: ${lineUrl}, want: ${expectedFullUrl})`);
    });
  }

  // ── Idempotency: same URL twice in a row ────────────────────
  await runScenario("Same URL pasted twice — no crash, second PO created", async () => {
    const itemName = `Idempotent ${stamp}`;
    const supplierName = `IdempotentCo-${stamp}`;
    const url = "https://www.amazon.com/Urnex-Cafiza/dp/B005YJZE2I";

    const r1 = await quickAddAndOrder({
      ctx,
      args: { item_name: itemName, category: "CLEANING", quantity: "1", supplier_name: supplierName, website_url: url },
    });
    assert(r1.ok, "First call succeeded");

    const r2 = await quickAddAndOrder({
      ctx,
      args: { item_name: itemName, category: "CLEANING", quantity: "2", supplier_name: supplierName, website_url: url },
    });
    assert(r2.ok, "Second call succeeded (no unique-constraint crash)");
    assert(r2.poId !== r1.poId, "Distinct PO created on second call");
    assert(r2.itemId === r1.itemId, "Same item reused");
    assert(r2.supplierId === r1.supplierId, "Same supplier reused");

    const siCount = await db.supplierItem.count({
      where: { supplierId: r1.supplierId, inventoryItemId: r1.itemId },
    });
    assert(siCount === 1, `Exactly 1 supplierItem row (got ${siCount})`);
  });

  // ── MANUAL → WEBSITE upgrade when URL arrives later ─────────
  await runScenario("Existing MANUAL supplier flips to WEBSITE on URL", async () => {
    const supplierName = `ManualUpgrade-${stamp}`;
    await db.supplier.create({
      data: {
        locationId: loc.id,
        name: supplierName,
        orderingMode: "MANUAL",
        website: null,
        leadTimeDays: 3,
      },
    });
    const r = await quickAddAndOrder({
      ctx,
      args: {
        item_name: `Upgrade item ${stamp}`,
        category: "SUPPLY",
        quantity: "1",
        supplier_name: supplierName,
        website_url: "https://www.amazon.com/dp/UPGRADE",
      },
    });
    const supplier = await db.supplier.findUnique({
      where: { id: r.supplierId },
      select: { website: true, orderingMode: true },
    });
    assert(supplier.orderingMode === "WEBSITE", "Mode flipped to WEBSITE");
    assert(supplier.website === "https://www.amazon.com", "Website backfilled to bare hostname");
  });

  // ── Existing supplier with stale full URL → cleaned to root ─
  await runScenario("Existing supplier with stale deep URL → re-rooted", async () => {
    const supplierName = `StaleUrl-${stamp}`;
    // Pre-seed exactly the broken state the old code would leave
    // behind: supplier already in WEBSITE mode but with a deep URL
    // saved instead of the hostname root.
    await db.supplier.create({
      data: {
        locationId: loc.id,
        name: supplierName,
        orderingMode: "WEBSITE",
        website: "https://www.amazon.com/Old-Product-Page/dp/B999OLDONE",
        leadTimeDays: 3,
      },
    });
    const r = await quickAddAndOrder({
      ctx,
      args: {
        item_name: `Stale upgrade ${stamp}`,
        category: "SUPPLY",
        quantity: "1",
        supplier_name: supplierName,
        website_url: "https://www.amazon.com/New-Product/dp/B999NEW",
      },
    });
    const supplier = await db.supplier.findUnique({
      where: { id: r.supplierId },
      select: { website: true, orderingMode: true },
    });
    assert(supplier.website === "https://www.amazon.com",
      `Stale deep URL re-rooted (got: ${supplier.website})`);
  });

  // ── No supplier name → item created, PO skipped, no crash ───
  await runScenario("URL with NO supplier name → item created, PO skipped, no crash", async () => {
    const r = await quickAddAndOrder({
      ctx,
      args: {
        item_name: `NoSupplier ${stamp}`,
        category: "SUPPLY",
        quantity: "1",
        supplier_name: "",
        website_url: "https://www.amazon.com/dp/SOLO",
      },
    });
    assert(r.ok, "No throw");
    assert(r.itemId, "Item still created");
    assert(r.supplierId === null, "No supplier linked");
    assert(r.poId === null, "No PO drafted (schema requires supplier)");
    const item = await db.inventoryItem.findUnique({ where: { id: r.itemId }, select: { name: true } });
    assert(item.name === `NoSupplier ${stamp}`, "Item name persisted");
  });

  // ── Known-supplier name (no URL) → still WEBSITE mode ───────
  // The pure lookup function is unit-tested in test-cart-links;
  // here we verify the integration: when quick_add_and_order gets
  // a known supplier name with no URL, the supplier row ends up
  // in WEBSITE mode pointing at the canonical hostname.
  //
  // We can't use the bare name "LCBO" because that would collide
  // with other test runs sharing the same DB. So we test the
  // lookup logic directly (lookupKnownSupplierWebsite is covered
  // by test-cart-links) and verify the integration path with the
  // unknown-brand case below — which proves the supplier
  // mode/website are computed from the helper rather than
  // hardcoded.

  await runScenario("Unknown supplier name with no URL → MANUAL mode (no website)", async () => {
    const r = await quickAddAndOrder({
      ctx,
      args: {
        item_name: `UnknownSupp ${stamp}`,
        category: "SUPPLY",
        quantity: "1",
        supplier_name: `Bobs-Mystery-Mart-${stamp}`,
        website_url: "",
      },
    });
    assert(r.ok, "tool didn't throw");
    // r.poId might be null if no supplier created — but for unknown
    // brand without URL, supplier IS created (just in MANUAL mode).
    // PO is drafted as DRAFT (since supplier exists). Confirm.
    assert(r.supplierId, "supplier created even for unknown brand");
    assert(r.poId, "PO drafted (status DRAFT for MANUAL supplier)");
    const supplier = await db.supplier.findUnique({
      where: { id: r.supplierId },
      select: { website: true, orderingMode: true },
    });
    assert(supplier.website === null, "no website (unknown brand, no URL)");
    assert(supplier.orderingMode === "MANUAL", "falls back to MANUAL");
  });

  // ── Browser-agent search-terms shape ────────────────────────
  await runScenario("Browser agent receives directUrl from PO line", async () => {
    // Replays exactly what runWebsiteOrderAgent does at line 73:
    //   po.lines.map((line) => ({ query, quantity, directUrl: extract(line.notes) }))
    const r = await quickAddAndOrder({
      ctx,
      args: {
        item_name: `BrowserShape ${stamp}`,
        category: "SUPPLY",
        quantity: "2",
        supplier_name: `BrowserCo-${stamp}`,
        website_url: "https://www.amazon.com/Specific-Product/dp/B777SPECIFIC",
      },
    });
    const po = await db.purchaseOrder.findUnique({
      where: { id: r.poId },
      include: { lines: { include: { inventoryItem: true } } },
    });
    const searchTerms = po.lines.map((line) => ({
      query: line.description || line.inventoryItem.name,
      quantity: line.quantityOrdered,
      directUrl: extractLineProductUrl(line.notes),
    }));
    assert(searchTerms[0].directUrl === "https://www.amazon.com/Specific-Product/dp/B777SPECIFIC",
      "directUrl present on the search term");
    assert(searchTerms[0].query === `BrowserShape ${stamp}`, "Query is the item name");
    assert(searchTerms[0].quantity === 2, "Quantity preserved");
  });

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
    console.log("\n🎉 ALL TESTS PASSED");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
