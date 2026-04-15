/**
 * Public marketing landing page. If the visitor already has a
 * session cookie we redirect them to their dashboard; otherwise
 * we render the long-form sales page below.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { getDefaultRouteForRole } from "@/lib/permissions";
import { getSession } from "@/modules/auth/session";
import {
  MarketingNav,
  MarketingFooter,
} from "@/components/marketing/layout";
import { MarketingCta } from "@/components/marketing/cta";
import { TelegramPreview } from "@/components/marketing/telegram-preview";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  if (session) {
    redirect(getDefaultRouteForRole(session.role));
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-6 pt-14 pb-16 sm:pt-24 sm:pb-24 lg:pt-28 lg:pb-28">
          <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                For cafés, bakeries, and small kitchens
              </div>
              <h1 className="mt-6 text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
                Your inventory,
                <br />
                <span className="italic text-muted-foreground">running itself.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg text-muted-foreground sm:text-xl">
                StockPilot drafts reorders, emails your suppliers like a real person would, handles their replies, and tells you exactly what to order each morning — so you can focus on the drink, not the spreadsheet.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <MarketingCta href="/login" label="Start 14-day trial" primary />
                <MarketingCta href="/api/demo/start" label="Try the live demo" />
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                No credit card. One-click demo with sample data, or connect your own Gmail + Telegram in 10 minutes.
              </p>
            </div>

            <div className="relative">
              <TelegramPreview />
            </div>
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="border-y border-border/60 bg-card/40">
        <div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
            The 8am Saturday problem
          </p>
          <h2 className="mt-4 text-balance text-3xl font-semibold sm:text-4xl">
            Running a café means five jobs at once. Inventory shouldn&apos;t be one of them.
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                title: "Surprise stock-outs",
                body:
                  "You realise at 7:45am you're almost out of oat milk. There's no time to figure out who to call.",
              },
              {
                title: "Endless supplier back-and-forth",
                body:
                  "Forgot to confirm delivery? Supplier out of stock? Now it's three emails and a phone call before opening.",
              },
              {
                title: "Spreadsheets that drift",
                body:
                  "Manual counts, POS mismatches, half-written orders. The numbers stop matching reality within a week.",
              },
            ].map((p) => (
              <div
                key={p.title}
                className="rounded-3xl border border-border/60 bg-card p-5 shadow-sm"
              >
                <p className="font-semibold">{p.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          How it works
        </p>
        <h2 className="mt-3 text-balance text-3xl font-semibold sm:text-4xl">
          Four steps to an inventory system that stops needing you.
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            {
              step: "01",
              title: "Connect your stack",
              body:
                "Sign in with Google to enable free Gmail sending. Pair your Telegram. Connect Square.",
            },
            {
              step: "02",
              title: "Set par levels once",
              body:
                "Tell StockPilot the minimum you want on hand for each item and who supplies it. ~20 minutes.",
            },
            {
              step: "03",
              title: "Talk in plain English",
              body:
                "\u201C12 oz ground coffee, only 2 bags left.\u201D The bot drafts a PO and waits for your one-tap approval.",
            },
            {
              step: "04",
              title: "Get out of the way",
              body:
                "Approved orders email the supplier from your own inbox. Replies get classified. You only see exceptions.",
            },
          ].map((s) => (
            <div
              key={s.step}
              className="rounded-3xl border border-border/60 bg-card p-6"
            >
              <div className="font-mono text-sm text-muted-foreground">{s.step}</div>
              <p className="mt-3 text-lg font-semibold">{s.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES GRID */}
      <section className="border-y border-border/60 bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
            What you get
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold sm:text-4xl">
            Nine features that turn inventory into a background task.
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-3xl border border-border/60 bg-card p-5"
              >
                <div className="text-2xl" aria-hidden>
                  {f.emoji}
                </div>
                <p className="mt-2 font-semibold">{f.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Pricing
        </p>
        <h2 className="mt-3 text-balance text-3xl font-semibold sm:text-4xl">
          Flat monthly. Pays for itself the first time you avoid a stock-out.
        </h2>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {pricingTiers.map((t) => (
            <div
              key={t.name}
              className={
                "relative flex flex-col rounded-3xl border bg-card p-6 " +
                (t.highlight
                  ? "border-foreground shadow-xl shadow-foreground/5"
                  : "border-border/60")
              }
            >
              {t.highlight ? (
                <div className="absolute -top-3 left-6 rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background">
                  Most popular
                </div>
              ) : null}
              <p className="text-lg font-semibold">{t.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t.tagline}</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight">{t.price}</span>
                <span className="text-sm text-muted-foreground">/month</span>
              </div>
              <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                {t.features.map((line) => (
                  <li key={line} className="flex gap-2">
                    <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-6">
                <Link
                  href="/login"
                  className={
                    "inline-flex w-full items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium transition " +
                    (t.highlight
                      ? "bg-foreground text-background hover:bg-foreground/90"
                      : "border border-border bg-card hover:bg-card/80")
                  }
                >
                  {t.cta}
                </Link>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          14-day free trial on every plan. Cancel any time. Running 10+ locations?{" "}
          <Link className="underline" href="mailto:hello@stockpilot.app">
            Talk to us
          </Link>
          .
        </p>
      </section>

      {/* TESTIMONIALS */}
      <section className="border-y border-border/60 bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
            What operators say
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {testimonials.map((t) => (
              <figure
                key={t.name}
                className="flex flex-col rounded-3xl border border-border/60 bg-card p-6"
              >
                <blockquote className="text-base leading-relaxed">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <figcaption className="mt-6 text-sm">
                  <span className="font-semibold">{t.name}</span>
                  <span className="text-muted-foreground"> · {t.role}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-4xl px-6 py-20 sm:py-24">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Frequently asked
        </p>
        <h2 className="mt-3 text-balance text-3xl font-semibold sm:text-4xl">
          Answers to the things people ask us most.
        </h2>
        <div className="mt-10 divide-y divide-border/60 rounded-3xl border border-border/60 bg-card">
          {faqs.map((f) => (
            <details key={f.q} className="group px-6 py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between">
                <span className="text-base font-medium">{f.q}</span>
                <span className="text-muted-foreground transition-transform group-open:rotate-45">
                  ＋
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* BIG CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="rounded-[32px] border border-border/60 bg-[linear-gradient(135deg,rgba(41,37,36,0.98),rgba(87,83,78,0.96))] p-10 text-white sm:p-14">
          <h2 className="text-balance text-3xl font-semibold leading-tight sm:text-4xl">
            Get your mornings back.
          </h2>
          <p className="mt-3 max-w-xl text-white/70">
            Try StockPilot free for 14 days. If it doesn&apos;t pay for itself the first month, don&apos;t pay us a cent.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-stone-900 hover:bg-white/90"
            >
              Start free trial
            </Link>
            <Link
              href="mailto:hello@stockpilot.app"
              className="inline-flex items-center justify-center rounded-full border border-white/25 bg-transparent px-5 py-3 text-sm font-semibold text-white hover:bg-white/10"
            >
              Book a demo
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

const features = [
  {
    emoji: "💬",
    title: "Telegram bot that actually reasons",
    body: "Not a keyword parser. It fuzzy-matches items, honours your quantities and units, and refuses to lie.",
  },
  {
    emoji: "📧",
    title: "Emails from your Gmail — free",
    body: "Each location connects their own Gmail once. Suppliers see a normal, human email from your real address.",
  },
  {
    emoji: "🧠",
    title: "Forecast-aware morning brief",
    body: "Every 8am: what to order today, what to watch, what's on the way. Runway from real consumption.",
  },
  {
    emoji: "↻",
    title: "Auto-rescue on OUT_OF_STOCK",
    body: "Supplier can't fulfil? One tap on your phone and the order goes to your backup — quantities and all.",
  },
  {
    emoji: "📥",
    title: "Supplier reply tracking",
    body: "Every reply is pulled, classified, and pinged to you. The conversation stays attached to the PO.",
  },
  {
    emoji: "🍳",
    title: "Recipe-aware depletion",
    body: "Map POS items to recipes once. Every sale deducts the real ingredients, not just the SKU.",
  },
  {
    emoji: "🔒",
    title: "Your data, your Gmail, your control",
    body: "We never hold supplier addresses or send from our domain. Disconnect any time, your records stay.",
  },
  {
    emoji: "📱",
    title: "Phone-first operations",
    body: "Approve, cancel, ask — all from Telegram. No logging into a dashboard at 7am.",
  },
  {
    emoji: "💳",
    title: "One flat price",
    body: "Per-location flat fee. No per-SKU gouging, no per-user seats. Predictable as your espresso machine.",
  },
];

const pricingTiers = [
  {
    name: "Solo",
    tagline: "For a single café or bakery.",
    price: "$39",
    features: [
      "1 location, unlimited items & suppliers",
      "Telegram + WhatsApp bot",
      "Gmail email sending",
      "Morning brief + supplier reply polling",
      "Email + chat support",
    ],
    cta: "Start free trial",
    highlight: false,
  },
  {
    name: "Growth",
    tagline: "For multi-café operators.",
    price: "$99",
    features: [
      "Up to 5 locations, shared suppliers",
      "OUT_OF_STOCK auto-rescue",
      "POS integration (Square)",
      "Recipe-aware stock depletion",
      "Priority support, 1 onboarding call",
    ],
    cta: "Start free trial",
    highlight: true,
  },
  {
    name: "Pro",
    tagline: "Groups of 5+ and franchise networks.",
    price: "$249",
    features: [
      "Unlimited locations",
      "Supplier reliability scorecards",
      "Weekly exec digest + custom reports",
      "Multi-user roles, audit log exports",
      "Slack channel + named CSM",
    ],
    cta: "Talk to sales",
    highlight: false,
  },
];

const testimonials = [
  {
    quote:
      "I used to open 20 browser tabs every Sunday to plan the week. Now Telegram tells me what to order and I say yes. My mornings are back.",
    name: "Mia",
    role: "Owner, Northside Coffee",
  },
  {
    quote:
      "The auto-rescue on out-of-stock is the thing that sold me. First inventory tool that actually does something when things go wrong.",
    name: "Diego",
    role: "GM, Calle Café (3 locations)",
  },
  {
    quote:
      "Suppliers have no idea we're using software. Emails come from my Gmail, they reply to me, and StockPilot handles the rest in the background.",
    name: "Priya",
    role: "Co-founder, Loaf & Ledger",
  },
];

const faqs = [
  {
    q: "How long does setup take?",
    a: "Most cafés are fully operational in 30–45 minutes. Gmail and Telegram are a few clicks each. Importing your item list and par levels is the only time-consuming step, and we'll do it with you on the onboarding call if you're on Growth or Pro.",
  },
  {
    q: "Do my suppliers need to install anything?",
    a: "No. Emails go from your real Gmail to their normal inbox. They reply like they always do. StockPilot reads the reply in the background, classifies the intent, and pings you. The supplier never sees StockPilot.",
  },
  {
    q: "What POS systems do you support?",
    a: "Square is live today. Toast, Clover, Lightspeed, and generic webhook connectors are on the roadmap. If you have a system you'd like us to prioritise, reply to the trial email and we'll consider it.",
  },
  {
    q: "How does the AI work? Will it hallucinate my orders?",
    a: "The bot uses an LLM to understand what you typed, but every number and item name it outputs is grounded in your actual inventory — it can't invent items or units. Every action you approve goes through a deterministic code path.",
  },
  {
    q: "Is my data private?",
    a: "Yes. Your supplier contacts, recipes, and sales data live in your own tenant. Gmail OAuth tokens are scoped only to sending and reading threads we started. We never send from our domain, never share data between customers, and you can export or delete everything at any time.",
  },
  {
    q: "Can I cancel any time?",
    a: "Yes. No contracts, no annual commitments. Billed monthly, cancel with one click, data export on request. If StockPilot doesn't pay for itself in the first month we'll refund you in full.",
  },
];
