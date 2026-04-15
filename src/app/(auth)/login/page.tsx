import { BellRing, ClipboardCheck, ShoppingBasket } from "lucide-react";

import { GlassFilter } from "@/components/app/glass-filter";
import { InkCanvas } from "@/components/app/ink-canvas";
import { LoginForm } from "@/components/app/login-form";
import { PointerGloss } from "@/components/app/pointer-gloss";

export const dynamic = "force-dynamic";

const features = [
  {
    icon: BellRing,
    label: "Alerts",
    note: "Low stock, missing counts, sync issues — surfaced before the rush.",
  },
  {
    icon: ClipboardCheck,
    label: "Count",
    note: "Confirm uncertain items with swipe or table mode in seconds.",
  },
  {
    icon: ShoppingBasket,
    label: "Orders",
    note: "AI-drafted restocks wait for your approval before anything ships.",
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
            Inventory operating system
          </p>

          <h1 className="font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2.75rem,8vw,6rem)]">
            Stock,
            <br />
            handled.
          </h1>

          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
            StockPilot watches your inventory, drafts reorders, counts what
            matters, and only acts when you say so. Sign in with a demo role
            to take a look.
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
          <LoginForm />
        </section>
      </div>
    </main>
  );
}
