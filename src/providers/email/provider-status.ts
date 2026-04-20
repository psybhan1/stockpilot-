import { env } from "@/lib/env";
import { getGmailCredentials } from "@/modules/channels/service";

/**
 * True when a real email path exists for THIS LOCATION — either
 * the location has connected their own Gmail, or Resend is globally
 * configured. False means the console/mock provider will simulate
 * sends without anything actually going out.
 *
 * Use this when you want to be honest with the user about whether
 * an email will actually leave the building.
 */
export async function isRealEmailProviderForLocation(
  locationId: string
): Promise<boolean> {
  const gmail = await getGmailCredentials(locationId);
  if (gmail?.accessToken) return true;
  if (env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY?.trim()) {
    return true;
  }
  return false;
}

/**
 * Location-agnostic check — true if ANY email provider (Resend)
 * is globally configured. Gmail is per-location so it doesn't
 * count here; use isRealEmailProviderForLocation for accuracy.
 */
export function isRealEmailProviderConfigured(): boolean {
  if (env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY?.trim()) {
    return true;
  }
  return false;
}

export function emailProviderName(): "resend" | "console" {
  return env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY?.trim()
    ? "resend"
    : "console";
}

/** Short description of which email path exists for a location, for UI. */
export async function describeEmailPathForLocation(
  locationId: string
): Promise<{
  kind: "gmail" | "resend" | "none";
  from?: string;
}> {
  const gmail = await getGmailCredentials(locationId);
  if (gmail?.accessToken) return { kind: "gmail", from: gmail.email };
  if (env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY?.trim()) {
    return { kind: "resend", from: env.RESEND_FROM_EMAIL };
  }
  return { kind: "none" };
}
