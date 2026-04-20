import { describe, test } from "node:test";
import { strict as assert } from "node:assert";

import { MovementType, ServiceMode } from "../../lib/domain-enums";
import {
  USAGE_SIGNAL_MOVEMENT_TYPES,
  clampConfidenceScore,
  componentMatchesModifierKey,
  componentMatchesServiceMode,
  extractModifierKeys,
  extractModifierKeysFromValue,
  normalizeModifierKey,
  sumNegativeUsageBase,
} from "./ledger-primitives";

describe("USAGE_SIGNAL_MOVEMENT_TYPES", () => {
  test("excludes RECEIVING (receiving is inflow, not usage)", () => {
    assert.equal(USAGE_SIGNAL_MOVEMENT_TYPES.includes(MovementType.RECEIVING), false);
  });

  test("includes every outflow type that feeds average-daily-usage math", () => {
    assert.equal(USAGE_SIGNAL_MOVEMENT_TYPES.includes(MovementType.POS_DEPLETION), true);
    assert.equal(USAGE_SIGNAL_MOVEMENT_TYPES.includes(MovementType.WASTE), true);
    assert.equal(USAGE_SIGNAL_MOVEMENT_TYPES.includes(MovementType.BREAKAGE), true);
    assert.equal(
      USAGE_SIGNAL_MOVEMENT_TYPES.includes(MovementType.MANUAL_COUNT_ADJUSTMENT),
      true
    );
    assert.equal(USAGE_SIGNAL_MOVEMENT_TYPES.includes(MovementType.CORRECTION), true);
    assert.equal(USAGE_SIGNAL_MOVEMENT_TYPES.includes(MovementType.TRANSFER), true);
    assert.equal(USAGE_SIGNAL_MOVEMENT_TYPES.includes(MovementType.RETURN), true);
  });

  test("locks the exact shape (regression fence against accidental additions)", () => {
    assert.equal(USAGE_SIGNAL_MOVEMENT_TYPES.length, 7);
  });
});

describe("componentMatchesServiceMode", () => {
  test("null/undefined condition matches any line (component applies everywhere)", () => {
    assert.equal(componentMatchesServiceMode(ServiceMode.TO_GO, null), true);
    assert.equal(componentMatchesServiceMode(ServiceMode.DINE_IN, undefined), true);
    assert.equal(componentMatchesServiceMode(null, null), true);
    assert.equal(componentMatchesServiceMode(undefined, undefined), true);
  });

  test("matches when line mode matches condition mode exactly", () => {
    assert.equal(
      componentMatchesServiceMode(ServiceMode.TO_GO, ServiceMode.TO_GO),
      true
    );
    assert.equal(
      componentMatchesServiceMode(ServiceMode.DINE_IN, ServiceMode.DINE_IN),
      true
    );
  });

  test("rejects when line mode differs from condition mode", () => {
    assert.equal(
      componentMatchesServiceMode(ServiceMode.TO_GO, ServiceMode.DINE_IN),
      false
    );
  });

  test("rejects null/undefined line mode when condition is set (strict gate)", () => {
    assert.equal(componentMatchesServiceMode(null, ServiceMode.TO_GO), false);
    assert.equal(componentMatchesServiceMode(undefined, ServiceMode.DINE_IN), false);
  });
});

describe("normalizeModifierKey", () => {
  test("lowercases", () => {
    assert.equal(normalizeModifierKey("OAT MILK"), "oat milk");
  });

  test("trims leading/trailing whitespace", () => {
    assert.equal(normalizeModifierKey("   oat milk   "), "oat milk");
  });

  test("leaves interior whitespace alone (does NOT collapse)", () => {
    assert.equal(normalizeModifierKey("oat    milk"), "oat    milk");
  });

  test("idempotent", () => {
    const once = normalizeModifierKey("  HAZELNUT  ");
    assert.equal(normalizeModifierKey(once), once);
  });

  test("empty string stays empty", () => {
    assert.equal(normalizeModifierKey(""), "");
  });

  test("whitespace-only becomes empty string", () => {
    assert.equal(normalizeModifierKey("   "), "");
  });
});

describe("componentMatchesModifierKey", () => {
  test("null/undefined/empty component key matches anything (no gate)", () => {
    assert.equal(componentMatchesModifierKey(null, ["anything"]), true);
    assert.equal(componentMatchesModifierKey(undefined, []), true);
    assert.equal(componentMatchesModifierKey("", ["oat milk"]), true);
  });

  test("matches when any line key equals component key (case-insensitive)", () => {
    assert.equal(
      componentMatchesModifierKey("oat-milk", ["OAT-MILK", "extra-shot"]),
      true
    );
  });

  test("matches with whitespace differences", () => {
    assert.equal(
      componentMatchesModifierKey(" oat milk ", ["oat milk"]),
      true
    );
  });

  test("rejects when no line key matches", () => {
    assert.equal(
      componentMatchesModifierKey("oat-milk", ["almond-milk", "soy-milk"]),
      false
    );
  });

  test("rejects against empty list when component demands a specific key", () => {
    assert.equal(componentMatchesModifierKey("oat-milk", []), false);
  });

  test("partial/substring does NOT match (strict equality after normalization)", () => {
    assert.equal(
      componentMatchesModifierKey("milk", ["oat milk"]),
      false
    );
  });

  test("interior-whitespace differences DO cause mismatch (normalization does not collapse)", () => {
    assert.equal(
      componentMatchesModifierKey("oat  milk", ["oat milk"]),
      false
    );
  });
});

describe("extractModifierKeysFromValue", () => {
  test("returns [] for null/undefined/non-array", () => {
    assert.deepEqual(extractModifierKeysFromValue(null), []);
    assert.deepEqual(extractModifierKeysFromValue(undefined), []);
    assert.deepEqual(extractModifierKeysFromValue("not an array"), []);
    assert.deepEqual(extractModifierKeysFromValue(42), []);
    assert.deepEqual(extractModifierKeysFromValue({ foo: "bar" }), []);
    assert.deepEqual(extractModifierKeysFromValue(true), []);
  });

  test("returns [] for empty array", () => {
    assert.deepEqual(extractModifierKeysFromValue([]), []);
  });

  test("plain string entries pass through, trimmed", () => {
    assert.deepEqual(
      extractModifierKeysFromValue(["  oat-milk  ", "extra-shot"]),
      ["oat-milk", "extra-shot"]
    );
  });

  test("object entries contribute catalog_object_id AND name (both, in order)", () => {
    assert.deepEqual(
      extractModifierKeysFromValue([
        { catalog_object_id: "OATMILK_ID", name: "Oat Milk" },
      ]),
      ["OATMILK_ID", "Oat Milk"]
    );
  });

  test("object entries skip non-string / blank / whitespace-only id+name fields", () => {
    assert.deepEqual(
      extractModifierKeysFromValue([
        { catalog_object_id: "OATMILK_ID", name: "   " },
        { catalog_object_id: 12345, name: "Soy Milk" },
        { catalog_object_id: null, name: null },
      ]),
      ["OATMILK_ID", "Soy Milk"]
    );
  });

  test("mixes string and object entries cleanly", () => {
    assert.deepEqual(
      extractModifierKeysFromValue([
        "raw-string",
        { catalog_object_id: "ID1", name: "Cheddar" },
        42,
        null,
        [],
      ]),
      ["raw-string", "ID1", "Cheddar"]
    );
  });

  test("preserves case (normalization happens later in componentMatchesModifierKey)", () => {
    assert.deepEqual(
      extractModifierKeysFromValue(["OAT MILK", "extra shot"]),
      ["OAT MILK", "extra shot"]
    );
  });
});

describe("extractModifierKeys", () => {
  test("prefers the modifierKeys field when non-empty", () => {
    assert.deepEqual(
      extractModifierKeys(["primary"], { modifiers: ["fallback"] }),
      ["primary"]
    );
  });

  test("falls back to rawData.modifiers when modifierKeys is null/undefined", () => {
    assert.deepEqual(
      extractModifierKeys(null, { modifiers: ["from-raw"] }),
      ["from-raw"]
    );
    assert.deepEqual(
      extractModifierKeys(undefined, { modifiers: ["from-raw"] }),
      ["from-raw"]
    );
  });

  test("falls back to rawData when modifierKeys field exists but yields empty list", () => {
    assert.deepEqual(
      extractModifierKeys([], { modifiers: ["recovered"] }),
      ["recovered"]
    );
  });

  test("returns [] when rawData is null/non-object/array", () => {
    assert.deepEqual(extractModifierKeys(null, null), []);
    assert.deepEqual(extractModifierKeys(null, "not object"), []);
    assert.deepEqual(extractModifierKeys(null, ["not", "object"]), []);
    assert.deepEqual(extractModifierKeys(null, 42), []);
  });

  test("returns [] when rawData has no modifiers field", () => {
    assert.deepEqual(extractModifierKeys(null, { other: "field" }), []);
  });

  test("handles Square-like shape: object entries in rawData.modifiers", () => {
    assert.deepEqual(
      extractModifierKeys(null, {
        modifiers: [
          { catalog_object_id: "OAT_ID", name: "Oat Milk" },
          { catalog_object_id: "SHOT_ID", name: "Extra Shot" },
        ],
      }),
      ["OAT_ID", "Oat Milk", "SHOT_ID", "Extra Shot"]
    );
  });
});

describe("sumNegativeUsageBase", () => {
  test("empty input returns 0", () => {
    assert.equal(sumNegativeUsageBase([]), 0);
  });

  test("sums absolute value of negative deltas for usage types", () => {
    assert.equal(
      sumNegativeUsageBase([
        { movementType: MovementType.POS_DEPLETION, quantityDeltaBase: -50 },
        { movementType: MovementType.WASTE, quantityDeltaBase: -20 },
      ]),
      70
    );
  });

  test("ignores positive deltas even on usage-signal types (positive POS_DEPLETION is data oddity)", () => {
    assert.equal(
      sumNegativeUsageBase([
        { movementType: MovementType.POS_DEPLETION, quantityDeltaBase: 50 },
        { movementType: MovementType.POS_DEPLETION, quantityDeltaBase: -20 },
      ]),
      20
    );
  });

  test("excludes RECEIVING movements (inflows must not register as usage)", () => {
    assert.equal(
      sumNegativeUsageBase([
        { movementType: MovementType.RECEIVING, quantityDeltaBase: -100 },
        { movementType: MovementType.WASTE, quantityDeltaBase: -5 },
      ]),
      5
    );
  });

  test("CORRECTION depletions roll in (correcting an overcount = found less than recorded)", () => {
    assert.equal(
      sumNegativeUsageBase([
        { movementType: MovementType.CORRECTION, quantityDeltaBase: -12 },
      ]),
      12
    );
  });

  test("TRANSFER out reduces on-hand so counts as usage signal", () => {
    assert.equal(
      sumNegativeUsageBase([
        { movementType: MovementType.TRANSFER, quantityDeltaBase: -30 },
      ]),
      30
    );
  });

  test("zero deltas contribute zero", () => {
    assert.equal(
      sumNegativeUsageBase([
        { movementType: MovementType.WASTE, quantityDeltaBase: 0 },
      ]),
      0
    );
  });

  test("mixed signs / types produces stable absolute sum", () => {
    assert.equal(
      sumNegativeUsageBase([
        { movementType: MovementType.RECEIVING, quantityDeltaBase: 500 },
        { movementType: MovementType.POS_DEPLETION, quantityDeltaBase: -200 },
        { movementType: MovementType.WASTE, quantityDeltaBase: -10 },
        { movementType: MovementType.BREAKAGE, quantityDeltaBase: -3 },
        { movementType: MovementType.MANUAL_COUNT_ADJUSTMENT, quantityDeltaBase: -7 },
        { movementType: MovementType.CORRECTION, quantityDeltaBase: 4 },
      ]),
      220
    );
  });
});

describe("clampConfidenceScore", () => {
  test("in-range score passes through", () => {
    assert.equal(clampConfidenceScore(0.5), 0.5);
    assert.equal(clampConfidenceScore(0.75), 0.75);
  });

  test("clamps below floor (0.2)", () => {
    assert.equal(clampConfidenceScore(0), 0.2);
    assert.equal(clampConfidenceScore(-5), 0.2);
    assert.equal(clampConfidenceScore(0.19), 0.2);
  });

  test("clamps above ceiling (0.99)", () => {
    assert.equal(clampConfidenceScore(1), 0.99);
    assert.equal(clampConfidenceScore(2.5), 0.99);
    assert.equal(clampConfidenceScore(0.991), 0.99);
  });

  test("floor and ceiling are exact", () => {
    assert.equal(clampConfidenceScore(0.2), 0.2);
    assert.equal(clampConfidenceScore(0.99), 0.99);
  });
});
