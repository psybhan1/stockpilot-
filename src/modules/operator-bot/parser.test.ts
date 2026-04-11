import test from "node:test";
import assert from "node:assert/strict";

import { parseManagerRestockMessage } from "./parser";

const inventoryChoices = [
  { id: "milk", name: "Whole Milk", sku: "INV-MILK-DAIRY" },
  { id: "oat", name: "Oat Milk", sku: "INV-OAT-01" },
  { id: "beans", name: "Espresso Beans", sku: "INV-BEANS-ESP" },
];

test("operator bot parser: matches clear restock command", () => {
  const result = parseManagerRestockMessage(
    "We only have 2 whole milk left, order more now.",
    inventoryChoices
  );

  assert.deepEqual(result, {
    kind: "matched",
    inventoryItemId: "milk",
    inventoryItemName: "Whole Milk",
    reportedOnHandBase: 2,
  });
});

test("operator bot parser: detects ambiguity when message only says milk", () => {
  const result = parseManagerRestockMessage("Milk is running out, 2 left, reorder it.", inventoryChoices);

  assert.equal(result.kind, "ambiguous");
  assert.equal(result.reportedOnHandBase, 2);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.name),
    ["Whole Milk", "Oat Milk"]
  );
});

test("operator bot parser: requests count when none is provided", () => {
  const result = parseManagerRestockMessage("Restock whole milk please.", inventoryChoices);
  assert.deepEqual(result, { kind: "missing_count" });
});

test("operator bot parser: rejects unsupported messages", () => {
  const result = parseManagerRestockMessage("How are sales looking this weekend?", inventoryChoices);
  assert.deepEqual(result, { kind: "unsupported" });
});
