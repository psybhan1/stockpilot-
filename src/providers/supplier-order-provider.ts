import { env } from "@/lib/env";
import type { SupplierOrderProvider } from "@/providers/contracts";
import { ConsoleEmailProvider } from "@/providers/email/console-email";
import { GmailEmailProvider } from "@/providers/email/gmail-email";
import { ResendEmailProvider } from "@/providers/email/resend-email";
import { getGmailCredentials } from "@/modules/channels/service";

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
 *   1. Location's connected Gmail (free, uses their own 500/day quota)
 *   2. Resend, if configured globally
 *   3. Console (test mode — logs only)
 *
 * The Gmail check is a cheap DB read; if no row is found we fall
 * through to the global provider.
 */
export async function getSupplierOrderProviderForLocation(
  locationId: string
): Promise<SupplierOrderProvider> {
  const gmail = await getGmailCredentials(locationId);
  if (gmail?.accessToken) {
    return new GmailEmailProvider(locationId);
  }
  return getSupplierOrderProvider();
}

/** Human-readable name of whichever provider would be used for this location. */
export async function describeSupplierOrderProvider(
  locationId: string
): Promise<{ name: "gmail" | "resend" | "console"; email?: string }> {
  const gmail = await getGmailCredentials(locationId);
  if (gmail?.accessToken) return { name: "gmail", email: gmail.email };
  if (env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) {
    return { name: "resend", email: env.RESEND_FROM_EMAIL };
  }
  return { name: "console" };
}
