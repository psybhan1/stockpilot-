import test from "node:test";
import assert from "node:assert/strict";

import {
  PLANS,
  isStripeConfigured,
  planHasFeature,
  recommendPlanForLocationCount,
  stripePriceIdForPlan,
  type PlanKey,
} from "./stripe-plans";

// Helper: snapshot + restore env for a test so one test can't leak
// config into the next.
function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void,
) {
  const keys = Object.keys(overrides);
  const prior: Record<string, string | undefined> = {};
  for (const k of keys) prior[k] = process.env[k];
  try {
    for (const k of keys) {
      const v = overrides[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const k of keys) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  }
}

// ── PLANS registry: pricing + shape integrity ──────────────────────

test("PLANS: every key matches its own `key` field (no registry/field mismatch)", () => {
  // A foot-gun: looking up PLANS["growth"] should never return a Plan
  // whose .key says "solo". Prior to this guard a typo during a future
  // rename could silently break every gate that compares plan keys.
  for (const key of Object.keys(PLANS) as PlanKey[]) {
    assert.equal(PLANS[key].key, key, `PLANS["${key}"].key must equal "${key}"`);
  }
});

test("PLANS: strictly three tiers in ascending price order", () => {
  // Pricing page + /billing upgrade ladder assume solo < growth < pro.
  // Any reorder here would show nonsense to users ("Pro for $39").
  const keys = Object.keys(PLANS);
  assert.deepEqual(keys, ["solo", "growth", "pro"]);
  assert.ok(PLANS.solo.priceCents < PLANS.growth.priceCents);
  assert.ok(PLANS.growth.priceCents < PLANS.pro.priceCents);
});

test("PLANS: priceDisplay matches priceCents (no stale display string)", () => {
  // Catches the classic "we raised the price but forgot to update the
  // label on the pricing page" bug.
  for (const plan of Object.values(PLANS)) {
    const dollars = Math.floor(plan.priceCents / 100);
    assert.equal(
      plan.priceDisplay,
      `$${dollars}`,
      `${plan.key}: priceDisplay should derive from priceCents`,
    );
  }
});

test("PLANS: maxLocations ladder is monotonically non-decreasing", () => {
  // solo=1, growth=5, pro=null (unlimited). Any reorder would let a
  // lower-tier plan cover more locations than a higher one.
  assert.equal(PLANS.solo.maxLocations, 1);
  assert.equal(PLANS.growth.maxLocations, 5);
  assert.equal(PLANS.pro.maxLocations, null);
  assert.ok((PLANS.growth.maxLocations ?? 0) > (PLANS.solo.maxLocations ?? 0));
});

test("PLANS: every plan has a non-empty features list + label + tagline + cta", () => {
  // These strings all render on the public pricing page — empties
  // would show up as literal blanks in the UI.
  for (const plan of Object.values(PLANS)) {
    assert.ok(plan.label.length > 0, `${plan.key}: label empty`);
    assert.ok(plan.tagline.length > 0, `${plan.key}: tagline empty`);
    assert.ok(plan.cta.length > 0, `${plan.key}: cta empty`);
    assert.ok(
      plan.features.length >= 3,
      `${plan.key}: expected >=3 features, got ${plan.features.length}`,
    );
    for (const [i, f] of plan.features.entries()) {
      assert.ok(f && f.trim().length > 0, `${plan.key}: feature[${i}] blank`);
    }
  }
});

test("PLANS: stripePriceEnvVar follows the STRIPE_PRICE_<KEY> convention", () => {
  // The deploy runbook tells operators to set env vars named
  // STRIPE_PRICE_SOLO / _GROWTH / _PRO. If this registry disagrees
  // with the runbook, customers see "billing unavailable" silently.
  for (const plan of Object.values(PLANS)) {
    assert.equal(
      plan.stripePriceEnvVar,
      `STRIPE_PRICE_${plan.key.toUpperCase()}`,
      `${plan.key}: unexpected env var name ${plan.stripePriceEnvVar}`,
    );
  }
});

test("PLANS: all stripePriceEnvVar strings are unique", () => {
  // If two plans pointed at the same env var, upgrading to Pro would
  // silently bill at the Growth price (or vice versa).
  const names = Object.values(PLANS).map((p) => p.stripePriceEnvVar);
  assert.equal(new Set(names).size, names.length);
});

// ── recommendPlanForLocationCount: 1, 2–5, 6+ ladder ───────────────

test("recommendPlanForLocationCount: 0 → solo (no locations yet, default to cheapest)", () => {
  assert.equal(recommendPlanForLocationCount(0), "solo");
});

test("recommendPlanForLocationCount: 1 → solo (solo's exact ceiling)", () => {
  assert.equal(recommendPlanForLocationCount(1), "solo");
});

test("recommendPlanForLocationCount: 2 → growth (first rung above solo)", () => {
  // Growth kicks in as soon as a second location exists — this is the
  // conversion point the pricing page documents.
  assert.equal(recommendPlanForLocationCount(2), "growth");
});

test("recommendPlanForLocationCount: 5 → growth (growth's exact ceiling)", () => {
  assert.equal(recommendPlanForLocationCount(5), "growth");
});

test("recommendPlanForLocationCount: 6 → pro (first rung above growth)", () => {
  // 6 is explicitly the upgrade-to-pro trigger per the function body.
  assert.equal(recommendPlanForLocationCount(6), "pro");
});

test("recommendPlanForLocationCount: huge N → pro (no overflow surprise)", () => {
  assert.equal(recommendPlanForLocationCount(10_000), "pro");
  assert.equal(recommendPlanForLocationCount(Number.MAX_SAFE_INTEGER), "pro");
});

test("recommendPlanForLocationCount: negative input falls back to solo (bad data → cheapest)", () => {
  // Shouldn't happen, but if a DB count underflows we'd rather quote
  // $39 than crash the upgrade CTA.
  assert.equal(recommendPlanForLocationCount(-1), "solo");
  assert.equal(recommendPlanForLocationCount(-999), "solo");
});

test("recommendPlanForLocationCount: NaN falls back to solo (bad data → cheapest)", () => {
  // `NaN >= 6` and `NaN >= 2` are both false → solo. Lock this in so
  // a future "clever" rewrite doesn't accidentally recommend pro.
  assert.equal(recommendPlanForLocationCount(Number.NaN), "solo");
});

// ── planHasFeature: unbilled / solo / growth / pro gates ───────────

test("planHasFeature: null plan (unbilled / trial expired) fails every gate", () => {
  for (const feat of [
    "rescue",
    "analytics",
    "multi_location",
    "pos",
    "custom_reports",
  ] as const) {
    assert.equal(
      planHasFeature(null, feat),
      false,
      `null plan must fail ${feat}`,
    );
  }
});

test("planHasFeature: solo unlocks nothing above the floor (rescue/pos/analytics all locked)", () => {
  // Solo is the entry tier — paying customers still need to upgrade
  // for POS, rescue, multi-location, analytics, custom reports.
  assert.equal(planHasFeature("solo", "rescue"), false);
  assert.equal(planHasFeature("solo", "pos"), false);
  assert.equal(planHasFeature("solo", "multi_location"), false);
  assert.equal(planHasFeature("solo", "analytics"), false);
  assert.equal(planHasFeature("solo", "custom_reports"), false);
});

test("planHasFeature: growth unlocks the middle tier (rescue, pos, multi_location, analytics)", () => {
  // These are the four Growth-marketed features per the /pricing page.
  assert.equal(planHasFeature("growth", "rescue"), true);
  assert.equal(planHasFeature("growth", "pos"), true);
  assert.equal(planHasFeature("growth", "multi_location"), true);
  assert.equal(planHasFeature("growth", "analytics"), true);
});

test("planHasFeature: growth is STILL locked out of custom_reports (pro-only)", () => {
  // Custom reports are the pro upsell — growth subscribers must not
  // access them even though they have everything else.
  assert.equal(planHasFeature("growth", "custom_reports"), false);
});

test("planHasFeature: pro unlocks everything (top tier)", () => {
  for (const feat of [
    "rescue",
    "analytics",
    "multi_location",
    "pos",
    "custom_reports",
  ] as const) {
    assert.equal(
      planHasFeature("pro", feat),
      true,
      `pro must unlock ${feat}`,
    );
  }
});

test("planHasFeature: custom_reports is PRO-EXCLUSIVE (only non-free-on-growth feature)", () => {
  // Tripwire: if someone adds "custom_reports: 1" by accident, Growth
  // customers get Pro-only reporting features for free.
  assert.equal(planHasFeature("solo", "custom_reports"), false);
  assert.equal(planHasFeature("growth", "custom_reports"), false);
  assert.equal(planHasFeature("pro", "custom_reports"), true);
});

// ── stripePriceIdForPlan: env-var lookup + blank-env guard ─────────

test("stripePriceIdForPlan: returns the env-var value when set to a real price ID", () => {
  withEnv(
    {
      STRIPE_PRICE_SOLO: "price_solo_123",
      STRIPE_PRICE_GROWTH: "price_growth_456",
      STRIPE_PRICE_PRO: "price_pro_789",
    },
    () => {
      assert.equal(stripePriceIdForPlan("solo"), "price_solo_123");
      assert.equal(stripePriceIdForPlan("growth"), "price_growth_456");
      assert.equal(stripePriceIdForPlan("pro"), "price_pro_789");
    },
  );
});

test("stripePriceIdForPlan: returns null when the env var is unset", () => {
  withEnv(
    {
      STRIPE_PRICE_SOLO: undefined,
      STRIPE_PRICE_GROWTH: undefined,
      STRIPE_PRICE_PRO: undefined,
    },
    () => {
      assert.equal(stripePriceIdForPlan("solo"), null);
      assert.equal(stripePriceIdForPlan("growth"), null);
      assert.equal(stripePriceIdForPlan("pro"), null);
    },
  );
});

test("stripePriceIdForPlan: returns null when env var is an empty string (blank deploy guard)", () => {
  // Real-world failure: a Railway env was pushed as "" and Stripe
  // returned 400 "Invalid price ID" at checkout. Treat blank as unset.
  withEnv({ STRIPE_PRICE_SOLO: "" }, () => {
    assert.equal(stripePriceIdForPlan("solo"), null);
  });
});

test("stripePriceIdForPlan: returns null when env var is whitespace-only", () => {
  // Also a real failure mode — someone pastes a price ID with trailing
  // whitespace and it gets trimmed away; any pure-whitespace value
  // must resolve to "not configured" instead of an invalid API call.
  withEnv({ STRIPE_PRICE_GROWTH: "   \t\n " }, () => {
    assert.equal(stripePriceIdForPlan("growth"), null);
  });
});

test("stripePriceIdForPlan: trims leading/trailing whitespace on valid values", () => {
  // Envs pasted from docs sometimes gain a trailing newline. Silently
  // trim so the Stripe API call isn't sent a malformed price ID.
  withEnv({ STRIPE_PRICE_PRO: "  price_pro_xyz\n" }, () => {
    assert.equal(stripePriceIdForPlan("pro"), "price_pro_xyz");
  });
});

test("stripePriceIdForPlan: each plan reads its OWN env var (no cross-pollination)", () => {
  // If growth accidentally read STRIPE_PRICE_SOLO, customers upgrading
  // to growth would be billed the solo price forever.
  withEnv(
    {
      STRIPE_PRICE_SOLO: "price_A",
      STRIPE_PRICE_GROWTH: undefined,
      STRIPE_PRICE_PRO: undefined,
    },
    () => {
      assert.equal(stripePriceIdForPlan("solo"), "price_A");
      assert.equal(stripePriceIdForPlan("growth"), null);
      assert.equal(stripePriceIdForPlan("pro"), null);
    },
  );
});

// ── isStripeConfigured: two-key gate + blank guard ─────────────────

test("isStripeConfigured: true only when BOTH secret key + webhook secret are set", () => {
  // Either half-configured state (just a secret key, or just a webhook
  // secret) should read as "not configured" — otherwise /api/billing
  // routes would 500 instead of showing the setup CTA.
  withEnv(
    { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_y" },
    () => {
      assert.equal(isStripeConfigured(), true);
    },
  );
});

test("isStripeConfigured: false when only STRIPE_SECRET_KEY is set", () => {
  withEnv(
    { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: undefined },
    () => {
      assert.equal(isStripeConfigured(), false);
    },
  );
});

test("isStripeConfigured: false when only STRIPE_WEBHOOK_SECRET is set", () => {
  withEnv(
    { STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: "whsec_y" },
    () => {
      assert.equal(isStripeConfigured(), false);
    },
  );
});

test("isStripeConfigured: false when both are unset", () => {
  withEnv(
    { STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined },
    () => {
      assert.equal(isStripeConfigured(), false);
    },
  );
});

test("isStripeConfigured: false when either env is empty string (blank deploy guard)", () => {
  // Matches the same "blank == unset" contract as stripePriceIdForPlan.
  withEnv(
    { STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "whsec_y" },
    () => {
      assert.equal(isStripeConfigured(), false);
    },
  );
  withEnv(
    { STRIPE_SECRET_KEY: "sk_x", STRIPE_WEBHOOK_SECRET: "" },
    () => {
      assert.equal(isStripeConfigured(), false);
    },
  );
});

test("isStripeConfigured: false when either env is whitespace-only", () => {
  withEnv(
    { STRIPE_SECRET_KEY: "   ", STRIPE_WEBHOOK_SECRET: "whsec_y" },
    () => {
      assert.equal(isStripeConfigured(), false);
    },
  );
});
