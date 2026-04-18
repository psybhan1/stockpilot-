import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { PageHero } from "@/components/app/page-hero";
import { CopyButton } from "@/components/ui/copy-button";
import { Role } from "@/lib/domain-enums";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

/**
 * POS quickstart — in-app walkthrough of the Zapier bridge for
 * every non-Square POS. Loads the admin's own webhook secret for
 * whichever POS they've clicked Connect on so the copy-buttons
 * paste the real values, not placeholders. If no integration yet,
 * shows the generic payload shape + a CTA back to Settings.
 */
export default async function PosQuickstartPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string }>;
}) {
  const session = await requireSession(Role.MANAGER);
  const params = await searchParams;
  const wantedProvider = (params.provider ?? "").toUpperCase();

  const integrations = await db.posIntegration.findMany({
    where: {
      locationId: session.locationId,
      status: "CONNECTED",
      provider: {
        notIn: ["SQUARE", "MANUAL"],
      },
    },
    select: { id: true, provider: true, settings: true },
  });

  const focused =
    integrations.find((i) => i.provider === wantedProvider) ??
    integrations[0] ??
    null;

  const secret =
    focused?.settings && typeof focused.settings === "object"
      ? ((focused.settings as Record<string, unknown>).webhookSecret as
          | string
          | undefined)
      : undefined;
  const webhookUrl = `${env.APP_URL?.replace(/\/$/, "") ?? ""}/api/pos/webhook`;

  const samplePayload = {
    externalOrderId: "zap-order-1",
    occurredAt: new Date().toISOString(),
    lineItems: [
      {
        externalProductId: "latte_16oz",
        externalProductName: "Large Latte",
        quantity: 1,
      },
    ],
  };

  return (
    <div className="space-y-10">
      <PageHero
        eyebrow="Docs"
        title="Connect any POS in 4 steps"
        subtitle="via Zapier."
        description={
          focused
            ? `You've already minted a webhook secret for ${focused.provider}. The copy buttons below use it directly — paste them into Zapier and you're done.`
            : "Pick your POS on Settings first to mint a webhook secret, then follow these steps."
        }
      />

      {!focused ? (
        <Link
          href="/settings"
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
        >
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-200">
              Mint a webhook secret first
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              On Settings, open the &ldquo;Other POS&rdquo; disclosure and
              click Connect next to your vendor. Come back here and the URL
              + header below will be pre-filled.
            </p>
          </div>
          <ArrowRight className="size-4" />
        </Link>
      ) : null}

      {/* Step 1 */}
      <section className="rounded-2xl border border-border/60 bg-card p-6">
        <div className="flex items-start gap-4">
          <StepBadge n={1} />
          <div className="flex-1 space-y-3">
            <h2 className="text-lg font-semibold">
              Pick your POS as the Zapier trigger
            </h2>
            <p className="text-sm text-muted-foreground">
              Open Zapier and click{" "}
              <span className="font-medium text-foreground">+ Create Zap</span>.
              For <em>Trigger</em>, pick your POS and its &ldquo;New Order&rdquo;
              (or equivalent) event. Zapier walks you through signing into
              the POS — that part already works; they've done the hard
              vendor-side integration for us.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
              {[
                { name: "Toast", url: "https://zapier.com/apps/toast/integrations/webhook" },
                { name: "Clover", url: "https://zapier.com/apps/clover/integrations/webhook" },
                { name: "Lightspeed", url: "https://zapier.com/apps/lightspeed-retail/integrations/webhook" },
                { name: "Shopify POS", url: "https://zapier.com/apps/shopify/integrations/webhook" },
              ].map((p) => (
                <a
                  key={p.name}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-md border border-border/40 bg-background/50 px-3 py-2 hover:bg-muted"
                >
                  {p.name}
                  <span className="text-muted-foreground">↗</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Step 2 */}
      <section className="rounded-2xl border border-border/60 bg-card p-6">
        <div className="flex items-start gap-4">
          <StepBadge n={2} />
          <div className="flex-1 space-y-3">
            <h2 className="text-lg font-semibold">
              Add &ldquo;Webhooks by Zapier — POST&rdquo; as the action
            </h2>
            <p className="text-sm text-muted-foreground">
              In the same Zap, add an Action step. Search for{" "}
              <span className="font-medium text-foreground">
                Webhooks by Zapier
              </span>{" "}
              and pick the <em>POST</em> event. Zapier shows a form with URL,
              payload, and headers fields.
            </p>
          </div>
        </div>
      </section>

      {/* Step 3 */}
      <section className="rounded-2xl border border-border/60 bg-card p-6">
        <div className="flex items-start gap-4">
          <StepBadge n={3} />
          <div className="flex-1 space-y-4">
            <h2 className="text-lg font-semibold">
              Paste StockPilot's URL, payload, and Authorization header
            </h2>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                URL
              </p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-muted/60 px-2 py-1 font-mono text-[11px]">
                  {webhookUrl}
                </code>
                <CopyButton value={webhookUrl} label="URL" />
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Payload type
              </p>
              <code className="mt-1 block rounded bg-muted/60 px-2 py-1 font-mono text-[11px]">
                json
              </code>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Set &ldquo;Payload Type&rdquo; to <code>json</code> (not{" "}
                <code>form</code>) so Zapier sends a real JSON body.
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Headers — add exactly one
              </p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-muted/60 px-2 py-1 font-mono text-[11px]">
                  Authorization: Bearer {secret ?? "<your-webhook-secret>"}
                </code>
                {secret ? (
                  <CopyButton
                    value={`Bearer ${secret}`}
                    label="Header"
                  />
                ) : null}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Data — map your POS fields into this shape
              </p>
              <pre className="mt-1 overflow-x-auto rounded bg-muted/60 p-3 font-mono text-[11px] leading-5">
                {JSON.stringify(samplePayload, null, 2)}
              </pre>
              <p className="mt-2 text-[11px] text-muted-foreground">
                In Zapier's payload editor, drag the POS's order id into{" "}
                <code>externalOrderId</code>, and for each line item drag the
                product id (or SKU) into <code>externalProductId</code>, name
                into <code>externalProductName</code>, and quantity into{" "}
                <code>quantity</code>. Zapier iterates line items
                automatically for POS triggers that return arrays.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Step 4 */}
      <section className="rounded-2xl border border-border/60 bg-card p-6">
        <div className="flex items-start gap-4">
          <StepBadge n={4} />
          <div className="flex-1 space-y-3">
            <h2 className="text-lg font-semibold">
              Test + turn the Zap on
            </h2>
            <p className="text-sm text-muted-foreground">
              Zapier's test sends one real request. You should see an HTTP
              200 response with{" "}
              <code>&#123;&quot;ok&quot;: true,
              &quot;unmapped&quot;:[...]&#125;</code> — the first sale lands in
              StockPilot as an unmapped product. Open{" "}
              <Link href="/pos-mapping" className="underline">
                /pos-mapping
              </Link>{" "}
              and wire each new POS product to an inventory item + qty per
              sale. Future sales auto-deplete and past-unmapped sales for
              that product are backfilled retroactively.
            </p>
            <div className="flex items-center gap-2 text-xs">
              <Check className="size-4 text-emerald-500" />
              Once the Zap is on, the webhook receives every sale with no
              further action needed.
            </div>
          </div>
        </div>
      </section>

      <Link
        href="/settings"
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        ← Back to Settings
      </Link>
    </div>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background text-sm font-bold">
      {n}
    </div>
  );
}
