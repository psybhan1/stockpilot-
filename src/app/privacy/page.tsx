import { MarketingNav, MarketingFooter } from "@/components/marketing/layout";

export const dynamic = "force-static";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-6 pt-14 pb-20">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Privacy
        </p>
        <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Your data, your Gmail, your control.
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Last updated: {new Date().toISOString().slice(0, 10)}
        </p>

        <div className="mt-10 space-y-8 text-[15px] leading-relaxed">
          <Section title="What we collect">
            <p>
              Only what&apos;s needed to run your inventory ops: your business
              name and location(s), the items you choose to track, your par
              levels, suppliers you add, purchase orders you create, POS sales
              you&apos;ve authorised us to ingest, and the Telegram / Gmail
              account identifiers you connect. We do not collect supplier
              contact lists beyond the addresses you choose to email, and we do
              not scrape your Gmail inbox beyond threads StockPilot itself
              started.
            </p>
          </Section>

          <Section title="What we do with it">
            <p>
              We use your data only to operate the product: draft and send
              purchase orders, poll for supplier replies on threads we started,
              compute daily briefs, deduct stock from POS sales, and notify
              the users you&apos;ve paired via Telegram. We never train any
              AI model on your private data, and we never sell, rent, or
              share it with third parties for marketing.
            </p>
          </Section>

          <Section title="Gmail access is narrow">
            <p>
              When you connect Gmail, StockPilot requests the two narrowest
              scopes that do the job:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-6">
              <li>
                <code>gmail.send</code> — to send the purchase-order emails you
                approve, from your own address.
              </li>
              <li>
                <code>gmail.readonly</code> — to poll the specific threads we
                started (by <code>threadId</code>), so we can detect supplier
                replies and surface them to you.
              </li>
            </ul>
            <p className="mt-3">
              We never read any other mail in your inbox. You can revoke access
              at any time from your Google account, or disconnect from Settings
              → Channels → Gmail.
            </p>
          </Section>

          <Section title="Who can see it">
            <p>
              Only users you&apos;ve explicitly added to your location, and a
              small on-call engineering team at StockPilot in the event of a
              support request. All access is logged in our audit trail.
            </p>
          </Section>

          <Section title="Where it lives">
            <p>
              Postgres on Railway (US region by default), encrypted at rest
              and in transit. Backups retained 30 days. You can request a full
              data export or permanent deletion by emailing{" "}
              <a className="underline" href="mailto:privacy@stockpilot.app">
                privacy@stockpilot.app
              </a>
              .
            </p>
          </Section>

          <Section title="Subprocessors">
            <ul className="list-disc space-y-1 pl-6">
              <li>Railway — hosting + Postgres database</li>
              <li>Google (Gmail API) — outbound email on your behalf</li>
              <li>Groq — LLM calls for intent classification (no long-term retention)</li>
              <li>Telegram — bot message delivery</li>
              <li>Square — optional POS integration (your authorisation)</li>
            </ul>
          </Section>

          <Section title="Contact">
            <p>
              Questions, access requests, or concerns?{" "}
              <a className="underline" href="mailto:privacy@stockpilot.app">
                privacy@stockpilot.app
              </a>
              .
            </p>
          </Section>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3 text-muted-foreground">{children}</div>
    </section>
  );
}
