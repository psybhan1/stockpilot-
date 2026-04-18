import test from "node:test";
import assert from "node:assert/strict";

import {
  parseDeliveryDays,
  toDeliveryDaysJson,
  formatDeliveryDays,
} from "./delivery-days";

test("parseDeliveryDays accepts numeric weekday array", () => {
  assert.deepEqual(parseDeliveryDays([1, 3, 5]), [1, 3, 5]);
});

test("parseDeliveryDays parses string-encoded numbers (legacy DB rows)", () => {
  assert.deepEqual(parseDeliveryDays(["1", "3", "5"]), [1, 3, 5]);
});

test("parseDeliveryDays accepts mix of numbers and numeric strings", () => {
  assert.deepEqual(parseDeliveryDays([0, "2", 6]), [0, 2, 6]);
});

test("parseDeliveryDays returns empty array when value is null / undefined", () => {
  assert.deepEqual(parseDeliveryDays(null), []);
  assert.deepEqual(parseDeliveryDays(undefined), []);
});

test("parseDeliveryDays returns empty array when value is not an array", () => {
  assert.deepEqual(parseDeliveryDays("monday"), []);
  assert.deepEqual(parseDeliveryDays(7), []);
  assert.deepEqual(parseDeliveryDays({ mon: true }), []);
  assert.deepEqual(parseDeliveryDays(true), []);
});

test("parseDeliveryDays drops out-of-range weekdays (-1, 7, 99)", () => {
  assert.deepEqual(parseDeliveryDays([-1, 0, 7, 99, 6]), [0, 6]);
});

test("parseDeliveryDays drops non-integer values (1.5, NaN, null entries)", () => {
  assert.deepEqual(parseDeliveryDays([1, 1.5, 2, Number.NaN, null, 3]), [1, 2, 3]);
});

test("parseDeliveryDays drops un-parseable string entries", () => {
  assert.deepEqual(parseDeliveryDays(["mon", "1", "tue", "3"]), [1, 3]);
});

test("parseDeliveryDays preserves order (does not auto-sort)", () => {
  // Caller decides display order — math (forecast) reads as-is.
  assert.deepEqual(parseDeliveryDays([5, 1, 3]), [5, 1, 3]);
});

test("parseDeliveryDays does not deduplicate (input fidelity)", () => {
  // toDeliveryDaysJson dedupes on the way back in — parse stays faithful.
  assert.deepEqual(parseDeliveryDays([1, 1, 2]), [1, 1, 2]);
});

test("toDeliveryDaysJson dedupes input", () => {
  assert.deepEqual(toDeliveryDaysJson([1, 1, 2, 3, 3]), [1, 2, 3]);
});

test("toDeliveryDaysJson drops out-of-range entries", () => {
  assert.deepEqual(toDeliveryDaysJson([-1, 0, 7, 6]), [0, 6]);
});

test("toDeliveryDaysJson drops non-integer entries", () => {
  assert.deepEqual(toDeliveryDaysJson([1, 1.5, 2, Number.NaN]), [1, 2]);
});

test("toDeliveryDaysJson on empty array returns empty array", () => {
  assert.deepEqual(toDeliveryDaysJson([]), []);
});

test("toDeliveryDaysJson preserves order of first occurrence after dedupe", () => {
  // Set preserves insertion order; the filter doesn't reorder.
  assert.deepEqual(toDeliveryDaysJson([3, 1, 3, 5, 1]), [3, 1, 5]);
});

test("formatDeliveryDays renders weekday short names in given order", () => {
  assert.equal(formatDeliveryDays([1, 3, 5]), "Mon, Wed, Fri");
});

test("formatDeliveryDays returns the empty-state message when no valid days", () => {
  assert.equal(formatDeliveryDays(null), "No delivery schedule");
  assert.equal(formatDeliveryDays([]), "No delivery schedule");
  assert.equal(formatDeliveryDays(["bad", "also bad"]), "No delivery schedule");
});

test("formatDeliveryDays handles full week", () => {
  assert.equal(
    formatDeliveryDays([0, 1, 2, 3, 4, 5, 6]),
    "Sun, Mon, Tue, Wed, Thu, Fri, Sat"
  );
});

test("formatDeliveryDays accepts string-encoded weekdays", () => {
  assert.equal(formatDeliveryDays(["1", "5"]), "Mon, Fri");
});

test("formatDeliveryDays preserves caller order — does not auto-sort", () => {
  // Some suppliers configure delivery as e.g. "Wed, Sat, Mon"; we
  // shouldn't silently reorder the human's preference.
  assert.equal(formatDeliveryDays([3, 6, 1]), "Wed, Sat, Mon");
});

test("round-trip: format(toJson(parse(x))) is stable for already-clean input", () => {
  const input = [1, 3, 5];
  // toDeliveryDaysJson returns Prisma.InputJsonValue (write-side); formatDeliveryDays
  // takes Prisma.JsonValue (read-side). The runtime values are interchangeable
  // (plain number arrays), so this cast just bridges the two Prisma type families.
  const json = toDeliveryDaysJson(parseDeliveryDays(input)) as unknown as number[];
  assert.equal(formatDeliveryDays(json), "Mon, Wed, Fri");
});

test("round-trip cleanses garbage and dedupes", () => {
  const input = ["1", 1, "mon", 99, 3, 3, 1.5] as unknown as Array<number | string>;
  const cleansed = toDeliveryDaysJson(parseDeliveryDays(input)) as unknown as number[];
  assert.deepEqual(cleansed, [1, 3]);
  assert.equal(formatDeliveryDays(cleansed), "Mon, Wed");
});
