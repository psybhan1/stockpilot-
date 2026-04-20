import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { SupplierOrderProvider } from "@/providers/contracts";
import { ConsoleEmailProvider } from "@/providers/email/console-email";
import { GmailEmailProvider } from "@/providers/email/gmail-email";
import { ResendEmailProvider } from "@/providers/email/resend-email";
import {
  getGmailCredentials,
  getResendCredentials,
} from "@/modules/channels/service";

/**
 * Global factory — used when no location context is available (e.g.
 * a generic notification). Prefers Resend if configured; otherwise
 * falls back to the console/mock provider.
 *
 * For supplier PO dispatch, always prefer getSupplierOrderProviderForLocation()
 * — it'll pick up the location's own Gmail first, which is free,
 * scalable, and comes from the business's real address.
 */
export function getSupplierOrderProvider(): SupplierOrderProvider {
  if (env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) {
    return new ResendEmailProvider({
      apiKey: env.RESEND_API_KEY,
      fromEmail: env.RESEND_FROM_EMAIL,
    });
  }

  return new ConsoleEmailProvider();
}

/**
 * Per-location provider. Preference order:
 *   1. Location's connected Gmail (free, uses their own 500/day quota,
 *      supplier sees the owner's own Gmail address). This is OPTIONAL —
 *      new cafés skip it entirely.
 *   2. Resend, if configured globally. The café name is wrapped into
 *      the From header so suppliers still see the right identity
 *      (e.g. "Sunny's Café <orders@stockpilot.app>").
 *   3. Console (test mode — logs only).
 *
 * The Gmail check is a cheap DB read; if no row is found we fall
 * through to the global Resend provider so zero-setup cafés still
 * send real PO emails on day one.
 */
export async function getSupplierOrderProviderForLocation(
  locationId: string
): Promise<SupplierOrderProvider> {
  // 1. Location's connected Gmail (OAuth, supplier sees owner's address)
  const gmail = await getGmailCredentials(locationId);
  if (gmail?.accessToken) {
    return new GmailEmailProvider(locationId);
  }

  // 2. Location-level Resend creds pasted by the admin from Settings.
  //    Preferred over the env-level key because it lets each café BYO
  //    API key without a Railway redeploy.
  const tenantResend = await getResendCredentials(locationId);
  if (tenantResend?.apiKey) {
    const displayName =
      tenantResend.displayName ??
      (await resolveLocationDisplayName(locationId));
    return new ResendEmailProvider({
      apiKey: tenantResend.apiKey,
      fromEmail: tenantResend.fromEmail,
      displayName,
    });
  }

  // 3. App-wide env Resend (fallback for single-tenant deploys where
  //    the app owner configures it globally once).
  if (env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) {
    const displayName = await resolveLocationDisplayName(locationId);
    return new ResendEmailProvider({
      apiKey: env.RESEND_API_KEY,
      fromEmail: env.RESEND_FROM_EMAIL,
      displayName,
    });
  }

  return new ConsoleEmailProvider();
}

/** Human-readable name of whichever provider would be used for this location. */
export async function describeSupplierOrderProvider(
  locationId: string
): Promise<{
  name: "gmail" | "resend" | "console";
  email?: string;
  displayName?: string;
  source?: "gmail-oauth" | "tenant-resend" | "app-resend";
}> {
  const gmail = await getGmailCredentials(locationId);
  if (gmail?.accessToken)
    return { name: "gmail", email: gmail.email, source: "gmail-oauth" };

  const tenantResend = await getResendCredentials(locationId);
  if (tenantResend?.apiKey) {
    return {
      name: "resend",
      email: tenantResend.fromEmail,
      displayName:
        tenantResend.displayName ?? (await resolveLocationDisplayName(locationId)),
      source: "tenant-resend",
    };
  }

  if (env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) {
    return {
      name: "resend",
      email: env.RESEND_FROM_EMAIL,
      displayName: await resolveLocationDisplayName(locationId),
      source: "app-resend",
    };
  }
  return { name: "console" };
}

/**
 * Picks the best supplier-facing display name for a location:
 * business name first, falling back to location name, then a neutral
 * default. Used to wrap the shared Resend sender address in a
 * per-tenant brand — so two cafés sending through the same domain
 * still look like themselves to their suppliers.
 */
async function resolveLocationDisplayName(
  locationId: string
): Promise<string | undefined> {
  try {
    const loc = await db.location.findUnique({
      where: { id: locationId },
      select: {
        name: true,
        business: { select: { name: true } },
      },
    });
    const candidate =
      loc?.business?.name?.trim() || loc?.name?.trim() || undefined;
    return candidate;
  } catch {
    return undefined;
  }
}
