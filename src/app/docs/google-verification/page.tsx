import Link from "next/link";
import { MarketingNav, MarketingFooter } from "@/components/marketing/layout";

export const dynamic = "force-static";

export default function GoogleVerificationDocs() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-6 pt-14 pb-20">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Internal docs · OAuth verification
        </p>
        <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Submitting StockPilot for Google OAuth verification
        </h1>
        <p className="mt-4 max-w-xl text-muted-foreground">
          Until the app is verified, new users see a scary &ldquo;Google hasn&apos;t verified this app&rdquo; screen when they connect Gmail and have to click &ldquo;Advanced &rarr; Go to StockPilot (unsafe)&rdquo;. Verification removes that. One-time form, 1–2 weeks turnaround.
        </p>

        <ol className="mt-10 list-decimal space-y-6 pl-5 text-[15px] leading-relaxed marker:text-muted-foreground">
          <li>
            <strong>Confirm the scopes we request are the narrow two.</strong>{" "}
            Open{" "}
            <Link className="underline" href="https://console.cloud.google.com/apis/credentials/consent" target="_blank">
              console.cloud.google.com/apis/credentials/consent
            </Link>{" "}
            under the project that owns the OAuth client (the one whose ID is in <code>GOOGLE_CLIENT_ID</code>). Under &ldquo;Scopes&rdquo; there should be only:
            <ul className="mt-2 list-disc pl-6 text-muted-foreground">
              <li>
                <code>https://www.googleapis.com/auth/gmail.send</code>
              </li>
              <li>
                <code>https://www.googleapis.com/auth/gmail.readonly</code>
              </li>
              <li>
                <code>https://www.googleapis.com/auth/userinfo.email</code>
              </li>
            </ul>
            If any extra scopes are listed (e.g. <code>mail.google.com/</code> restricted scope), remove them first — restricted scopes require a much harder CASA security assessment.
          </li>
          <li>
            <strong>Fill in the OAuth consent screen app details.</strong>
            <ul className="mt-2 list-disc space-y-1 pl-6 text-muted-foreground">
              <li>App name: <code>StockPilot</code></li>
              <li>User support email: <code>support@stockpilot.app</code></li>
              <li>
                App logo: any clean 120×120 PNG from your design assets (must match the one we use in the marketing site).
              </li>
              <li>
                Authorized domains: <code>stockpilot.app</code> (and the Railway preview domain during testing).
              </li>
              <li>
                App home page: <code>https://stockpilot.app/</code>
              </li>
              <li>
                Privacy policy: <code>https://stockpilot.app/privacy</code> (already live).
              </li>
              <li>
                Terms of service: <code>https://stockpilot.app/terms</code> (already live).
              </li>
              <li>Developer contact: your personal email.</li>
            </ul>
          </li>
          <li>
            <strong>Justify each scope.</strong> Google asks in plain English why you need each scope. Copy-paste these:
            <div className="mt-3 space-y-3 rounded-xl border border-border bg-card p-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  gmail.send
                </p>
                <p className="mt-1 text-sm">
                  StockPilot sends purchase-order emails on behalf of the signed-in café owner to their suppliers. The owner approves each order in the app, and the email is sent from their own Gmail account so the supplier sees a normal, personal email.
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  gmail.readonly
                </p>
                <p className="mt-1 text-sm">
                  After a purchase-order email is sent, StockPilot polls the specific thread IDs it generated to detect supplier replies (confirmed / delayed / out-of-stock). We read only threads that StockPilot itself created; we never scan the user&apos;s inbox broadly.
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  userinfo.email
                </p>
                <p className="mt-1 text-sm">
                  Used once during OAuth to identify which Gmail address the user connected, so we can label it in Settings and sign outbound emails from the correct <code>From:</code> address.
                </p>
              </div>
            </div>
          </li>
          <li>
            <strong>Record a short demo video.</strong> Google requires a 30-second-to-2-minute screen capture showing:
            <ol className="mt-2 list-decimal space-y-1 pl-6 text-muted-foreground">
              <li>The consent screen appearing when a new user clicks &ldquo;Connect Gmail&rdquo;.</li>
              <li>The user granting the scopes.</li>
              <li>An example of the resulting functionality (e.g. an email being sent to a supplier).</li>
            </ol>
            <p className="mt-2 text-muted-foreground">
              Upload to YouTube as <em>Unlisted</em> and paste the URL in the form.
            </p>
          </li>
          <li>
            <strong>Submit for verification.</strong> Click &ldquo;Prepare for verification&rdquo; at the top of the consent screen page. Google typically responds within 5 business days requesting small clarifications, and the full cycle takes 1–2 weeks. The product stays fully functional for existing connected users during review.
          </li>
          <li>
            <strong>Add test users in the meantime.</strong> Before verification completes you can add up to 100 Gmail addresses as &ldquo;Test users&rdquo; in the consent screen — those users will skip the unverified-app warning immediately. Add your first customers here so their onboarding is painless while the form works through review.
          </li>
        </ol>

        <div className="mt-12 rounded-2xl border border-border bg-card p-5">
          <p className="text-sm font-medium">Once verified</p>
          <p className="mt-1 text-sm text-muted-foreground">
            New users clicking &ldquo;Connect Gmail&rdquo; will see a clean consent screen with the StockPilot logo and &ldquo;Continue&rdquo; — no &ldquo;unsafe&rdquo; warning. That&apos;s the single biggest trust improvement available pre-launch. Do it before your first external customer demo.
          </p>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
