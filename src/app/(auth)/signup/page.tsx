import { BellRing, ClipboardCheck, ShoppingBasket } from "lucide-react";

import { GlassFilter } from "@/components/app/glass-filter";
import { InkCanvas } from "@/components/app/ink-canvas";
import { SignupForm } from "@/components/app/signup-form";
import { PointerGloss } from "@/components/app/pointer-gloss";

export const dynamic = "force-dynamic";

const features = [
  {
    icon: ShoppingBasket,
    label: "Auto-order",
    note: "Bot drafts restocks, auto-sends email orders under your $ cap.",
  },
  {
    icon: ClipboardCheck,
    label: "One-tap count",
    note: "Swipe through uncertain items in under a minute a day.",
  },
  {
    icon: BellRing,
    label: "Supplier replies",
    note: "Auto-classified, auto-rescued when out-of-stock.",
  },
];

export default function SignupPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
        <InkCanvas />
      </div>
      <GlassFilter />
      <PointerGloss />

      <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-[1400px] items-center gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[1.1fr_minmax(0,460px)] lg:gap-20 lg:px-10">
        <section className="flex flex-col gap-8">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.28em] text-muted-foreground">
            <span className="mr-2 inline-block h-px w-6 align-middle bg-current opacity-60" />
            Get started
          </p>

          <h1 className="font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2.75rem,8vw,6rem)]">
            Set up
            <br />
            your café.
          </h1>

          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
            Free while we&apos;re in founder preview — no credit card. You&apos;ll
            have the bot drafting your first restock in under 10 minutes.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            {features.map((f) => (
              <div key={f.label} className="notif-card p-4">
                <f.icon className="size-5" />
                <p className="mt-3 text-sm font-semibold">{f.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{f.note}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="w-full">
          <SignupForm />
        </section>
      </div>
    </main>
  );
}
