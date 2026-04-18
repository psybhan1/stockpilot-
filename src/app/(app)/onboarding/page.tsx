import Link from "next/link";
import { ArrowRight, Check, Circle, Loader2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await requireSession(Role.MANAGER);
  const [gmailChannel, telegramUser, suppliersCount, itemsCount, poCount] =
    await Promise.all([
      db.locationChannel.findFirst({
        where: {
          locationId: session.locationId,
          channel: "EMAIL_GMAIL",
          enabled: true,
        },
        select: { id: true },
      }),
      db.user.findFirst({
        where: { id: session.userId, telegramChatId: { not: null } },
        select: { id: true, telegramChatId: true },
      }),
      db.supplier.count({ where: { locationId: session.locationId } }),
      db.inventoryItem.count({ where: { locationId: session.locationId } }),
      db.purchaseOrder.count({
        where: { locationId: session.locationId },
      }),
    ]);

  const steps = [
    {
      key: "telegram",
      title: "Pair Telegram (the fastest way to use the bot)",
      detail:
        "Talk to the bot in plain English or voice notes. Approve orders from notifications, get morning briefs, mark deliveries — all from your phone. 30-second pair.",
      done: !!telegramUser,
      href: "/settings",
      cta: telegramUser ? "Paired" : "Pair your Telegram",
    },
    {
      key: "items",
      title: "Tune your inventory",
      detail:
        "We pre-loaded a typical café starter kit (milk, oat milk, beans, cups…). Adjust quantities and par levels, delete anything you don't carry, or paste a full list via Bulk CSV import.",
      done: itemsCount >= 5,
      href: "/inventory",
      cta: itemsCount > 0 ? `${itemsCount} items` : "Add items",
    },
    {
      key: "suppliers",
      title: "Add at least one supplier",
      detail:
        "Who you order from. Name + email is enough to get started; ordering mode is email by default, and the bot can tap-to-open an email on your phone with the order pre-filled — no Gmail connection required.",
      done: suppliersCount > 0,
      href: "/suppliers",
      cta: suppliersCount > 0 ? `${suppliersCount} added` : "Add a supplier",
    },
    {
      key: "gmail",
      title: "(Optional) Auto-send via Gmail",
      detail:
        "By default, the bot hands you a tap-to-send email button in Telegram. If you'd rather have StockPilot send orders automatically so you don't have to tap, connect your Gmail from Settings — takes one click.",
      done: !!gmailChannel,
      href: "/settings",
      cta: gmailChannel ? "Connected" : "Skip or connect",
    },
    {
      key: "firstOrder",
      title: "Send your first order",
      detail:
        "Tell the Telegram bot \u201Cwe need milk\u201D or flag a low-stock item from the app. You'll get a one-tap approve button, then an email-send button. That's the whole loop.",
      done: poCount > 0,
      href: "/purchase-orders",
      cta: poCount > 0 ? `${poCount} sent` : "Go to orders",
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  const pct = Math.round((completed / total) * 100);
  const allDone = completed === total;

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden rounded-[28px] border-border/60 bg-[linear-gradient(135deg,rgba(41,37,36,0.98),rgba(87,83,78,0.96))] text-white shadow-2xl shadow-black/10">
        <CardContent className="space-y-5 p-6 sm:p-8">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/60">
              Getting started
            </p>
            <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              {allDone
                ? "You're fully set up. Nice work."
                : `${completed} of ${total} steps done.`}
            </h1>
            <p className="mt-2 max-w-xl text-white/70">
              {allDone
                ? "StockPilot is watching your stock, handing you one-tap order emails on Telegram, and auto-classifying supplier replies. You can close the tab — your phone will buzz when there's a decision to make."
                : "Finish these steps and StockPilot starts running your inventory in the background. Item list is already pre-seeded — you can tune it from step 2."}
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs text-white/60">
              <span>Progress</span>
              <span className="font-mono tabular-nums">{pct}%</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-white"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {steps.map((s, idx) => (
          <Card
            key={s.key}
            className={
              "rounded-3xl border-border/60 " +
              (s.done ? "bg-card/70" : "bg-card")
            }
          >
            <CardContent className="flex items-start gap-4 p-5">
              <div
                className={
                  "mt-0.5 grid size-10 shrink-0 place-items-center rounded-2xl border " +
                  (s.done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-border bg-muted text-muted-foreground")
                }
              >
                {s.done ? <Check className="size-5" /> : <Circle className="size-5" />}
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    0{idx + 1}
                  </span>
                  <p className="text-lg font-semibold">{s.title}</p>
                  {s.done ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      <Check className="size-3" /> Done
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  {s.detail}
                </p>
              </div>
              <Link
                href={s.href}
                className={
                  "shrink-0 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition " +
                  (s.done
                    ? "border border-border bg-card text-muted-foreground"
                    : "bg-foreground text-background hover:bg-foreground/90")
                }
              >
                {s.cta}
                {!s.done ? <ArrowRight className="size-4" /> : null}
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      {!allDone ? (
        <Card className="rounded-[28px] border-border/60 bg-card/70">
          <CardContent className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            <span>
              Stuck? Email{" "}
              <a className="underline" href="mailto:hello@stockpilot.app">
                hello@stockpilot.app
              </a>{" "}
              and we&apos;ll jump on a 15-minute call to finish setup with you.
            </span>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
