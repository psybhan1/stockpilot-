import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy policy — StockPilot browser extension",
  description:
    "What the StockPilot extension reads, what it sends, and what we do with it. Plain English.",
};

export const dynamic = "force-static";

/**
 * Public privacy policy for the StockPilot browser extension.
 * Required by every extension store (Chrome Web Store, Microsoft
 * Edge Add-ons, Mozilla AMO). Kept plain-English on purpose — the
 * reader is a restaurant manager, not a lawyer.
 *
 * The substantive claims here need to STAY TRUE as the extension
 * evolves. If a future version of the extension starts reading
 * browsing history or installs a background script, this page is
 * the first thing that must be updated.
 */
export default function ExtensionPrivacyPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12 text-sm leading-relaxed">
      <header className="border-b border-border/60 pb-4">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Extension policy
        </p>
        <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight">
          Privacy policy — StockPilot browser extension
        </h1>
        <p className="mt-2 text-muted-foreground">
          Last updated: April 2026. This page describes what the
          StockPilot browser extension does with data while you use it.
        </p>
      </header>

      <Section title="What the extension is">
        <p>
          The StockPilot extension is a single-purpose tool for
          restaurant managers: it captures your already-signed-in
          supplier website session (e.g. amazon.com, costco.com, lcbo
          .com) so StockPilot's ordering bot can add items to your
          real cart on your behalf. The extension never types
          passwords, never reads pages you didn't ask it to, and never
          runs in the background.
        </p>
      </Section>

      <Section title="What the extension reads">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Your current tab's URL</strong>, so the popup can
            auto-select the matching supplier in your StockPilot
            account.
          </li>
          <li>
            <strong>Cookies for the tab's domain</strong>, but ONLY
            at the moment you click "Push cookies to StockPilot" in
            the extension popup. We do not poll, we do not have a
            background script, and we do not read cookies from any
            other tab or domain.
          </li>
          <li>
            <strong>The StockPilot URL you entered on first run</strong>,
            stored in <code>chrome.storage.local</code> so the popup
            knows which server to talk to next time.
          </li>
        </ul>
        <p>
          The extension does NOT read: your browsing history, other
          open tabs, page content (DOM text), form values you type,
          bookmarks, or downloads.
        </p>
      </Section>

      <Section title="What the extension sends">
        <p>One HTTPS POST per click of "Push cookies to StockPilot":</p>
        <pre className="overflow-x-auto rounded-lg border border-border/60 bg-muted/40 p-3 text-xs">
{`POST https://<your StockPilot URL>/api/suppliers/<id>/credentials/from-extension
Cookie: stockpilot_extension_session=<hashed session token>
Content-Type: application/json

{
  "cookies": [
    { "name": "session-id", "value": "...", "domain": ".amazon.com", ... },
    ...
  ]
}`}
        </pre>
        <p>
          The payload goes to the StockPilot server you entered on
          first run (your own deployment; we don't operate a public
          SaaS). The extension does not contact any third-party
          analytics, telemetry, or tracking service.
        </p>
      </Section>

      <Section title="What the server does with the cookies">
        <p>
          Cookies are encrypted with AES-256-GCM the moment the
          server receives them, using a key derived from the server's
          <code> SESSION_SECRET</code> env var. They live encrypted
          on the <code>Supplier.websiteCredentials</code> column of
          the StockPilot database and are only decrypted inside the
          browser-agent worker process at the moment a purchase
          order is dispatched. They are never logged, never emailed,
          and never shown back to the user in plaintext.
        </p>
      </Section>

      <Section title="How to revoke access">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Uninstall the extension</strong> via
            <code> chrome://extensions</code> → Remove. This wipes
            the stored StockPilot URL and the extension's session
            link immediately.
          </li>
          <li>
            <strong>Clear saved cookies from your supplier</strong>
            in StockPilot: open the supplier's settings page and
            tap "Disconnect stored login". The encrypted blob is
            deleted from the database in the same request.
          </li>
          <li>
            <strong>Sign out of StockPilot</strong>: signing out via
            the normal StockPilot web UI also revokes the extension
            session (see <code>destroySession</code> in the code).
          </li>
        </ul>
      </Section>

      <Section title="What's open-source">
        <p>
          The extension source is in the{" "}
          <code>browser-extension/</code> directory of the StockPilot
          repo. Roughly 500 lines of JavaScript with no minified or
          obfuscated code. Read it, audit it, modify it for your own
          install — this page is a description of the shipped
          extension's behavior, which you can verify directly.
        </p>
      </Section>

      <Section title="Data we don't collect">
        <ul className="list-disc space-y-2 pl-6">
          <li>No browsing history</li>
          <li>No keystrokes, form values, or passwords</li>
          <li>No location, IP, or device fingerprints from the extension</li>
          <li>No analytics, no telemetry, no error reporting to third parties</li>
          <li>No advertising identifiers</li>
        </ul>
      </Section>

      <Section title="Contact">
        <p>
          Questions about this policy, or a specific data request,
          go to your StockPilot account manager. If you self-host
          StockPilot, your privacy policy supersedes this one — this
          document describes the extension's behavior, not the data
          handling of the server it talks to, which is determined by
          whoever operates your deployment.
        </p>
      </Section>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="space-y-3 text-muted-foreground">{children}</div>
    </section>
  );
}
