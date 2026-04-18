import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { PageHero } from "@/components/app/page-hero";

export const dynamic = "force-static";

const DOCS = [
  {
    href: "/docs/pos-quickstart",
    title: "Connect any POS in 4 steps",
    description:
      "Step-by-step Zapier walkthrough: trigger, webhook, URL + Bearer, first test. Works for Toast, Clover, Lightspeed, Shopify POS, and any other POS Zapier supports.",
  },
  {
    href: "/docs/google-verification",
    title: "Submitting StockPilot for Google OAuth verification",
    description:
      "Internal runbook for publishing the OAuth consent screen to Production and submitting for Google verification. Removes the 'unverified app' warning for new Gmail connections.",
  },
] as const;

export default function DocsIndexPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 pt-14 pb-20">
        <PageHero
          eyebrow="Docs"
          title="How things work"
          subtitle="under the hood."
          description="Short, honest runbooks for the bits that touch the outside world: POS webhooks, OAuth consent, email dispatch, bot pairing."
        />

        <div className="mt-10 grid gap-4">
          {DOCS.map((doc) => (
            <Link
              key={doc.href}
              href={doc.href}
              className="group flex items-start justify-between gap-4 rounded-2xl border border-border/60 bg-card p-6 transition hover:border-border hover:bg-card/80"
            >
              <div className="flex-1">
                <p className="text-lg font-semibold">{doc.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {doc.description}
                </p>
              </div>
              <ArrowRight className="mt-1 size-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
