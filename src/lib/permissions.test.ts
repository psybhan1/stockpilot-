import test from "node:test";
import assert from "node:assert/strict";

import {
  getDefaultRouteForRole,
  getHighestRole,
  hasMinimumRole,
  roleRank,
} from "./permissions";
import { Role } from "./domain-enums";

// ── roleRank ordering ────────────────────────────────────────────────

test("roleRank: MANAGER > SUPERVISOR > STAFF (strict ordering)", () => {
  assert.ok(roleRank.MANAGER > roleRank.SUPERVISOR);
  assert.ok(roleRank.SUPERVISOR > roleRank.STAFF);
  // STAFF is the floor — nothing ranks below it in our model.
  assert.equal(Math.min(roleRank.STAFF, roleRank.SUPERVISOR, roleRank.MANAGER), roleRank.STAFF);
});

// ── hasMinimumRole ──────────────────────────────────────────────────

test("hasMinimumRole: a MANAGER clears every gate", () => {
  assert.equal(hasMinimumRole(Role.MANAGER, Role.STAFF), true);
  assert.equal(hasMinimumRole(Role.MANAGER, Role.SUPERVISOR), true);
  assert.equal(hasMinimumRole(Role.MANAGER, Role.MANAGER), true);
});

test("hasMinimumRole: SUPERVISOR clears STAFF/SUPERVISOR gates but not MANAGER", () => {
  assert.equal(hasMinimumRole(Role.SUPERVISOR, Role.STAFF), true);
  assert.equal(hasMinimumRole(Role.SUPERVISOR, Role.SUPERVISOR), true);
  assert.equal(hasMinimumRole(Role.SUPERVISOR, Role.MANAGER), false);
});

test("hasMinimumRole: STAFF only clears STAFF gate", () => {
  assert.equal(hasMinimumRole(Role.STAFF, Role.STAFF), true);
  assert.equal(hasMinimumRole(Role.STAFF, Role.SUPERVISOR), false);
  assert.equal(hasMinimumRole(Role.STAFF, Role.MANAGER), false);
});

test("hasMinimumRole: equality case is inclusive (someone at the bar clears it)", () => {
  for (const r of [Role.STAFF, Role.SUPERVISOR, Role.MANAGER]) {
    assert.equal(hasMinimumRole(r, r), true, `${r} should clear its own gate`);
  }
});

// ── getHighestRole ──────────────────────────────────────────────────

test("getHighestRole: picks MANAGER out of a mixed set", () => {
  assert.equal(
    getHighestRole([Role.STAFF, Role.MANAGER, Role.SUPERVISOR]),
    Role.MANAGER,
  );
});

test("getHighestRole: picks SUPERVISOR when no manager is present", () => {
  assert.equal(
    getHighestRole([Role.STAFF, Role.SUPERVISOR, Role.STAFF]),
    Role.SUPERVISOR,
  );
});

test("getHighestRole: single-role arrays return that role untouched", () => {
  assert.equal(getHighestRole([Role.STAFF]), Role.STAFF);
  assert.equal(getHighestRole([Role.SUPERVISOR]), Role.SUPERVISOR);
  assert.equal(getHighestRole([Role.MANAGER]), Role.MANAGER);
});

test("getHighestRole: duplicate roles don't confuse the pick", () => {
  assert.equal(
    getHighestRole([Role.MANAGER, Role.MANAGER, Role.STAFF]),
    Role.MANAGER,
  );
});

test("getHighestRole: empty array falls back to STAFF (least-privilege default)", () => {
  // A user with zero assigned roles should be treated as STAFF, not
  // undefined — otherwise the route resolver below crashes.
  assert.equal(getHighestRole([]), Role.STAFF);
});

test("getHighestRole: order in input array does not change the result", () => {
  // Sort is descending by rank, so ordering of input shouldn't matter.
  const ascending = [Role.STAFF, Role.SUPERVISOR, Role.MANAGER];
  const descending = [Role.MANAGER, Role.SUPERVISOR, Role.STAFF];
  const shuffled = [Role.SUPERVISOR, Role.MANAGER, Role.STAFF];
  assert.equal(getHighestRole(ascending), Role.MANAGER);
  assert.equal(getHighestRole(descending), Role.MANAGER);
  assert.equal(getHighestRole(shuffled), Role.MANAGER);
});

// ── getDefaultRouteForRole ──────────────────────────────────────────

test("getDefaultRouteForRole: MANAGER lands on /dashboard", () => {
  assert.equal(getDefaultRouteForRole(Role.MANAGER), "/dashboard");
});

test("getDefaultRouteForRole: SUPERVISOR lands on /dashboard (bar is >= SUPERVISOR)", () => {
  assert.equal(getDefaultRouteForRole(Role.SUPERVISOR), "/dashboard");
});

test("getDefaultRouteForRole: STAFF lands on the stock-count swipe tool", () => {
  // Staff workflow is counting inventory from the walk-in, not reviewing
  // dashboards — route default reflects that.
  assert.equal(getDefaultRouteForRole(Role.STAFF), "/stock-count/swipe");
});
