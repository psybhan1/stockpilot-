import Link from "next/link";
import { ArrowRight, Check, CreditCard, Mail, Sparkles } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type PlanKey = "solo" | "growth" | "pro";

const PLAN_FEATURES: Record<PlanKey, string[]> = {
  solo: [
    "1 location, unlimited items & suppliers",
    "Telegram + WhatsApp bot",
    "Gmail email sending",
    "Morning brief + supplier reply polling",
  ],
  growth: [
    "Up to 5 locations, shared suppliers",
    "OUT_OF_STOCK auto-rescue",
    "POS integration (Square)",
    "Recipe-aware stock depletion",
    "Priority support",
  ],
  pro: [
    "Unlimited locations",
    "Supplier reliability scorecards",
    "Weekly exec digest + custom reports",
    "Multi-user roles, audit log exports",
    "Slack channel + named CSM",
  ],
};

const PLAN_PRICES: Record<PlanKey, string> = {
  solo: "$39",
  growth: "$99",
  pro: "$249",
};

export default async function BillingPage() {
  const session = await requireSession(Role.MANAGER);
  const [location, locationsCount] = await Promise.all([
    db.location.findUnique({
      where: { id: session.locationId },
      select: {
        business: { select: { id: true, name: true, slug: true } },
      },
    }),
    db.location.count({ where: { business: { locations: { some: { id: session.locationId } } } } }),
  ]);

  // Inferred plan: 1 location → Solo, 2–5 → Growth, 6+ → Pro.
  const inferred: PlanKey =
    locationsCount >= 6 ? "pro" : locationsCount >= 2 ? "growth" : "solo";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Billing
        </p>
        <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          You&apos;re on the founder preview.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          We&apos;re onboarding early customers 1:1 so nothing in your setup breaks. During the preview, billing is on us. When you&apos;re ready to move to paid, we&apos;ll set up a Stripe subscription in a single call.
        </p>
      </div>

      <Card className="overflow-hidden rounded-[28px] border-border/60 bg-[linear-gradient(135deg,rgba(41,37,36,0.98),rgba(87,83,78,0.96))] text-white">
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium">
              <Sparkles className="size-3" aria-hidden />
              Founder preview · no charge
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight">
              {location?.business?.name ?? "Your business"}
            </h2>
            <p className="mt-1 text-sm text-white/70">
              {locationsCount} location{locationsCount === 1 ? "" : "s"} — when you switch to paid we&apos;ll recommend the <b>{PLAN_PRICES[inferred]}/mo {titleCase(inferred)}</b> plan.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="mailto:billing@stockpilot.app?subject=Switch%20to%20paid"
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-stone-900 hover:bg-white/90"
            >
              <CreditCard className="size-4" aria-hidden /> Set up billing
            </Link>
            <Link
              href="mailto:hello@stockpilot.app"
              className="inline-flex items-center gap-2 rounded-full border border-white/25 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
            >
              <Mail className="size-4" aria-hidden /> Ask a question
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {(Object.keys(PLAN_PRICES) as PlanKey[]).map((key) => {
          const isRecommended = key === inferred;
          return (
            <Card
              key={key}
              className={
                "relative rounded-[28px] " +
                (isRecommended
                  ? "border-foreground shadow-xl shadow-foreground/5"
                  : "border-border/60")
              }
            >
              <CardContent className="flex h-full flex-col p-6">
                {isRecommended ? (
                  <div className="absolute -top-3 left-6 rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background">
                    Recommended for you
                  </div>
                ) : null}
                <p className="text-lg font-semibold">{titleCase(key)}</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-semibold tracking-tight">
                    {PLAN_PRICES[key]}
                  </span>
                  <span className="text-sm text-muted-foreground">/mo</span>
                </div>
                <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                  {PLAN_FEATURES[key].map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="mt-[2px] size-4 shrink-0 text-emerald-600" aria-hidden />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-6">
                  <Link
                    href={`mailto:billing@stockpilot.app?subject=Move%20to%20${key}`}
                    className={
                      "inline-flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-medium transition " +
                      (isRecommended
                        ? "bg-foreground text-background hover:bg-foreground/90"
                        : "border border-border bg-card hover:bg-card/80")
                    }
                  >
                    Choose {titleCase(key)}
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="rounded-[28px] border-border/60 bg-card/70">
        <CardContent className="space-y-2 p-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">What happens when we turn billing on</p>
          <p>
            We&apos;ll send a Stripe Checkout link for the plan we recommend. You enter a card, StockPilot starts billing monthly, and you can cancel any time from this page. No contracts. If StockPilot hasn&apos;t paid for itself in your first paid month, email{" "}
            <a className="underline" href="mailto:billing@stockpilot.app">
              billing@stockpilot.app
            </a>{" "}
            and we&apos;ll refund you in full.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function titleCase(s: string) {
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}
