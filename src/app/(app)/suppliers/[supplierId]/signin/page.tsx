/**
 * Dedicated sign-in wizard for a supplier's website login. Replaces
 * the "put your password in StockPilot" form on the main supplier
 * settings page — users don't want that.
 *
 * Two paths offered:
 *   1. RECOMMENDED: remote browser. We launch Chrome on our server,
 *      open the supplier's REAL sign-in page, stream it to the
 *      manager's browser. Manager types their password into the
 *      real supplier page (not our form). When login succeeds, we
 *      capture cookies from Chrome's session + encrypt on Supplier
 *      row. Fully client-side-JS-driven; page below.
 *   2. ADVANCED: cookie paste via Cookie-Editor extension. Older
 *      path, works if someone can't use #1 (e.g. if their supplier
 *      uses aggressive anti-automation that blocks puppeteer).
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Role } from "@/lib/domain-enums";
import { db } from "@/lib/db";
import { requireSession } from "@/modules/auth/session";
import { summariseStoredCredentials } from "@/modules/suppliers/website-credentials";

import { SigninWizard } from "./signin-wizard";

export default async function SupplierSigninPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const session = await requireSession(Role.MANAGER);
  const { supplierId } = await params;
  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, locationId: session.locationId },
    select: {
      id: true,
      name: true,
      website: true,
      websiteCredentials: true,
    },
  });
  if (!supplier) notFound();

  const existing = summariseStoredCredentials(supplier.websiteCredentials);
  const hasCredentials = existing.kind !== "none";

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-border/60 bg-[linear-gradient(135deg,rgba(240,249,255,0.94),rgba(255,255,255,0.96))] shadow-xl shadow-black/5 dark:bg-[linear-gradient(135deg,rgba(23,37,84,0.92),rgba(15,23,42,0.94))]">
        <CardContent className="flex flex-col gap-3 p-6">
          <Link
            href={`/suppliers/${supplier.id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Back to {supplier.name}
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Sign in to {supplier.name}
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            We'll open the real {supplier.name} login page on our server, you
            sign in on their actual page, and we capture the session so the
            agent can put items directly into <span className="font-medium text-foreground">your</span> cart from now on.
            You never type your password into a StockPilot form.
          </p>
          <div className="mt-2 inline-flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="size-4" />
            Encrypted with AES-256 at rest. Decrypted only inside the browser-agent process
            at purchase-order dispatch time.
          </div>
        </CardContent>
      </Card>

      {hasCredentials ? (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
          <CardContent className="p-5 text-sm">
            <p className="font-medium">You're already connected.</p>
            <p className="mt-1 text-muted-foreground">
              Saving again will REPLACE your existing session. Only do this if the
              agent has started failing (cookies expire every 14-30 days on most sites).
            </p>
          </CardContent>
        </Card>
      ) : null}

      <SigninWizard
        supplierId={supplier.id}
        supplierName={supplier.name}
        supplierWebsite={supplier.website}
      />
    </div>
  );
}
