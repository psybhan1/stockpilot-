import test from "node:test";
import assert from "node:assert/strict";

import { calculateRestockToParOrder } from "./order";

test("operator bot order: fills par exactly when supplier pack size is one", () => {
  assert.deepEqual(
    calculateRestockToParOrder({
      parLevelBase: 22,
      reportedOnHandBase: 2,
      packSizeBase: 1,
      minimumOrderQuantity: 1,
    }),
    {
      shortageBase: 20,
      recommendedPackCount: 20,
      orderQuantityBase: 20,
    }
  );
});

test("operator bot order: rounds up to supplier pack size", () => {
  assert.deepEqual(
    calculateRestockToParOrder({
      parLevelBase: 22000,
      reportedOnHandBase: 2000,
      packSizeBase: 12000,
      minimumOrderQuantity: 1,
    }),
    {
      shortageBase: 20000,
      recommendedPackCount: 2,
      orderQuantityBase: 24000,
    }
  );
});
