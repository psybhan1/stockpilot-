import test from "node:test";
import assert from "node:assert/strict";

import {
  findFuzzyMatches,
  rankItemsByUrgency,
  sanitiseReply,
} from "./agent-helpers";

type RankedItem = { id: string; name: string; snapshot: { urgency: string | null } | null };

// ─── findFuzzyMatches ──────────────────────────────────────────────────────

const milkItems = [
  { id: "1", name: "Whole Milk" },
  { id: "2", name: "Oat Milk" },
  { id: "3", name: "Milk 2%" },
  { id: "4", name: "Espresso Beans" },
];

test("findFuzzyMatches: exact match wins alone", () => {
  const matches = findFuzzyMatches(milkItems, "Oat Milk");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "2");
});

test("findFuzzyMatches: exact match is case-insensitive", () => {
  const matches = findFuzzyMatches(milkItems, "oat milk");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "2");
});

test("findFuzzyMatches: single substring match returns one", () => {
  const matches = findFuzzyMatches(milkItems, "espresso");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "4");
});

test("findFuzzyMatches: ambiguous 'milk' returns ALL three", () => {
  const matches = findFuzzyMatches(milkItems, "milk");
  assert.equal(matches.length, 3);
  // Sorted shortest-first, so "Oat Milk" / "Milk 2%" ahead of "Whole Milk".
  const names = matches.map((m) => m.name);
  assert.deepEqual(names.slice(0, 3).sort(), ["Milk 2%", "Oat Milk", "Whole Milk"].sort());
});

test("findFuzzyMatches: no match returns empty", () => {
  const matches = findFuzzyMatches(milkItems, "lavender syrup");
  assert.equal(matches.length, 0);
});

test("findFuzzyMatches: empty query returns empty", () => {
  assert.equal(findFuzzyMatches(milkItems, "").length, 0);
  assert.equal(findFuzzyMatches(milkItems, "   ").length, 0);
});

test("findFuzzyMatches: reverse-includes — 'whole milk' user said, 'milk' in DB", () => {
  const shortItems = [{ id: "m", name: "Milk" }];
  const matches = findFuzzyMatches(shortItems, "whole milk");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "m");
});

// ─── rankItemsByUrgency ────────────────────────────────────────────────────

test("rankItemsByUrgency: CRITICAL before WARNING before null", () => {
  const items: RankedItem[] = [
    { id: "3", name: "Zebra", snapshot: { urgency: null } },
    { id: "2", name: "Yak", snapshot: { urgency: "WARNING" } },
    { id: "1", name: "Alpaca", snapshot: { urgency: "CRITICAL" } },
  ];
  const ranked = rankItemsByUrgency(items);
  assert.deepEqual(ranked.map((r) => r.id), ["1", "2", "3"]);
});

test("rankItemsByUrgency: alphabetical tiebreak within same urgency", () => {
  const items: RankedItem[] = [
    { id: "b", name: "Beta", snapshot: { urgency: "CRITICAL" } },
    { id: "a", name: "Alpha", snapshot: { urgency: "CRITICAL" } },
  ];
  const ranked = rankItemsByUrgency(items);
  assert.deepEqual(ranked.map((r) => r.name), ["Alpha", "Beta"]);
});

test("rankItemsByUrgency: empty array → empty", () => {
  assert.deepEqual(rankItemsByUrgency([]), []);
});

// ─── sanitiseReply ─────────────────────────────────────────────────────────

test("sanitiseReply: empty placeholders get stripped", () => {
  const out = sanitiseReply("your order is ``", "fallback");
  assert.ok(!out.includes("``"));
});

test("sanitiseReply: PO-PO-XXXX repeated prefix gets stripped", () => {
  const out = sanitiseReply("sent PO-PO-ABCD to supplier", "fallback");
  assert.ok(!out.includes("PO-PO-"));
});

test("sanitiseReply: NEW tool names don't leak into output", () => {
  // Every new tool I added must be masked by the tool-name regex.
  const samples = [
    "I'll check_margins for you",
    "let me check_variance",
    "running check_pricing_trends now",
    "pulling item_price_history",
    "analytics_overview coming up",
    "forecast_runout will tell us",
  ];
  for (const raw of samples) {
    const out = sanitiseReply(raw, "fallback");
    const lower = out.toLowerCase();
    assert.ok(!lower.includes("check_margins"), `leaked in: ${raw}`);
    assert.ok(!lower.includes("check_variance"), `leaked in: ${raw}`);
    assert.ok(!lower.includes("check_pricing_trends"), `leaked in: ${raw}`);
    assert.ok(!lower.includes("item_price_history"), `leaked in: ${raw}`);
    assert.ok(!lower.includes("analytics_overview"), `leaked in: ${raw}`);
    assert.ok(!lower.includes("forecast_runout"), `leaked in: ${raw}`);
  }
});

test("sanitiseReply: null → fallback", () => {
  assert.equal(sanitiseReply(null, "fallback text"), "fallback text");
});

test("sanitiseReply: double-space collapse", () => {
  assert.equal(sanitiseReply("hello    world", "x"), "hello world");
});

test("sanitiseReply: 'I'll call X tool' narration gets stripped", () => {
  const out = sanitiseReply("I'll call list_inventory tool. Hang on.", "fallback");
  assert.ok(!out.toLowerCase().includes("i'll call"));
});
