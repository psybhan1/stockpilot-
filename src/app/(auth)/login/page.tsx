import { MessageCircle, Moon, DollarSign } from "lucide-react";

import { GlassFilter } from "@/components/app/glass-filter";
import { InkCanvas } from "@/components/app/ink-canvas";
import { LoginForm } from "@/components/app/login-form";
import { PointerGloss } from "@/components/app/pointer-gloss";

export const dynamic = "force-dynamic";

// Positioning rewritten from "inventory operating system" (generic
// category-speak) to the three concrete promises competitors don't
// ship today. Researched tonight against MarketMan / MarginEdge /
// Restaurant365 — those start at $199-$435/mo, take 3-6 months to
// set up, and stop at "suggestive" ordering. We ship a bot, an
// auto-dispatch, and a free founder tier. Lead with that.
const promises = [
  {
    icon: MessageCircle,
    label: "Text the bot",
    note: "\"we need more milk\" → draft PO in 2 seconds. Works on your phone.",
  },
  {
    icon: Moon,
    label: "Orders while you sleep",
    note: "Set a dollar cap — bot auto-sends small email orders overnight.",
  },
  {
    icon: DollarSign,
    label: "Keep your profit",
    note: "Catch shrinkage + price jumps before they eat your margin.",
  },
];

export default function LoginPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
        <InkCanvas />
      </div>
      <GlassFilter />
      <PointerGloss />

      <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-[1400px] items-center gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[1.1fr_minmax(0,440px)] lg:gap-20 lg:px-10">
        <section className="flex flex-col gap-8">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.28em] text-muted-foreground">
            <span className="mr-2 inline-block h-px w-6 align-middle bg-current opacity-60" />
            Inventory · for cafés that hate spreadsheets
          </p>

          <h1 className="font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2.75rem,8vw,6rem)]">
            Text it.
            <br />
            It orders.
          </h1>

          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
            StockPilot runs on Telegram. Say what you&apos;re low on, it
            drafts the order. Set a dollar cap, it sends them while you
            sleep. Live in 10 minutes — no 6-month implementation.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            {promises.map((p) => (
              <div key={p.label} className="notif-card p-4">
                <p.icon className="size-5" />
                <p className="mt-3 text-sm font-semibold">{p.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{p.note}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="w-full">
          <LoginForm />
        </section>
      </div>
    </main>
  );
}
