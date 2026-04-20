import test from "node:test";
import assert from "node:assert/strict";
import { differenceInCalendarDays } from "date-fns";

import {
  calculateAverageDailyUsage,
  calculateDaysLeft,
  classifyUrgency,
  projectRunoutDate,
} from "./forecast";

// ─── calculateAverageDailyUsage ──────────────────────────────────────────────

test("calculateAverageDailyUsage: computes daily usage from a 7-day window", () => {
  assert.equal(calculateAverageDailyUsage(2800, 7), 400);
});

test("calculateAverageDailyUsage: returns 0 when window is 0 (guards /0)", () => {
  assert.equal(calculateAverageDailyUsage(1000, 0), 0);
});

test("calculateAverageDailyUsage: returns 0 when window is negative", () => {
  assert.equal(calculateAverageDailyUsage(1000, -3), 0);
});

test("calculateAverageDailyUsage: defaults to 7-day window when omitted", () => {
  assert.equal(calculateAverageDailyUsage(2800), 400);
});

test("calculateAverageDailyUsage: zero consumption → zero daily usage", () => {
  assert.equal(calculateAverageDailyUsage(0, 7), 0);
});

test("calculateAverageDailyUsage: supports custom window (e.g. 14-day avg)", () => {
  assert.equal(calculateAverageDailyUsage(1400, 14), 100);
});

// ─── calculateDaysLeft ───────────────────────────────────────────────────────

test("calculateDaysLeft: happy path (stock / burn rate)", () => {
  assert.ok(Math.abs((calculateDaysLeft(3500, 1300) ?? 0) - 2.6923) < 0.001);
});

test("calculateDaysLeft: zero avg usage → null (unknown burn rate)", () => {
  assert.equal(calculateDaysLeft(3500, 0), null);
});

test("calculateDaysLeft: negative avg usage → null (bad data)", () => {
  assert.equal(calculateDaysLeft(3500, -5), null);
});

test("calculateDaysLeft: zero stock + zero usage → 0 (stockout NOW, not unknown)", () => {
  // Regression: previously returned null, masking a literal stockout as INFO.
  assert.equal(calculateDaysLeft(0, 0), 0);
});

test("calculateDaysLeft: zero stock + positive usage → 0", () => {
  assert.equal(calculateDaysLeft(0, 100), 0);
});

test("calculateDaysLeft: negative stock (oversold) → 0", () => {
  assert.equal(calculateDaysLeft(-50, 100), 0);
});

test("calculateDaysLeft: tiny burn rate yields large but finite days", () => {
  const result = calculateDaysLeft(1000, 0.5);
  assert.equal(result, 2000);
});

// ─── projectRunoutDate ───────────────────────────────────────────────────────

test("projectRunoutDate: null days → null date", () => {
  assert.equal(projectRunoutDate(null), null);
});

test("projectRunoutDate: 0 days → today", () => {
  const result = projectRunoutDate(0);
  assert.ok(result instanceof Date);
  assert.equal(differenceInCalendarDays(result!, new Date()), 0);
});

test("projectRunoutDate: 5 days → 5 days from now", () => {
  const result = projectRunoutDate(5);
  assert.ok(result instanceof Date);
  assert.equal(differenceInCalendarDays(result!, new Date()), 5);
});

// ─── classifyUrgency ─────────────────────────────────────────────────────────

test("classifyUrgency: null days left → INFO (no signal)", () => {
  assert.equal(
    classifyUrgency({ daysLeft: null, leadTimeDays: 3, safetyDays: 2 }),
    "INFO"
  );
});

test("classifyUrgency: days left inside lead time → CRITICAL", () => {
  assert.equal(
    classifyUrgency({ daysLeft: 1.5, leadTimeDays: 2, safetyDays: 1 }),
    "CRITICAL"
  );
});

test("classifyUrgency: days left exactly equals lead time → CRITICAL", () => {
  assert.equal(
    classifyUrgency({ daysLeft: 2, leadTimeDays: 2, safetyDays: 1 }),
    "CRITICAL"
  );
});

test("classifyUrgency: zero days left → CRITICAL (stockout now)", () => {
  assert.equal(
    classifyUrgency({ daysLeft: 0, leadTimeDays: 3, safetyDays: 2 }),
    "CRITICAL"
  );
});

test("classifyUrgency: negative days left (oversold) → CRITICAL", () => {
  assert.equal(
    classifyUrgency({ daysLeft: -2, leadTimeDays: 3, safetyDays: 2 }),
    "CRITICAL"
  );
});

test("classifyUrgency: zero lead time still enforces 1-day CRITICAL band", () => {
  // Math.max(leadTimeDays, 1) guard — same-day delivery shouldn't make
  // a 12-hour-of-stock situation merely "warning."
  assert.equal(
    classifyUrgency({ daysLeft: 0.5, leadTimeDays: 0, safetyDays: 5 }),
    "CRITICAL"
  );
});

test("classifyUrgency: days left inside lead+safety band → WARNING", () => {
  assert.equal(
    classifyUrgency({ daysLeft: 3, leadTimeDays: 2, safetyDays: 1 }),
    "WARNING"
  );
});

test("classifyUrgency: days left exactly at lead+safety boundary → WARNING", () => {
  assert.equal(
    classifyUrgency({ daysLeft: 3, leadTimeDays: 2, safetyDays: 1 }),
    "WARNING"
  );
});

test("classifyUrgency: days left beyond safety buffer → INFO", () => {
  assert.equal(
    classifyUrgency({ daysLeft: 10, leadTimeDays: 2, safetyDays: 1 }),
    "INFO"
  );
});

test("classifyUrgency: zero safety days collapses WARNING band", () => {
  // daysLeft=2.5 > max(leadTime=2, 1)=2 (not CRITICAL),
  // and 2.5 > leadTime+safety=2+0=2 → INFO (no warning band)
  assert.equal(
    classifyUrgency({ daysLeft: 2.5, leadTimeDays: 2, safetyDays: 0 }),
    "INFO"
  );
});

// ─── Integration: the full pipeline stockout detection ──────────────────────

test("pipeline: 0 stock + 0 history flows through to CRITICAL urgency", () => {
  // The regression this guards against: an item at zero stock with no
  // recorded usage should surface as CRITICAL end-to-end, not INFO.
  const avg = calculateAverageDailyUsage(0, 7);
  const days = calculateDaysLeft(0, avg);
  const urgency = classifyUrgency({
    daysLeft: days,
    leadTimeDays: 2,
    safetyDays: 1,
  });

  assert.equal(avg, 0);
  assert.equal(days, 0);
  assert.equal(urgency, "CRITICAL");
});

test("pipeline: healthy item (lots of stock, modest usage) → INFO", () => {
  const avg = calculateAverageDailyUsage(700, 7); // 100/day
  const days = calculateDaysLeft(3000, avg);      // 30 days
  const urgency = classifyUrgency({
    daysLeft: days,
    leadTimeDays: 3,
    safetyDays: 2,
  });

  assert.equal(avg, 100);
  assert.equal(days, 30);
  assert.equal(urgency, "INFO");
});

test("pipeline: tight-stock item near lead time → WARNING", () => {
  const avg = calculateAverageDailyUsage(700, 7); // 100/day
  const days = calculateDaysLeft(500, avg);       // 5 days
  const urgency = classifyUrgency({
    daysLeft: days,
    leadTimeDays: 3,
    safetyDays: 3,
  });

  assert.equal(days, 5);
  assert.equal(urgency, "WARNING");
});
