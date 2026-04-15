/**
 * Plan definitions — source of truth for pricing / feature gates.
 * Matches the public /pricing page + /billing page + marketing site.
 *
 * Stripe price IDs live in env so we can swap between test + live
 * modes without a redeploy:
 *   STRIPE_PRICE_SOLO / STRIPE_PRICE_GROWTH / STRIPE_PRICE_PRO
 *   STRIPE_PUBLISHABLE_KEY / STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
 */

export type PlanKey = "solo" | "growth" | "pro";

export type Plan = {
  key: PlanKey;
  label: string;
  priceCents: number;
  priceDisplay: string;
  tagline: string;
  maxLocations: number | null;
  features: string[];
  cta: string;
  stripePriceEnvVar: string;
};

export const PLANS: Record<PlanKey, Plan> = {
  solo: {
    key: "solo",
    label: "Solo",
    priceCents: 3900,
    priceDisplay: "$39",
    tagline: "A single café or bakery.",
    maxLocations: 1,
    features: [
      "1 location",
      "Unlimited items & suppliers",
      "Telegram + WhatsApp bot",
      "Gmail email sending",
      "Morning brief + reply polling",
    ],
    cta: "Start free trial",
    stripePriceEnvVar: "STRIPE_PRICE_SOLO",
  },
  growth: {
    key: "growth",
    label: "Growth",
    priceCents: 9900,
    priceDisplay: "$99",
    tagline: "Multi-café operators.",
    maxLocations: 5,
    features: [
      "Up to 5 locations",
      "OUT_OF_STOCK auto-rescue",
      "POS integration (Square)",
      "Recipe-aware stock depletion",
      "Priority support + onboarding call",
    ],
    cta: "Start free trial",
    stripePriceEnvVar: "STRIPE_PRICE_GROWTH",
  },
  pro: {
    key: "pro",
    label: "Pro",
    priceCents: 24900,
    priceDisplay: "$249",
    tagline: "Groups of 5+ and franchises.",
    maxLocations: null,
    features: [
      "Unlimited locations",
      "Supplier reliability scorecards",
      "Weekly exec digest + custom reports",
      "Multi-user roles, audit log exports",
      "Slack channel + named CSM",
    ],
    cta: "Talk to sales",
    stripePriceEnvVar: "STRIPE_PRICE_PRO",
  },
};

export function recommendPlanForLocationCount(locationsCount: number): PlanKey {
  if (locationsCount >= 6) return "pro";
  if (locationsCount >= 2) return "growth";
  return "solo";
}

/** Returns true if the currently-billed plan covers the given feature flag. */
export function planHasFeature(
  plan: PlanKey | null,
  feature: "rescue" | "analytics" | "multi_location" | "pos" | "custom_reports"
): boolean {
  if (!plan) return false;
  const order: PlanKey[] = ["solo", "growth", "pro"];
  const idx = order.indexOf(plan);
  const gate: Record<string, number> = {
    rescue: 1,
    pos: 1,
    multi_location: 1,
    analytics: 1,
    custom_reports: 2,
  };
  return idx >= (gate[feature] ?? 0);
}

/**
 * Resolves the Stripe price ID for a given plan from env. Returns null
 * if the env var isn't set (i.e. Stripe hasn't been configured yet —
 * surface this as a "set up billing" CTA instead of a 500).
 */
export function stripePriceIdForPlan(plan: PlanKey): string | null {
  return process.env[PLANS[plan].stripePriceEnvVar] ?? null;
}

export function isStripeConfigured(): boolean {
  return (
    !!process.env.STRIPE_SECRET_KEY &&
    !!process.env.STRIPE_WEBHOOK_SECRET
  );
}
