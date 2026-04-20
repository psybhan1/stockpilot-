import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { CopyButton } from "@/components/ui/copy-button";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Square native OAuth setup runbook.
 *
 * The Square integration code is already complete in the app —
 * catalog sync, webhook verification, sale depletion pipeline,
 * retroactive backfill. What the admin still needs to do is register
 * an OAuth application in Square's developer portal and paste three
 * credentials into Railway. This page is the literal copy-paste
 * checklist for that: direct links, exact strings, correct redirect
 * URIs. Unblocks Square end-to-end in ~5 minutes.
 */

export default function SquareSetupPage() {
  const appUrl = env.APP_URL?.replace(/\/$/, "") ?? "https://your-railway-url";
  const oauthCallback = `${appUrl}/api/integrations/square/callback`;
  const webhookUrl = `${appUrl}/api/integrations/square/webhook`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 pt-14 pb-20 space-y-8">
        <div>
          <p className="text-sm uppercase tracking-[0.22em] text-muted-foreground">
            Docs · Setup
          </p>
          <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight">
            Connect Square in 5 minutes
          </h1>
          <p className="mt-3 text-muted-foreground">
            One-time setup in Square&apos;s developer portal. After this the
            Connect Square button works one-click for your merchant and every
            café you ever onboard to this StockPilot deployment.
          </p>
        </div>

        <Step n={1} title="Open Square's developer portal">
          <p>
            Go to{" "}
            <a
              href="https://developer.squareup.com/apps"
              target="_blank"
              rel="noreferrer"
              className="underline font-medium"
            >
              developer.squareup.com/apps
            </a>{" "}
            and sign in with your Square merchant account. If you don&apos;t
            have one, create a free Square account first (same sign-in works
            for the developer portal).
          </p>
        </Step>

        <Step n={2} title="Click + New Application">
          <p>Top-right corner of the apps list. Use these exact values:</p>
          <FieldRow label="Application name" value="StockPilot" />
          <FieldRow
            label="Description"
            value="Inventory management for cafés — auto-depletes stock on every Square sale, drafts supplier POs, forecasts runouts."
          />
          <p className="text-xs text-muted-foreground">
            Pick <em>Production</em> (not Sandbox) if you want to connect real
            merchants. You can also create a Sandbox app first to test — the
            app works with both; just keep the two sets of credentials
            separate.
          </p>
        </Step>

        <Step n={3} title="Configure OAuth redirect">
          <p>
            Open the app. Left nav → <strong>OAuth</strong>. Paste into the
            Redirect URL field:
          </p>
          <CopyRow value={oauthCallback} label="Redirect URL" />
          <p className="text-xs text-muted-foreground">
            Click Save. Leave the OAuth Production/Sandbox toggle matching the
            app type you picked in step 2.
          </p>
        </Step>

        <Step n={4} title="Copy Application ID + Secret">
          <p>
            Same OAuth screen. You&apos;ll see two values near the top —{" "}
            <strong>Application ID</strong> and <strong>Application Secret</strong>
            . They&apos;re what Square calls &ldquo;Client ID&rdquo; and
            &ldquo;Client Secret&rdquo; in OAuth terms. Reveal the secret,
            copy both. You&apos;ll paste them into Railway in step 6.
          </p>
        </Step>

        <Step n={5} title="Create a webhook subscription">
          <p>
            Left nav → <strong>Webhooks</strong> → <strong>Subscriptions</strong>
            . Click <strong>Add subscription</strong>. Use:
          </p>
          <FieldRow label="Name" value="StockPilot sales + catalog" />
          <CopyRow value={webhookUrl} label="Notification URL" />
          <p>
            Under <strong>Event types</strong> check these six:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs font-mono">
            <li>order.created</li>
            <li>order.updated</li>
            <li>payment.updated</li>
            <li>catalog.version.updated</li>
            <li>item.updated</li>
            <li>category.updated</li>
          </ul>
          <p>
            Save. Square will show a <strong>Signature key</strong> on the
            subscription detail page — reveal and copy it. That goes into
            Railway in step 6 as <code>SQUARE_WEBHOOK_SIGNATURE_KEY</code>.
          </p>
        </Step>

        <Step n={6} title="Paste all three into Railway">
          <p>
            Open your StockPilot service on{" "}
            <a
              href="https://railway.com"
              target="_blank"
              rel="noreferrer"
              className="underline font-medium"
            >
              Railway
            </a>{" "}
            → <strong>Variables</strong> tab → <strong>+ New Variable</strong>{" "}
            three times:
          </p>
          <ul className="space-y-2 text-sm">
            <li className="flex flex-wrap items-center gap-2">
              <CopyButton value="SQUARE_CLIENT_ID" label="Copy name" />
              <code className="font-mono text-xs">SQUARE_CLIENT_ID</code>
              <span className="text-muted-foreground">=</span>
              <span className="text-xs">paste the Application ID</span>
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <CopyButton value="SQUARE_CLIENT_SECRET" label="Copy name" />
              <code className="font-mono text-xs">SQUARE_CLIENT_SECRET</code>
              <span className="text-muted-foreground">=</span>
              <span className="text-xs">paste the Application Secret</span>
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <CopyButton
                value="SQUARE_WEBHOOK_SIGNATURE_KEY"
                label="Copy name"
              />
              <code className="font-mono text-xs">
                SQUARE_WEBHOOK_SIGNATURE_KEY
              </code>
              <span className="text-muted-foreground">=</span>
              <span className="text-xs">paste the webhook signature key</span>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Railway redeploys automatically — takes ~60 seconds. Optionally
            add <code>SQUARE_ENVIRONMENT=production</code> (defaults to
            sandbox).
          </p>
        </Step>

        <Step n={7} title="Back to StockPilot, click Connect Square">
          <p>
            Reload{" "}
            <Link href="/settings" className="underline font-medium">
              /settings
            </Link>
            . The Square row no longer errors — clicking Connect Square now
            opens Square&apos;s real OAuth screen. Sign in as your merchant,
            grant, return. The row flips to <em>Live · 0 sales this week</em>{" "}
            and the catalog starts syncing in the background.
          </p>
          <div className="flex items-center gap-2 text-xs">
            <Check className="size-4 text-emerald-500" />
            From this point forward, every Square sale depletes inventory in
            real time.
          </div>
        </Step>

        <Link
          href="/settings"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          ← Back to Settings
        </Link>
      </main>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-6">
      <div className="flex items-start gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background text-sm font-bold">
          {n}
        </div>
        <div className="flex-1 space-y-3 text-sm">
          <h2 className="text-lg font-semibold">{title}</h2>
          {children}
        </div>
      </div>
    </section>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded bg-muted/60 px-2 py-1 font-mono text-[11px]">
          {value}
        </code>
        <CopyButton value={value} label="Copy" />
      </div>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded bg-muted/60 px-2 py-1 font-mono text-[11px]">
          {value}
        </code>
        <CopyButton value={value} label="Copy" />
      </div>
    </div>
  );
}
