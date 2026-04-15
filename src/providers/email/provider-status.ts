import { env } from "@/lib/env";

/**
 * True when a real email provider (Resend, SMTP) is configured — false
 * when the app is on the console/mock provider that just logs to stdout.
 *
 * Use this when you want to be honest with the user about whether an
 * email actually went out: the bot's "✅ sent to supplier" reply is a
 * lie if this is false, because the ConsoleEmailProvider simulates the
 * send without contacting Resend/SMTP.
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
