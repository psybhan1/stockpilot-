import { env } from "@/lib/env";
import type { SupplierOrderProvider } from "@/providers/contracts";
import { ConsoleEmailProvider } from "@/providers/email/console-email";
import { ResendEmailProvider } from "@/providers/email/resend-email";

export function getSupplierOrderProvider(): SupplierOrderProvider {
  if (env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) {
    return new ResendEmailProvider({
      apiKey: env.RESEND_API_KEY,
      fromEmail: env.RESEND_FROM_EMAIL,
    });
  }

  return new ConsoleEmailProvider();
}
