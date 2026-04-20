import { redirect } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { env } from "@/lib/env";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import {
  buildWhatsAppConnectUrl,
  isPublicAppUrl,
  isTwilioSandboxSender,
} from "@/modules/operator-bot/connect";

export default async function WhatsAppConnectPage({
  searchParams,
}: {
  searchParams: Promise<{
    token?: string;
  }>;
}) {
  await requireSession(Role.MANAGER);
  const params = await searchParams;
  const connectToken = params.token?.trim();

  if (!connectToken) {
    redirect(
      `/settings?channelConnect=error&channelType=whatsapp&channelDetail=${encodeURIComponent(
        "WhatsApp connect token is missing. Start again from Settings."
      )}`
    );
  }

  if (!isPublicAppUrl(env.APP_URL)) {
    redirect(
      `/settings?channelConnect=error&channelType=whatsapp&channelDetail=${encodeURIComponent(
        "WhatsApp connect needs a public HTTPS APP_URL."
      )}`
    );
  }

  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_WHATSAPP_FROM) {
    redirect(
      `/settings?channelConnect=error&channelType=whatsapp&channelDetail=${encodeURIComponent(
        "Twilio WhatsApp credentials are still missing."
      )}`
    );
  }

  const message = `connect ${connectToken}`;
  const openWhatsAppUrl = buildWhatsAppConnectUrl(env.TWILIO_WHATSAPP_FROM, connectToken);
  const usesSandbox = isTwilioSandboxSender(env.TWILIO_WHATSAPP_FROM);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Card className="rounded-[32px] border-border/60 bg-card/92 shadow-xl shadow-black/5">
        <CardContent className="space-y-6 p-8">
          <div className="space-y-3">
            <p className="text-sm uppercase tracking-[0.22em] text-amber-600 dark:text-amber-300">
              WhatsApp connect
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-balance">
              Connect WhatsApp with one send.
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              StockPilot generated a secure connect message for this manager. Open WhatsApp, send
              it once, and the chat will link automatically.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <StepCard step="1" title="Open WhatsApp" detail="Use the button below to open the secure prefilled message." />
            <StepCard step="2" title="Press send" detail="WhatsApp requires the manager to send the connect message." />
            <StepCard step="3" title="Chat becomes active" detail="StockPilot links that WhatsApp number and can accept stock commands." />
          </div>

          <div className="rounded-[28px] border border-border/60 bg-background/80 p-5">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-foreground">Prefilled connect message</p>
              <p className="rounded-[22px] border border-border/60 bg-card/70 p-4 font-mono text-sm text-foreground">
                {message}
              </p>
              <p className="text-xs text-muted-foreground">
                The button below opens WhatsApp with this exact message already filled in.
              </p>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <a
                href={openWhatsAppUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Open WhatsApp
              </a>
              <a
                href="/settings"
                className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Back to settings
              </a>
            </div>
          </div>

          <div className="rounded-[24px] border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
            {usesSandbox
              ? "This sender is Twilio's WhatsApp sandbox. The manager phone must first join the sandbox before the connect message can succeed."
              : "This uses your configured WhatsApp-enabled Twilio sender. Once the manager sends the prefilled message, StockPilot will link the number automatically."}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StepCard({
  step,
  title,
  detail,
}: {
  step: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-[24px] border border-border/60 bg-background/80 p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-full bg-primary/12 text-sm font-semibold text-primary">
          {step}
        </div>
        <p className="font-semibold text-foreground">{title}</p>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}
