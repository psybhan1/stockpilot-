import { BellRing, ClipboardCheck, ShoppingBasket } from "lucide-react";

import { LoginForm } from "@/components/app/login-form";

export const dynamic = "force-dynamic";

const valueProps = [
  {
    icon: BellRing,
    title: "See what needs attention",
    description: "Low stock, missing counts, and supplier approvals are all in one place.",
  },
  {
    icon: ClipboardCheck,
    title: "Count items quickly",
    description: "Use the fast swipe flow or a simple list whenever the team needs a spot check.",
  },
  {
    icon: ShoppingBasket,
    title: "Approve orders with confidence",
    description: "Recommendations stay explainable, editable, and approval-first before sending.",
  },
];

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.14),transparent_24%),linear-gradient(180deg,_rgba(250,250,249,1),rgba(255,255,255,1))] px-4 py-6 dark:bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.12),transparent_24%),linear-gradient(180deg,_rgba(12,10,9,1),rgba(24,24,27,1))]">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl items-center gap-10 lg:grid-cols-[minmax(0,1fr)_460px]">
        <section className="space-y-8">
          <div className="space-y-5">
            <p className="text-sm uppercase tracking-[0.28em] text-amber-600 dark:text-amber-300">
              Inventory operating system
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Run cafe inventory with the same kind of clarity you expect from your everyday apps.
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground sm:text-xl">
              See what needs attention, count what looks off, and approve supplier work without
              digging through heavy back-office screens.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {valueProps.map((item) => (
              <div
                key={item.title}
                className="rounded-[28px] border border-border/60 bg-card/85 p-5 shadow-lg shadow-black/5 backdrop-blur"
              >
                <item.icon className="size-5 text-amber-600 dark:text-amber-300" />
                <h2 className="mt-4 text-lg font-semibold">{item.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </div>

          <div className="rounded-[30px] border border-border/60 bg-card/80 p-6 shadow-xl shadow-black/5 backdrop-blur">
            <p className="text-sm font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Typical daily flow
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <WorkflowStep number="01" title="Open Home" description="Check what is urgent first." />
              <WorkflowStep
                number="02"
                title="Count fast"
                description="Use swipe mode or save counts from a simple list."
              />
              <WorkflowStep
                number="03"
                title="Approve orders"
                description="Review the why, adjust quantities, then send."
              />
            </div>
          </div>
        </section>
        <LoginForm />
      </div>
    </main>
  );
}

function WorkflowStep({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[24px] border border-border/60 bg-background/80 p-4">
      <p className="text-sm font-semibold text-amber-600 dark:text-amber-300">{number}</p>
      <h2 className="mt-3 font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
