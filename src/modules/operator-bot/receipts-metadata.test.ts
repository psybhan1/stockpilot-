import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeReceiptMetadata,
  toReceiptMetadata,
} from "./receipts-metadata";

describe("mergeReceiptMetadata — base wins on collisions", () => {
  it("base wins when keys collide", () => {
    const out = mergeReceiptMetadata(
      { error: "real-error" },
      { error: "caller-error", other: 1 }
    );
    assert.equal(out.error, "real-error");
    assert.equal(out.other, 1);
  });

  it("merges non-colliding keys from both sides", () => {
    const out = mergeReceiptMetadata(
      { error: "boom" },
      { origin: "bot-handler", retries: 3 }
    );
    assert.deepEqual(out, {
      origin: "bot-handler",
      retries: 3,
      error: "boom",
    });
  });

  it("preserves ALL base keys even if extra is rich", () => {
    const base = { error: "e", correlation: "c123", channel: "TELEGRAM" };
    const out = mergeReceiptMetadata(base, { correlation: "overridden" });
    assert.equal(out.correlation, "c123");
    assert.equal(out.error, "e");
    assert.equal(out.channel, "TELEGRAM");
  });
});

describe("mergeReceiptMetadata — dropping bad extras", () => {
  it("returns base when extra is undefined", () => {
    const base = { error: "e" };
    const out = mergeReceiptMetadata(base, undefined);
    assert.deepEqual(out, { error: "e" });
  });

  it("returns base when extra is null", () => {
    // !null is true, so we early-return.
    const out = mergeReceiptMetadata({ error: "e" }, null);
    assert.deepEqual(out, { error: "e" });
  });

  it("returns base when extra is a primitive (string)", () => {
    const out = mergeReceiptMetadata({ error: "e" }, "just a string");
    assert.deepEqual(out, { error: "e" });
  });

  it("returns base when extra is a primitive (number)", () => {
    const out = mergeReceiptMetadata({ error: "e" }, 42);
    assert.deepEqual(out, { error: "e" });
  });

  it("returns base when extra is a primitive (boolean)", () => {
    const out = mergeReceiptMetadata({ error: "e" }, true);
    assert.deepEqual(out, { error: "e" });
  });

  it("returns base when extra is an array (we only accept plain objects)", () => {
    // Arrays technically have typeof === "object" — but a metadata
    // field with array-on-top-level would splat into numeric keys
    // 0, 1, 2 on the base object, polluting it. Locking the array
    // rejection so a caller accidentally passing a list of tags
    // fails safely.
    const out = mergeReceiptMetadata(
      { error: "e" },
      [{ k: "v" }, "other-entry"]
    );
    assert.deepEqual(out, { error: "e" });
  });
});

describe("mergeReceiptMetadata — accepts plain objects", () => {
  it("accepts an empty object (no keys to merge, base returns as-is)", () => {
    const out = mergeReceiptMetadata({ error: "e" }, {});
    assert.deepEqual(out, { error: "e" });
  });

  it("accepts nested-object values (shallow merge only)", () => {
    const out = mergeReceiptMetadata(
      { error: "e" },
      { details: { inner: "value" } }
    );
    assert.deepEqual(out.details, { inner: "value" });
    assert.equal(out.error, "e");
  });

  it("does NOT deep-merge nested objects (later spread REPLACES, not merges)", () => {
    // If both sides have a `details` object, the one in `base`
    // wins completely — not a recursive merge. Lock this so
    // nobody sprinkles a lodash.merge and changes behavior.
    const out = mergeReceiptMetadata(
      { details: { src: "base" } },
      { details: { src: "extra", extraKey: "x" } }
    );
    assert.deepEqual(out.details, { src: "base" });
  });
});

describe("mergeReceiptMetadata — purity", () => {
  it("does not mutate base", () => {
    const base = { error: "e" };
    const snapshot = JSON.stringify(base);
    mergeReceiptMetadata(base, { other: 1 });
    assert.equal(JSON.stringify(base), snapshot);
  });

  it("does not mutate extra", () => {
    const extra = { origin: "bot-handler", retries: 3 };
    const snapshot = JSON.stringify(extra);
    mergeReceiptMetadata({ error: "e" }, extra);
    assert.equal(JSON.stringify(extra), snapshot);
  });

  it("returns a fresh object (not an aliased reference to base)", () => {
    const base = { error: "e" };
    const out = mergeReceiptMetadata(base, { k: 1 });
    assert.notEqual(out, base);
  });

  it("returns base unchanged (same reference) when extra is dropped", () => {
    // Fast-path: `return base` directly when extra is unusable.
    // We do not defensively copy. Lock this so a refactor doesn't
    // silently add per-call allocation for a hot path.
    const base = { error: "e" };
    const out = mergeReceiptMetadata(base, undefined);
    assert.equal(out, base); // same reference
  });

  it("is deterministic", () => {
    const inputs = { error: "e" };
    const extra = { other: 1 };
    for (let i = 0; i < 5; i += 1) {
      assert.deepEqual(mergeReceiptMetadata(inputs, extra), {
        other: 1,
        error: "e",
      });
    }
  });
});

describe("toReceiptMetadata — deep clones to JSON-safe", () => {
  it("deep-clones a plain object", () => {
    const input = { a: 1, b: { c: 2 } };
    const out = toReceiptMetadata(input) as { a: number; b: { c: number } };
    assert.deepEqual(out, input);
    assert.notEqual(out, input); // fresh reference
    assert.notEqual(out.b, input.b); // nested fresh reference
  });

  it("preserves arrays", () => {
    const out = toReceiptMetadata([1, 2, 3]);
    assert.deepEqual(out, [1, 2, 3]);
  });

  it("preserves nested arrays + objects", () => {
    const input = { items: [{ k: 1 }, { k: 2 }] };
    const out = toReceiptMetadata(input);
    assert.deepEqual(out, { items: [{ k: 1 }, { k: 2 }] });
  });

  it("strips undefined-valued keys from objects (JSON cannot represent undefined)", () => {
    const input = { a: 1, b: undefined, c: 3 };
    const out = toReceiptMetadata(input) as Record<string, unknown>;
    assert.equal(Object.hasOwn(out, "a"), true);
    assert.equal(Object.hasOwn(out, "b"), false);
    assert.equal(Object.hasOwn(out, "c"), true);
  });

  it("replaces undefined in an array with null (JSON array serialization quirk)", () => {
    // Locking the JSON.stringify quirk: undefined in an array
    // becomes null, not missing. Callers reading this metadata
    // back should be aware — preserving the quirk explicitly is
    // better than silently converting.
    const input = [1, undefined, 3];
    const out = toReceiptMetadata(input);
    assert.deepEqual(out, [1, null, 3]);
  });

  it("strips functions (JSON-unsafe)", () => {
    const input = { name: "x", fn: () => 42 };
    const out = toReceiptMetadata(input) as Record<string, unknown>;
    assert.equal(out.name, "x");
    assert.equal(Object.hasOwn(out, "fn"), false);
  });

  it("converts Date to ISO string (JSON.stringify default)", () => {
    const d = new Date("2026-01-15T12:00:00Z");
    const out = toReceiptMetadata({ at: d }) as { at: string };
    assert.equal(out.at, "2026-01-15T12:00:00.000Z");
    // After round-trip it's a string, not a Date — documenting
    // the lossy conversion. Callers who need Date back must
    // parse() it explicitly.
    assert.equal(typeof out.at, "string");
  });

  it("preserves null", () => {
    const out = toReceiptMetadata({ k: null });
    assert.deepEqual(out, { k: null });
  });

  it("preserves numbers including 0 and negatives", () => {
    const out = toReceiptMetadata({ a: 0, b: -1, c: 3.14 });
    assert.deepEqual(out, { a: 0, b: -1, c: 3.14 });
  });

  it("preserves booleans", () => {
    assert.deepEqual(toReceiptMetadata({ a: true, b: false }), {
      a: true,
      b: false,
    });
  });

  it("throws on circular references (JSON.stringify throws)", () => {
    type Circular = { self?: Circular };
    const input: Circular = {};
    input.self = input;
    assert.throws(() => toReceiptMetadata(input), /circular|convert/i);
  });

  it("preserves an empty object", () => {
    assert.deepEqual(toReceiptMetadata({}), {});
  });

  it("preserves an empty array", () => {
    assert.deepEqual(toReceiptMetadata([]), []);
  });
});

describe("toReceiptMetadata — purity", () => {
  it("does not mutate the input", () => {
    const input = { a: 1, nested: { b: 2 } };
    const snapshot = JSON.stringify(input);
    toReceiptMetadata(input);
    assert.equal(JSON.stringify(input), snapshot);
  });

  it("is deterministic", () => {
    const input = { a: 1, b: [2, 3], c: { d: 4 } };
    const a = JSON.stringify(toReceiptMetadata(input));
    const b = JSON.stringify(toReceiptMetadata(input));
    assert.equal(a, b);
  });
});
