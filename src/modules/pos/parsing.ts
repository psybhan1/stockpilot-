/**
 * Pure helpers for parsing generic-webhook POS sale lines and
 * reconciling them with PosSimpleMapping rows.
 *
 * Lives separately from recent-activity.ts / unmapped.ts so these
 * transformations — which carry subtle edge cases (null rawData,
 * whitespace-only product names, missing integrationId, repeated
 * keys across integrations) — can be unit-tested without a DB.
 *
 * The two callers (recent sales feed, unmapped-products dashboard)
 * share the same shape of raw input, so centralising it here keeps
 * them in sync: if we ever loosen what counts as a valid product id
 * we only do it in one place.
 */
/**
 * PosSaleLine.rawData is stored as Prisma JsonValue, which can be
 * string | number | boolean | null | array | object. We only care
 * about the object case; everything else falls through to "null
 * fields" in the parsed result.
 */
export type PosRawBlob = unknown;

export type ParsedPosRawBlob = {
  externalProductId: string | null;
  externalProductName: string | null;
};

function isBlobObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

/**
 * Extract the two fields we care about from a PosSaleLine.rawData
 * JSON blob. Returns null for each field when the blob doesn't
 * contain a usable value — non-string, empty-after-trim, or
 * entirely missing.
 *
 * Trimming matters: POS vendors occasionally send product names
 * padded with whitespace, which would otherwise render as a blank
 * row in the UI.
 */
export function parsePosRawBlob(raw: PosRawBlob): ParsedPosRawBlob {
  if (!isBlobObject(raw)) {
    return { externalProductId: null, externalProductName: null };
  }
  const idRaw = raw.externalProductId;
  const nameRaw = raw.externalProductName;
  const externalProductId =
    typeof idRaw === "string" && idRaw.trim() ? idRaw.trim() : null;
  const externalProductName =
    typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : null;
  return { externalProductId, externalProductName };
}

/**
 * Composite key used to join a PosSaleLine to a PosSimpleMapping.
 * Why integration-scoped: a single location can have two POS
 * integrations (e.g. a cafe running Square for in-store and Toast
 * for delivery). The SAME `externalProductId` string can then mean
 * different products across the two, so the mapping row must be
 * looked up per-integration. Joining on `externalProductId` alone
 * would cross-map the latte inventory to a pizza sale.
 */
export function posMappingKey(
  integrationId: string,
  externalProductId: string
): string {
  return `${integrationId}:${externalProductId}`;
}

// ── Recent-activity row builder ─────────────────────────────────────

export type RecentSaleLineInput = {
  id: string;
  quantity: number;
  rawData: PosRawBlob;
  saleEvent: {
    id: string;
    occurredAt: Date;
    integrationId: string | null;
    integration: { provider: string } | null;
  };
};

export type RecentSaleMappingInput = {
  integrationId: string;
  externalProductId: string;
  quantityPerSaleBase: number;
  inventoryItem: {
    id: string;
    name: string;
    displayUnit: string;
  };
};

export type RecentPosSaleRow = {
  id: string;
  saleEventId: string;
  provider: string;
  occurredAt: Date;
  externalProductId: string;
  externalProductName: string | null;
  quantity: number;
  inventoryItemName: string | null;
  inventoryDeltaBase: number | null;
  inventoryDeltaUnit: string | null;
  mapped: boolean;
};

/**
 * Turn a list of PosSaleLine rows + PosSimpleMapping rows into the
 * UI-ready shape for the dashboard "recent POS sales" card.
 *
 * The mapping lookup is integration-scoped (see posMappingKey).
 * Lines with no parseable externalProductId render with "" so the
 * UI can still show "Unknown · qty 2" rather than skipping the row
 * entirely — a POS webhook that keeps sending garbage is a signal
 * worth surfacing, not silencing.
 */
export function buildRecentPosSaleRows(
  lines: RecentSaleLineInput[],
  mappings: RecentSaleMappingInput[]
): RecentPosSaleRow[] {
  const mapByKey = new Map<string, RecentSaleMappingInput>();
  for (const m of mappings) {
    mapByKey.set(posMappingKey(m.integrationId, m.externalProductId), m);
  }

  return lines.map((line) => {
    const { externalProductId: parsedId, externalProductName } = parsePosRawBlob(
      line.rawData
    );
    const externalProductId = parsedId ?? "";
    const integrationId = line.saleEvent.integrationId ?? "";
    const mapping =
      integrationId && parsedId
        ? mapByKey.get(posMappingKey(integrationId, parsedId))
        : undefined;

    return {
      id: line.id,
      saleEventId: line.saleEvent.id,
      provider: line.saleEvent.integration?.provider ?? "UNKNOWN",
      occurredAt: line.saleEvent.occurredAt,
      externalProductId,
      externalProductName,
      quantity: line.quantity,
      inventoryItemName: mapping?.inventoryItem.name ?? null,
      inventoryDeltaBase: mapping
        ? mapping.quantityPerSaleBase * line.quantity
        : null,
      inventoryDeltaUnit: mapping?.inventoryItem.displayUnit ?? null,
      mapped: Boolean(mapping),
    };
  });
}

// ── Unmapped-products aggregator ────────────────────────────────────

export type UnmappedLineInput = {
  rawData: PosRawBlob;
  unitPriceCents: number | null;
  saleEvent: {
    integrationId: string | null;
    occurredAt: Date;
    integration: { provider: string } | null;
  };
};

export type UnmappedPosProduct = {
  integrationId: string;
  provider: string;
  externalProductId: string;
  externalProductName: string | null;
  lastUnitPriceCents: number | null;
  occurrences: number;
  lastSeenAt: Date;
};

/**
 * Group webhook-only sale lines by (integrationId, externalProductId),
 * dropping anything that already has a mapping, and rank by
 * occurrences so the owner sees the biggest offenders first.
 *
 * Invariants enforced here:
 *   - `recentLines` MUST be ordered newest-first by caller. The
 *     first time we see a (integration, product) pair, we record
 *     its `occurredAt` as `lastSeenAt`; later duplicates don't
 *     overwrite it. Iterating in any other order quietly gives
 *     a wrong "last seen" timestamp.
 *   - A non-null `externalProductName` sticks. Later (older) lines
 *     that happen to have the name fill it in if the newest-first
 *     line was missing one — because catalogues tend to add names
 *     over time, the most recent blob is usually the best source,
 *     but we don't want "null" just because the very last webhook
 *     dropped the name field.
 *   - Same rule for `lastUnitPriceCents`: keep the first non-null
 *     we encounter (which is the most recent, thanks to DESC
 *     ordering).
 *   - Mapped pairs are excluded upfront — a product already wired
 *     to inventory isn't "unmapped" no matter how often it fires.
 *   - Lines missing integrationId OR externalProductId are
 *     ignored; we can't group what we can't key.
 */
export function aggregateUnmappedPosProducts(
  recentLines: UnmappedLineInput[],
  mappedKeys: Iterable<string>
): UnmappedPosProduct[] {
  const mappedSet = new Set(mappedKeys);
  const agg = new Map<string, UnmappedPosProduct>();

  for (const line of recentLines) {
    const { externalProductId, externalProductName } = parsePosRawBlob(
      line.rawData
    );
    const integrationId = line.saleEvent.integrationId;
    const provider = line.saleEvent.integration?.provider ?? "UNKNOWN";
    if (!externalProductId || !integrationId) continue;

    const key = posMappingKey(integrationId, externalProductId);
    if (mappedSet.has(key)) continue;

    const existing = agg.get(key);
    if (existing) {
      existing.occurrences += 1;
      if (!existing.externalProductName && externalProductName) {
        existing.externalProductName = externalProductName;
      }
      if (existing.lastUnitPriceCents == null && line.unitPriceCents != null) {
        existing.lastUnitPriceCents = line.unitPriceCents;
      }
    } else {
      agg.set(key, {
        integrationId,
        provider,
        externalProductId,
        externalProductName,
        lastUnitPriceCents: line.unitPriceCents ?? null,
        occurrences: 1,
        lastSeenAt: line.saleEvent.occurredAt,
      });
    }
  }

  return [...agg.values()].sort((a, b) => b.occurrences - a.occurrences);
}
