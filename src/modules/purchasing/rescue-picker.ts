/**
 * Pure "pick an alternate supplier that covers every line" algorithm
 * used by the rescue orchestration in `./rescue`. Nothing here touches
 * the DB — callers materialise the per-line candidate set (from
 * SupplierItem rows) and hand it to `pickAlternateSupplier`.
 *
 * The algorithm:
 *   1. Each line contributes a list of candidate suppliers that
 *      carry the item (already stripped of the original supplier by
 *      the caller).
 *   2. We walk the FIRST line's candidates in order (the caller
 *      hands them to us pre-sorted so preferred ones come first).
 *   3. The first candidate that also appears in every other line's
 *      candidate list wins — the "one supplier covers every line"
 *      invariant that keeps the rescue PO single-supplier.
 *
 * Returning null signals "no single alternate covers the whole
 * order — let a human pick." The rescue orchestration surfaces this
 * to the operator via Telegram instead of silently splitting the PO
 * across suppliers.
 */

export type RescueCandidate<TSupplier> = {
  supplierId: string;
  supplier: TSupplier;
  /**
   * Pack size to stamp on the rescue PO line. Suppliers often carry
   * different case sizes for the same underlying item (a 4L jug vs a
   * 12×1L case) so each candidate brings its own pack size along.
   */
  packSizeBase: number;
};

export type RescueLineInput<TSupplier> = {
  lineId: string;
  /**
   * Candidate suppliers for THIS line, already filtered to exclude
   * the original PO supplier. The first element is treated as the
   * highest-priority candidate (caller sorts by preferred-first).
   */
  candidates: Array<RescueCandidate<TSupplier>>;
};

export type RescuePick<TSupplier> = {
  supplier: TSupplier;
  /**
   * Pack size, keyed by the caller-supplied lineId, of the CHOSEN
   * supplier's supplierItem for each line. Callers write this onto
   * the rescue PurchaseOrderLine so delivery-time variance math
   * matches the new supplier's packaging, not the original's.
   */
  packSizeByLine: Map<string, number>;
};

/**
 * Pick an alternate supplier that carries every line on a PO.
 *
 * Returns `null` if either:
 *   - `lines` is empty, OR
 *   - any line has no candidates, OR
 *   - no candidate from lines[0] covers every other line.
 *
 * Ties are broken by iteration order of `lines[0].candidates` — the
 * caller is expected to sort preferred suppliers first.
 */
export function pickAlternateSupplier<TSupplier>(
  lines: ReadonlyArray<RescueLineInput<TSupplier>>
): RescuePick<TSupplier> | null {
  if (lines.length === 0) return null;

  // If any line has zero candidates, the order can never be covered
  // by a single supplier. Bail early so callers can fall back to a
  // human hand-off without spelunking through empty maps.
  for (const line of lines) {
    if (line.candidates.length === 0) return null;
  }

  const firstLine = lines[0];
  for (const candidate of firstLine.candidates) {
    const packSizeByLine = new Map<string, number>();
    let covers = true;
    for (const line of lines) {
      const match = line.candidates.find(
        (c) => c.supplierId === candidate.supplierId
      );
      if (!match) {
        covers = false;
        break;
      }
      packSizeByLine.set(line.lineId, match.packSizeBase);
    }
    if (covers) {
      return { supplier: candidate.supplier, packSizeByLine };
    }
  }

  return null;
}
