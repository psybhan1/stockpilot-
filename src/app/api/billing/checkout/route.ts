/**
 * Creates a Stripe Checkout Session and 303-redirects the authed
 * manager to Stripe. If Stripe env vars aren't configured yet we
 * 303 to a mailto: URL so the operator can still contact us.
 *
 * Setup checklist to make this actually charge money:
 *   1. Create 3 recurring Prices in Stripe Dashboard (Solo $39/mo,
 *      Growth $99/mo, Pro $249/mo).
 *   2. Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and
 *      STRIPE_PRICE_SOLO / _GROWTH / _PRO env vars on Railway.
 *   3. Point a webhook at POST /api/billing/webhook and subscribe
 *      to checkout.session.completed, customer.subscription.updated,
 *      and invoice.payment_failed events.
 */

import { NextRequest, NextResponse } from "next/server";
import { Role } from "@/lib/domain-enums";
import { getSession } from "@/modules/auth/session";
import { db } from "@/lib/db";
import {
  PLANS,
  isStripeConfigured,
  stripePriceIdForPlan,
  type PlanKey,
} from "@/lib/stripe-plans";
import { env } from "@/lib/env";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== Role.MANAGER) {
    return NextResponse.json({ message: "Managers only" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { plan?: string };
  const plan = body.plan as PlanKey | undefined;
  if (!plan || !(plan in PLANS)) {
    return NextResponse.json({ message: "Unknown plan" }, { status: 400 });
  }

  // Fall back to a mailto if Stripe isn't wired up yet — keeps the
  // flow walkable end-to-end in the founder preview.
  if (!isStripeConfigured() || !stripePriceIdForPlan(plan)) {
    const subject = encodeURIComponent(`Set up ${PLANS[plan].label} plan`);
    return NextResponse.json({
      ok: true,
      mode: "mailto",
      url: `mailto:billing@stockpilot.app?subject=${subject}`,
    });
  }

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
    },
  });
  if (!user) {
    return NextResponse.json({ message: "User not found" }, { status: 404 });
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-03-25.dahlia",
    });

    const origin = env.APP_URL?.replace(/\/+$/, "") ?? new URL(req.url).origin;
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: stripePriceIdForPlan(plan)!, quantity: 1 }],
      customer_email: user.email,
      subscription_data: {
        trial_period_days: 14,
        metadata: {
          stockpilotUserId: user.id,
          stockpilotLocationId: session.locationId,
          planKey: plan,
        },
      },
      client_reference_id: user.id,
      success_url: `${origin}/billing?checkout=success`,
      cancel_url: `${origin}/billing?checkout=cancelled`,
      allow_promotion_codes: true,
    });

    if (!checkout.url) {
      return NextResponse.json(
        { message: "Stripe returned no checkout URL" },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, mode: "stripe", url: checkout.url });
  } catch (err) {
    console.warn("[billing/checkout] stripe failed, using mailto fallback:", err);
    const subject = encodeURIComponent(`Set up ${PLANS[plan].label} plan`);
    return NextResponse.json({
      ok: true,
      mode: "mailto",
      url: `mailto:billing@stockpilot.app?subject=${subject}`,
    });
  }
}
