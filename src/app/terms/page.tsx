import { MarketingNav, MarketingFooter } from "@/components/marketing/layout";

export const dynamic = "force-static";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-6 pt-14 pb-20">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Terms of service
        </p>
        <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Fair, short, and written by a human.
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Last updated: {new Date().toISOString().slice(0, 10)}
        </p>

        <div className="mt-10 space-y-8 text-[15px] leading-relaxed">
          <Section title="What you&apos;re agreeing to">
            <p>
              You can use StockPilot to run inventory operations for your café,
              bakery, or small kitchen. You&apos;re responsible for what you
              and your team do with it — approving orders, confirming
              deliveries, updating stock counts. StockPilot is a tool; the
              business decisions remain yours.
            </p>
          </Section>

          <Section title="Billing">
            <p>
              Monthly subscription, charged in advance. No contracts, no
              minimums. You can cancel at any time and keep access through the
              end of the current billing period. The 14-day free trial doesn&apos;t
              require a credit card. If StockPilot doesn&apos;t pay for itself
              in your first paid month, email us and we&apos;ll refund you in
              full, no questions.
            </p>
          </Section>

          <Section title="What we won&apos;t do">
            <ul className="list-disc space-y-1 pl-6">
              <li>Send emails from our own domain using your account. It&apos;s always from your Gmail.</li>
              <li>Share your supplier list, sales data, or recipes with anyone outside your org.</li>
              <li>Train AI models on your private data.</li>
              <li>Surprise-bill you. Pricing is flat and public.</li>
            </ul>
          </Section>

          <Section title="What we need you not to do">
            <ul className="list-disc space-y-1 pl-6">
              <li>Resell or sublicense StockPilot to third parties.</li>
              <li>Use it to send deceptive communications or spam suppliers.</li>
              <li>Reverse engineer, scrape, or attempt to break the platform.</li>
            </ul>
          </Section>

          <Section title="Uptime + support">
            <p>
              We target 99.9% monthly uptime on the Solo and Growth plans and
              document any outages in a monthly report. Pro plans get a named
              point of contact and a response SLA described in your order form.
              Email <a className="underline" href="mailto:support@stockpilot.app">support@stockpilot.app</a> and we&apos;ll answer fast.
            </p>
          </Section>

          <Section title="Limitation of liability">
            <p>
              StockPilot is provided on an "as is" basis. We do our best but
              can&apos;t be liable for losses caused by supplier delays,
              miscounted stock, or POS outages outside of our control. Our
              aggregate liability is capped at the fees you paid us in the
              previous 12 months.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions? <a className="underline" href="mailto:hello@stockpilot.app">hello@stockpilot.app</a>.
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
      <h2 className="text-xl font-semibold" dangerouslySetInnerHTML={{ __html: title }} />
      <div className="mt-3 text-muted-foreground">{children}</div>
    </section>
  );
}
