import test from "node:test";
import assert from "node:assert/strict";

import {
  pickAlternateSupplier,
  type RescueCandidate,
  type RescueLineInput,
} from "./rescue-picker";

type Supplier = { id: string; name: string; email: string | null };

function supplier(id: string, name = id): Supplier {
  return { id, name, email: `${id.toLowerCase()}@x.example` };
}

function candidate(
  supplierId: string,
  packSizeBase: number,
  name?: string
): RescueCandidate<Supplier> {
  return {
    supplierId,
    supplier: supplier(supplierId, name ?? supplierId),
    packSizeBase,
  };
}

function line(
  lineId: string,
  candidates: Array<RescueCandidate<Supplier>>
): RescueLineInput<Supplier> {
  return { lineId, candidates };
}

// ─── no-cover / degenerate inputs ────────────────────────────────────

test("returns null for empty lines array", () => {
  const result = pickAlternateSupplier<Supplier>([]);
  assert.equal(result, null);
});

test("returns null when any line has no candidates", () => {
  const result = pickAlternateSupplier([
    line("l1", [candidate("A", 12)]),
    line("l2", []), // no alternates for this line
    line("l3", [candidate("A", 6)]),
  ]);
  assert.equal(result, null);
});

test("returns null when first-line candidate doesn't cover later lines", () => {
  const result = pickAlternateSupplier([
    line("l1", [candidate("A", 12)]),
    line("l2", [candidate("B", 10)]),
  ]);
  assert.equal(result, null);
});

test("returns null when no single supplier covers every line", () => {
  // A covers lines 1+2 but not 3; B covers 2+3 but not 1.
  const result = pickAlternateSupplier([
    line("l1", [candidate("A", 1)]),
    line("l2", [candidate("A", 2), candidate("B", 3)]),
    line("l3", [candidate("B", 4)]),
  ]);
  assert.equal(result, null);
});

// ─── happy paths ─────────────────────────────────────────────────────

test("picks the only covering supplier for a single-line PO", () => {
  const result = pickAlternateSupplier([
    line("l1", [candidate("A", 12)]),
  ]);
  assert.ok(result);
  assert.equal(result!.supplier.id, "A");
  assert.equal(result!.packSizeByLine.get("l1"), 12);
});

test("picks a supplier that covers every line", () => {
  const result = pickAlternateSupplier([
    line("l1", [candidate("A", 12), candidate("B", 10)]),
    line("l2", [candidate("A", 6), candidate("B", 8)]),
    line("l3", [candidate("A", 3)]),
  ]);
  assert.ok(result);
  assert.equal(result!.supplier.id, "A");
});

test("packSizeByLine tracks each line's supplier-specific pack", () => {
  const result = pickAlternateSupplier([
    line("l1", [candidate("A", 12), candidate("B", 10)]),
    line("l2", [candidate("A", 6), candidate("B", 8)]),
    line("l3", [candidate("A", 3), candidate("B", 4)]),
  ]);
  assert.ok(result);
  assert.equal(result!.supplier.id, "A");
  assert.equal(result!.packSizeByLine.get("l1"), 12);
  assert.equal(result!.packSizeByLine.get("l2"), 6);
  assert.equal(result!.packSizeByLine.get("l3"), 3);
});

// ─── preferred-first ordering ────────────────────────────────────────

test("prefers lines[0]'s first candidate when multiple suppliers cover", () => {
  // A and B both cover every line; picker walks lines[0] in order so
  // A (listed first on line 1) wins.
  const result = pickAlternateSupplier([
    line("l1", [candidate("A", 12), candidate("B", 10)]),
    line("l2", [candidate("A", 6), candidate("B", 8)]),
  ]);
  assert.ok(result);
  assert.equal(result!.supplier.id, "A");
});

test("follows lines[0] ordering even when later lines prefer a different supplier", () => {
  // Line 1 lists A preferred, Line 2 lists B preferred. Documented
  // behavior: line-1 preference wins for the rescue PO.
  const result = pickAlternateSupplier([
    line("l1", [candidate("A", 12), candidate("B", 10)]),
    line("l2", [candidate("B", 8), candidate("A", 6)]),
  ]);
  assert.ok(result);
  assert.equal(result!.supplier.id, "A");
});

test("falls through to the second candidate when the first doesn't cover", () => {
  const result = pickAlternateSupplier([
    line("l1", [candidate("A", 12), candidate("B", 10)]),
    line("l2", [candidate("B", 8)]), // A not available on line 2
  ]);
  assert.ok(result);
  assert.equal(result!.supplier.id, "B");
  assert.equal(result!.packSizeByLine.get("l1"), 10);
  assert.equal(result!.packSizeByLine.get("l2"), 8);
});

test("walks every first-line candidate before giving up", () => {
  const result = pickAlternateSupplier([
    line("l1", [
      candidate("A", 1),
      candidate("B", 2),
      candidate("C", 3),
      candidate("D", 4),
    ]),
    line("l2", [candidate("D", 40)]), // only D covers line 2
  ]);
  assert.ok(result);
  assert.equal(result!.supplier.id, "D");
  assert.equal(result!.packSizeByLine.get("l1"), 4);
  assert.equal(result!.packSizeByLine.get("l2"), 40);
});

// ─── packSize variance across suppliers ──────────────────────────────

test("preserves each supplier's own pack size — doesn't bleed between candidates", () => {
  // Same supplier-id might appear with different packSizeBase on
  // different lines (rare but possible if the SupplierItem row has
  // per-location pack sizes). The picker must pull the pack size
  // from the *matching* line's candidate, not line-1's.
  const result = pickAlternateSupplier([
    line("l1", [candidate("A", 100)]),
    line("l2", [candidate("A", 200)]),
    line("l3", [candidate("A", 300)]),
  ]);
  assert.ok(result);
  assert.equal(result!.packSizeByLine.get("l1"), 100);
  assert.equal(result!.packSizeByLine.get("l2"), 200);
  assert.equal(result!.packSizeByLine.get("l3"), 300);
});

test("pack size map has exactly one entry per input line", () => {
  const result = pickAlternateSupplier([
    line("l1", [candidate("A", 1)]),
    line("l2", [candidate("A", 2)]),
    line("l3", [candidate("A", 3)]),
    line("l4", [candidate("A", 4)]),
  ]);
  assert.ok(result);
  assert.equal(result!.packSizeByLine.size, 4);
});

// ─── supplier payload fidelity ───────────────────────────────────────

test("returns the supplier object as handed in by the caller", () => {
  const s = { id: "X", name: "Sysco", email: "rep@sysco.example", extra: 42 };
  const result = pickAlternateSupplier([
    { lineId: "l1", candidates: [{ supplierId: "X", supplier: s, packSizeBase: 1 }] },
  ]);
  assert.ok(result);
  assert.strictEqual(result!.supplier, s); // reference equality
  assert.equal((result!.supplier as typeof s).extra, 42);
});

test("uses supplier from the line that matched, not line-1 (supplier identity)", () => {
  // Line 1's candidate A and Line 2's candidate A reference different
  // supplier objects (same id, different in-memory handle — e.g. two
  // Prisma fetches). We return line-1's object (the iterator we're
  // walking) which matches the current rescue.ts behavior.
  const s1 = { id: "A", name: "Sysco (cached)", email: null } as Supplier;
  const s2 = { id: "A", name: "Sysco (fresh)", email: "live@x" } as Supplier;
  const result = pickAlternateSupplier([
    { lineId: "l1", candidates: [{ supplierId: "A", supplier: s1, packSizeBase: 1 }] },
    { lineId: "l2", candidates: [{ supplierId: "A", supplier: s2, packSizeBase: 2 }] },
  ]);
  assert.ok(result);
  assert.strictEqual(result!.supplier, s1);
});

// ─── larger scenarios ────────────────────────────────────────────────

test("picks correctly on a 10-line PO with three overlapping suppliers", () => {
  const lines: Array<RescueLineInput<Supplier>> = [];
  for (let i = 1; i <= 10; i++) {
    lines.push(
      line(`l${i}`, [
        candidate("A", i * 10),
        candidate("B", i * 20),
        candidate("C", i * 30),
      ])
    );
  }
  const result = pickAlternateSupplier(lines);
  assert.ok(result);
  assert.equal(result!.supplier.id, "A");
  assert.equal(result!.packSizeByLine.size, 10);
  assert.equal(result!.packSizeByLine.get("l7"), 70);
});

test("single outlier line narrows the covering set down to exactly one supplier", () => {
  const lines: Array<RescueLineInput<Supplier>> = [];
  for (let i = 1; i <= 5; i++) {
    lines.push(
      line(`l${i}`, [
        candidate("A", i),
        candidate("B", i),
        candidate("C", i),
      ])
    );
  }
  // Line 6: only B carries it.
  lines.push(line("l6", [candidate("B", 99)]));
  const result = pickAlternateSupplier(lines);
  assert.ok(result);
  assert.equal(result!.supplier.id, "B");
});

test("returns null when the outlier rules out every lines[0] candidate", () => {
  const result = pickAlternateSupplier([
    line("l1", [candidate("A", 1), candidate("B", 2)]),
    line("l2", [candidate("C", 3)]), // neither A nor B available
  ]);
  assert.equal(result, null);
});

// ─── determinism ─────────────────────────────────────────────────────

test("is deterministic — same input yields same supplier across repeated calls", () => {
  const inputs: Array<RescueLineInput<Supplier>> = [
    line("l1", [candidate("A", 1), candidate("B", 2)]),
    line("l2", [candidate("A", 1), candidate("B", 2)]),
  ];
  const first = pickAlternateSupplier(inputs);
  const second = pickAlternateSupplier(inputs);
  assert.equal(first?.supplier.id, second?.supplier.id);
  assert.equal(first?.supplier.id, "A");
});

test("input immutability — caller's candidate array isn't mutated", () => {
  const l1Candidates = [candidate("A", 1), candidate("B", 2)];
  const l2Candidates = [candidate("B", 4), candidate("A", 3)];
  const before1 = [...l1Candidates];
  const before2 = [...l2Candidates];
  pickAlternateSupplier([
    { lineId: "l1", candidates: l1Candidates },
    { lineId: "l2", candidates: l2Candidates },
  ]);
  assert.deepEqual(l1Candidates, before1);
  assert.deepEqual(l2Candidates, before2);
});
