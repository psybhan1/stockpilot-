import { env } from "@/lib/env";
import type { AutomationProvider } from "@/providers/contracts";
import { InternalAutomationProvider } from "@/providers/automation/internal-automation";
import { N8nAutomationProvider } from "@/providers/automation/n8n-automation";

export function getAutomationProvider(): AutomationProvider {
  if (
    env.DEFAULT_AUTOMATION_PROVIDER === "n8n" &&
    env.N8N_AUTOMATION_WEBHOOK_URL
  ) {
    return new N8nAutomationProvider({
      webhookUrl: env.N8N_AUTOMATION_WEBHOOK_URL,
      secret: env.N8N_WEBHOOK_SECRET,
    });
  }

  return new InternalAutomationProvider();
}
