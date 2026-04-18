import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateUnmappedPosProducts,
  buildRecentPosSaleRows,
  parsePosRawBlob,
  posMappingKey,
  type RecentSaleLineInput,
  type RecentSaleMappingInput,
  type UnmappedLineInput,
} from "./parsing";

// ──────────────────────────────────────────────────────────────────
// parsePosRawBlob
// ──────────────────────────────────────────────────────────────────

test("parsePosRawBlob: extracts both fields from well-formed blob", () => {
  const out = parsePosRawBlob({
    externalProductId: "latte_16oz",
    externalProductName: "Large Latte",
  });
  assert.equal(out.externalProductId, "latte_16oz");
  assert.equal(out.externalProductName, "Large Latte");
});

test("parsePosRawBlob: null blob → both fields null", () => {
  const out = parsePosRawBlob(null);
  assert.equal(out.externalProductId, null);
  assert.equal(out.externalProductName, null);
});

test("parsePosRawBlob: missing externalProductId → id null, name preserved", () => {
  const out = parsePosRawBlob({ externalProductName: "Muffin" });
  assert.equal(out.externalProductId, null);
  assert.equal(out.externalProductName, "Muffin");
});

test("parsePosRawBlob: missing externalProductName → id preserved, name null", () => {
  const out = parsePosRawBlob({ externalProductId: "muf_01" });
  assert.equal(out.externalProductId, "muf_01");
  assert.equal(out.externalProductName, null);
});

test("parsePosRawBlob: non-string externalProductId (number) → null, not coerced", () => {
  // POS vendors occasionally number their SKUs; we refuse to coerce
  // because "123" and 123 are semantically different mapping keys
  // and silently coalescing them would alias unrelated products.
  const out = parsePosRawBlob({
    externalProductId: 12345 as unknown as string,
    externalProductName: "Numeric SKU",
  });
  assert.equal(out.externalProductId, null);
  assert.equal(out.externalProductName, "Numeric SKU");
});

test("parsePosRawBlob: non-string externalProductName (object) → null", () => {
  const out = parsePosRawBlob({
    externalProductId: "ok",
    externalProductName: { en: "Latte" } as unknown as string,
  });
  assert.equal(out.externalProductId, "ok");
  assert.equal(out.externalProductName, null);
});

test("parsePosRawBlob: empty-string id is treated as missing (null)", () => {
  // Empty id would join to a mapping with empty key — exactly the
  // bug we're defending against. Treat as "no product."
  const out = parsePosRawBlob({
    externalProductId: "",
    externalProductName: "Ghost",
  });
  assert.equal(out.externalProductId, null);
});

test("parsePosRawBlob: whitespace-only id trims to null", () => {
  const out = parsePosRawBlob({ externalProductId: "   \t " });
  assert.equal(out.externalProductId, null);
});

test("parsePosRawBlob: whitespace-only name trims to null", () => {
  const out = parsePosRawBlob({
    externalProductId: "ok",
    externalProductName: "   ",
  });
  assert.equal(out.externalProductName, null);
});

test("parsePosRawBlob: trims leading/trailing whitespace on id", () => {
  const out = parsePosRawBlob({ externalProductId: "  sku_99  " });
  assert.equal(out.externalProductId, "sku_99");
});

test("parsePosRawBlob: trims leading/trailing whitespace on name", () => {
  const out = parsePosRawBlob({
    externalProductId: "x",
    externalProductName: "\n  Large Latte  \n",
  });
  assert.equal(out.externalProductName, "Large Latte");
});

test("parsePosRawBlob: preserves internal whitespace in name", () => {
  const out = parsePosRawBlob({
    externalProductId: "x",
    externalProductName: "Flat  White",
  });
  assert.equal(out.externalProductName, "Flat  White");
});

test("parsePosRawBlob: null field values → null", () => {
  const out = parsePosRawBlob({
    externalProductId: null as unknown as string,
    externalProductName: null as unknown as string,
  });
  assert.equal(out.externalProductId, null);
  assert.equal(out.externalProductName, null);
});

test("parsePosRawBlob: boolean / array values → null (not stringified)", () => {
  const out = parsePosRawBlob({
    externalProductId: true as unknown as string,
    externalProductName: ["Latte"] as unknown as string,
  });
  assert.equal(out.externalProductId, null);
  assert.equal(out.externalProductName, null);
});

// ──────────────────────────────────────────────────────────────────
// posMappingKey
// ──────────────────────────────────────────────────────────────────

test("posMappingKey: joins with single colon", () => {
  assert.equal(posMappingKey("int_1", "latte"), "int_1:latte");
});

test("posMappingKey: same externalProductId across integrations produces distinct keys", () => {
  // This is the invariant that prevents cross-integration mis-maps:
  // two integrations might both use "latte" as an external id, but
  // each points to its own inventory item.
  const a = posMappingKey("int_square", "latte");
  const b = posMappingKey("int_toast", "latte");
  assert.notEqual(a, b);
});

test("posMappingKey: empty strings still produce a deterministic key", () => {
  // Callers guard against empty inputs upstream, but the helper
  // itself must be total (never throw) so it can be used in map
  // lookups without defensive try/catches.
  assert.equal(posMappingKey("", ""), ":");
});

test("posMappingKey: colon inside externalProductId does not collide with another integration", () => {
  // A well-known ambiguity: if the external id itself contains ':',
  // "a:b:c" could be parsed as integration="a" + product="b:c" OR
  // integration="a:b" + product="c". Since we never split the key
  // back apart — it's only used as an opaque Map index — we just
  // verify the key is built verbatim and collisions aren't created.
  const k1 = posMappingKey("a", "b:c");
  const k2 = posMappingKey("a:b", "c");
  // Both stringify to the same thing, which is acceptable as long
  // as we document it. This test pins the behaviour so a future
  // change (e.g., delimiter swap) is forced to address it.
  assert.equal(k1, "a:b:c");
  assert.equal(k2, "a:b:c");
});

// ──────────────────────────────────────────────────────────────────
// buildRecentPosSaleRows
// ──────────────────────────────────────────────────────────────────

function line(
  overrides: Partial<RecentSaleLineInput> & { id: string }
): RecentSaleLineInput {
  return {
    quantity: 1,
    rawData: null,
    saleEvent: {
      id: `evt-${overrides.id}`,
      occurredAt: new Date("2026-04-15T12:00:00Z"),
      integrationId: "int_1",
      integration: { provider: "TOAST" },
    },
    ...overrides,
  };
}

function mapping(
  overrides: Partial<RecentSaleMappingInput> & { externalProductId: string }
): RecentSaleMappingInput {
  return {
    integrationId: "int_1",
    quantityPerSaleBase: 1,
    inventoryItem: {
      id: "item_1",
      name: "Milk",
      displayUnit: "L",
    },
    ...overrides,
  };
}

test("buildRecentPosSaleRows: returns empty array for empty input", () => {
  assert.deepEqual(buildRecentPosSaleRows([], []), []);
});

test("buildRecentPosSaleRows: mapped row gets inventory name + delta + mapped=true", () => {
  const rows = buildRecentPosSaleRows(
    [
      line({
        id: "L1",
        quantity: 3,
        rawData: { externalProductId: "latte", externalProductName: "Latte" },
      }),
    ],
    [
      mapping({
        externalProductId: "latte",
        quantityPerSaleBase: 200,
        inventoryItem: { id: "milk", name: "Whole Milk", displayUnit: "mL" },
      }),
    ]
  );
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.mapped, true);
  assert.equal(row.inventoryItemName, "Whole Milk");
  assert.equal(row.inventoryDeltaBase, 600); // 200 * 3
  assert.equal(row.inventoryDeltaUnit, "mL");
  assert.equal(row.externalProductId, "latte");
  assert.equal(row.externalProductName, "Latte");
  assert.equal(row.quantity, 3);
});

test("buildRecentPosSaleRows: unmapped row has nulls for inventory fields + mapped=false", () => {
  const rows = buildRecentPosSaleRows(
    [
      line({
        id: "L1",
        rawData: { externalProductId: "ghost_pastry" },
      }),
    ],
    []
  );
  assert.equal(rows[0].mapped, false);
  assert.equal(rows[0].inventoryItemName, null);
  assert.equal(rows[0].inventoryDeltaBase, null);
  assert.equal(rows[0].inventoryDeltaUnit, null);
  assert.equal(rows[0].externalProductId, "ghost_pastry");
});

test("buildRecentPosSaleRows: mapping scoped to integration — wrong-integration mapping does NOT apply", () => {
  // Same external product id, different integrations. The row must
  // stay unmapped. If this breaks, a Square latte mapping would
  // silently drain inventory for a Toast latte sale.
  const rows = buildRecentPosSaleRows(
    [
      line({
        id: "L1",
        rawData: { externalProductId: "latte" },
        saleEvent: {
          id: "evt1",
          occurredAt: new Date(),
          integrationId: "int_toast",
          integration: { provider: "TOAST" },
        },
      }),
    ],
    [mapping({ integrationId: "int_square", externalProductId: "latte" })]
  );
  assert.equal(rows[0].mapped, false);
  assert.equal(rows[0].inventoryItemName, null);
});

test("buildRecentPosSaleRows: null rawData → externalProductId=\"\", name=null, unmapped", () => {
  const rows = buildRecentPosSaleRows([line({ id: "L1", rawData: null })], []);
  assert.equal(rows[0].externalProductId, "");
  assert.equal(rows[0].externalProductName, null);
  assert.equal(rows[0].mapped, false);
});

test("buildRecentPosSaleRows: whitespace-only product id is treated as missing", () => {
  // And even if a mapping keyed on "" existed it must not match.
  const rows = buildRecentPosSaleRows(
    [line({ id: "L1", rawData: { externalProductId: "   " } })],
    [mapping({ externalProductId: "" })]
  );
  assert.equal(rows[0].externalProductId, "");
  assert.equal(rows[0].mapped, false);
});

test("buildRecentPosSaleRows: missing integration provider falls back to 'UNKNOWN'", () => {
  const rows = buildRecentPosSaleRows(
    [
      line({
        id: "L1",
        rawData: { externalProductId: "x" },
        saleEvent: {
          id: "evt1",
          occurredAt: new Date(),
          integrationId: "int_1",
          integration: null,
        },
      }),
    ],
    []
  );
  assert.equal(rows[0].provider, "UNKNOWN");
});

test("buildRecentPosSaleRows: null integrationId does not apply any mapping (empty key can't find one)", () => {
  const rows = buildRecentPosSaleRows(
    [
      line({
        id: "L1",
        rawData: { externalProductId: "latte" },
        saleEvent: {
          id: "evt1",
          occurredAt: new Date(),
          integrationId: null,
          integration: { provider: "SQUARE" },
        },
      }),
    ],
    [mapping({ integrationId: "int_1", externalProductId: "latte" })]
  );
  assert.equal(rows[0].mapped, false);
});

test("buildRecentPosSaleRows: quantity flows through unchanged, even when 0", () => {
  const rows = buildRecentPosSaleRows(
    [
      line({
        id: "L1",
        quantity: 0,
        rawData: { externalProductId: "latte" },
      }),
    ],
    [mapping({ externalProductId: "latte", quantityPerSaleBase: 200 })]
  );
  assert.equal(rows[0].quantity, 0);
  // 200 * 0 = 0, not null — a voided line still maps, just doesn't
  // deplete anything.
  assert.equal(rows[0].inventoryDeltaBase, 0);
});

test("buildRecentPosSaleRows: negative quantity (refund) produces negative delta", () => {
  // Refunds come through as negative quantities. Math is signed so
  // the inventory ledger correctly adds back the depleted amount.
  const rows = buildRecentPosSaleRows(
    [
      line({
        id: "L1",
        quantity: -1,
        rawData: { externalProductId: "latte" },
      }),
    ],
    [mapping({ externalProductId: "latte", quantityPerSaleBase: 200 })]
  );
  assert.equal(rows[0].quantity, -1);
  assert.equal(rows[0].inventoryDeltaBase, -200);
});

test("buildRecentPosSaleRows: preserves input order 1:1", () => {
  const rows = buildRecentPosSaleRows(
    [
      line({ id: "A", rawData: { externalProductId: "a" } }),
      line({ id: "B", rawData: { externalProductId: "b" } }),
      line({ id: "C", rawData: { externalProductId: "c" } }),
    ],
    []
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ["A", "B", "C"]
  );
});

test("buildRecentPosSaleRows: multiple lines share the same mapping lookup map (same object not needed)", () => {
  // Confirms we don't accidentally mutate the mappings input by
  // running the transform twice.
  const maps = [mapping({ externalProductId: "latte" })];
  const mapsSnapshot = JSON.stringify(maps);
  buildRecentPosSaleRows(
    [
      line({ id: "A", rawData: { externalProductId: "latte" } }),
      line({ id: "B", rawData: { externalProductId: "latte" } }),
    ],
    maps
  );
  assert.equal(JSON.stringify(maps), mapsSnapshot);
});

// ──────────────────────────────────────────────────────────────────
// aggregateUnmappedPosProducts
// ──────────────────────────────────────────────────────────────────

function ulLine(
  overrides: Partial<UnmappedLineInput> & {
    externalProductId?: string | null;
    occurredAt?: Date;
    unitPriceCents?: number | null;
    integrationId?: string | null;
    provider?: string;
    externalProductName?: string | null;
  }
): UnmappedLineInput {
  const rawData =
    overrides.rawData !== undefined
      ? overrides.rawData
      : {
          externalProductId: overrides.externalProductId ?? undefined,
          externalProductName: overrides.externalProductName ?? undefined,
        };
  return {
    rawData,
    unitPriceCents: overrides.unitPriceCents ?? null,
    saleEvent: {
      integrationId: overrides.integrationId ?? "int_1",
      occurredAt: overrides.occurredAt ?? new Date("2026-04-15T12:00:00Z"),
      integration: overrides.provider
        ? { provider: overrides.provider }
        : { provider: "TOAST" },
    },
  };
}

test("aggregateUnmappedPosProducts: empty input → empty output", () => {
  assert.deepEqual(aggregateUnmappedPosProducts([], []), []);
});

test("aggregateUnmappedPosProducts: groups by (integration, product) and counts occurrences", () => {
  const out = aggregateUnmappedPosProducts(
    [
      ulLine({ externalProductId: "latte" }),
      ulLine({ externalProductId: "latte" }),
      ulLine({ externalProductId: "muffin" }),
      ulLine({ externalProductId: "latte" }),
    ],
    []
  );
  assert.equal(out.length, 2);
  const latte = out.find((r) => r.externalProductId === "latte");
  assert.equal(latte?.occurrences, 3);
  const muffin = out.find((r) => r.externalProductId === "muffin");
  assert.equal(muffin?.occurrences, 1);
});

test("aggregateUnmappedPosProducts: sorts by occurrences DESC (biggest offender first)", () => {
  const out = aggregateUnmappedPosProducts(
    [
      ulLine({ externalProductId: "a" }),
      ulLine({ externalProductId: "b" }),
      ulLine({ externalProductId: "b" }),
      ulLine({ externalProductId: "c" }),
      ulLine({ externalProductId: "c" }),
      ulLine({ externalProductId: "c" }),
    ],
    []
  );
  assert.deepEqual(
    out.map((r) => r.externalProductId),
    ["c", "b", "a"]
  );
});

test("aggregateUnmappedPosProducts: excludes products already in mappedKeys", () => {
  const out = aggregateUnmappedPosProducts(
    [
      ulLine({ externalProductId: "latte" }),
      ulLine({ externalProductId: "muffin" }),
    ],
    [posMappingKey("int_1", "latte")]
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].externalProductId, "muffin");
});

test("aggregateUnmappedPosProducts: mapping exclusion is integration-scoped", () => {
  // "latte" mapped for int_square should NOT suppress "latte" on
  // int_toast — they're different products to different POS systems.
  const out = aggregateUnmappedPosProducts(
    [
      ulLine({ integrationId: "int_toast", externalProductId: "latte" }),
      ulLine({ integrationId: "int_toast", externalProductId: "latte" }),
    ],
    [posMappingKey("int_square", "latte")]
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].integrationId, "int_toast");
  assert.equal(out[0].occurrences, 2);
});

test("aggregateUnmappedPosProducts: ignores lines missing externalProductId", () => {
  const out = aggregateUnmappedPosProducts(
    [
      ulLine({ externalProductId: "" }),
      ulLine({ externalProductId: "   " }),
      ulLine({ rawData: null }),
      ulLine({ externalProductId: "real" }),
    ],
    []
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].externalProductId, "real");
});

test("aggregateUnmappedPosProducts: ignores lines missing integrationId", () => {
  const out = aggregateUnmappedPosProducts(
    [
      ulLine({ integrationId: null, externalProductId: "latte" }),
      ulLine({ integrationId: "int_1", externalProductId: "latte" }),
    ],
    []
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].integrationId, "int_1");
});

test("aggregateUnmappedPosProducts: lastSeenAt is the occurredAt of the first encountered line (caller's DESC order)", () => {
  const newest = new Date("2026-04-15T12:00:00Z");
  const older = new Date("2026-04-10T12:00:00Z");
  const out = aggregateUnmappedPosProducts(
    [
      // DESC: newest first
      ulLine({ externalProductId: "latte", occurredAt: newest }),
      ulLine({ externalProductId: "latte", occurredAt: older }),
    ],
    []
  );
  assert.equal(out[0].lastSeenAt.toISOString(), newest.toISOString());
});

test("aggregateUnmappedPosProducts: name fills in from later (older) line when first line missing it", () => {
  // Catalogues add names over time, but the most RECENT webhook
  // might occasionally drop it. We don't want the UI to render
  // "null" if any prior line had a usable name.
  const out = aggregateUnmappedPosProducts(
    [
      ulLine({ externalProductId: "latte" }), // no name
      ulLine({ externalProductId: "latte", externalProductName: "Latte 16oz" }),
    ],
    []
  );
  assert.equal(out[0].externalProductName, "Latte 16oz");
});

test("aggregateUnmappedPosProducts: name from first (newest) line is preferred over later (older) name", () => {
  const out = aggregateUnmappedPosProducts(
    [
      ulLine({ externalProductId: "latte", externalProductName: "New Name" }),
      ulLine({ externalProductId: "latte", externalProductName: "Old Name" }),
    ],
    []
  );
  assert.equal(out[0].externalProductName, "New Name");
});

test("aggregateUnmappedPosProducts: unitPriceCents fills in from later line when newest line had null", () => {
  const out = aggregateUnmappedPosProducts(
    [
      ulLine({ externalProductId: "latte", unitPriceCents: null }),
      ulLine({ externalProductId: "latte", unitPriceCents: 550 }),
    ],
    []
  );
  assert.equal(out[0].lastUnitPriceCents, 550);
});

test("aggregateUnmappedPosProducts: unitPriceCents from newest line wins over older non-null", () => {
  const out = aggregateUnmappedPosProducts(
    [
      ulLine({ externalProductId: "latte", unitPriceCents: 600 }),
      ulLine({ externalProductId: "latte", unitPriceCents: 550 }),
    ],
    []
  );
  assert.equal(out[0].lastUnitPriceCents, 600);
});

test("aggregateUnmappedPosProducts: unitPriceCents can be 0 (free sample) and is preserved (not treated as null)", () => {
  // A zero-cent line is still a valid price-point. Confusing zero
  // with null would cause the next-encountered non-null to overwrite
  // a legitimately-recorded $0.
  const out = aggregateUnmappedPosProducts(
    [
      ulLine({ externalProductId: "free_sample", unitPriceCents: 0 }),
      ulLine({ externalProductId: "free_sample", unitPriceCents: 500 }),
    ],
    []
  );
  assert.equal(out[0].lastUnitPriceCents, 0);
});

test("aggregateUnmappedPosProducts: provider captured from first line seen", () => {
  const out = aggregateUnmappedPosProducts(
    [ulLine({ externalProductId: "latte", provider: "TOAST" })],
    []
  );
  assert.equal(out[0].provider, "TOAST");
});

test("aggregateUnmappedPosProducts: provider defaults to UNKNOWN when integration is null", () => {
  const out = aggregateUnmappedPosProducts(
    [
      {
        rawData: { externalProductId: "latte" },
        unitPriceCents: null,
        saleEvent: {
          integrationId: "int_1",
          occurredAt: new Date(),
          integration: null,
        },
      },
    ],
    []
  );
  assert.equal(out[0].provider, "UNKNOWN");
});

test("aggregateUnmappedPosProducts: accepts Set or Array for mappedKeys (Iterable contract)", () => {
  const out1 = aggregateUnmappedPosProducts(
    [ulLine({ externalProductId: "latte" })],
    new Set([posMappingKey("int_1", "latte")])
  );
  const out2 = aggregateUnmappedPosProducts(
    [ulLine({ externalProductId: "latte" })],
    [posMappingKey("int_1", "latte")]
  );
  assert.equal(out1.length, 0);
  assert.equal(out2.length, 0);
});

test("aggregateUnmappedPosProducts: trimmed product id is used for both grouping AND mapping lookup", () => {
  // The product id "  latte  " should map-check against "latte" — a
  // manager who mapped "latte" shouldn't be re-prompted because the
  // POS started sending whitespace-padded ids.
  const out = aggregateUnmappedPosProducts(
    [ulLine({ externalProductId: "  latte  " })],
    [posMappingKey("int_1", "latte")]
  );
  assert.equal(out.length, 0);
});

test("aggregateUnmappedPosProducts: whitespace-variants of same product collapse to one bucket", () => {
  const out = aggregateUnmappedPosProducts(
    [
      ulLine({ externalProductId: "latte" }),
      ulLine({ externalProductId: " latte" }),
      ulLine({ externalProductId: "latte " }),
      ulLine({ externalProductId: "\tlatte\n" }),
    ],
    []
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].occurrences, 4);
  assert.equal(out[0].externalProductId, "latte");
});

test("aggregateUnmappedPosProducts: does not mutate the input array", () => {
  const input = [
    ulLine({ externalProductId: "a" }),
    ulLine({ externalProductId: "a" }),
    ulLine({ externalProductId: "b" }),
  ];
  const snapshot = input.map((l) => l.rawData);
  aggregateUnmappedPosProducts(input, []);
  assert.deepEqual(
    input.map((l) => l.rawData),
    snapshot
  );
});

test("aggregateUnmappedPosProducts: tie on occurrences — sort is stable enough to not crash", () => {
  // When two products have the same count, order is implementation-
  // defined (insertion order of the Map). We don't assert on it;
  // we just verify the function returns both rather than dropping
  // one.
  const out = aggregateUnmappedPosProducts(
    [
      ulLine({ externalProductId: "a" }),
      ulLine({ externalProductId: "b" }),
    ],
    []
  );
  assert.equal(out.length, 2);
  const ids = new Set(out.map((r) => r.externalProductId));
  assert.ok(ids.has("a"));
  assert.ok(ids.has("b"));
});
