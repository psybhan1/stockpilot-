import { redirect } from "next/navigation";

import { TelegramLoginWidget } from "@/components/app/telegram-login-widget";
import { Card, CardContent } from "@/components/ui/card";
import { env } from "@/lib/env";
import { Role } from "@/lib/domain-enums";
import { ensureTelegramWebhook } from "@/lib/telegram-bot";
import { requireSession } from "@/modules/auth/session";
import {
  buildTelegramConnectUrl,
  getTelegramBotUsername,
  isPublicAppUrl,
} from "@/modules/operator-bot/connect";

export default async function TelegramConnectPage({
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
      `/settings?channelConnect=error&channelType=telegram&channelDetail=${encodeURIComponent(
        "Telegram connect token is missing. Start again from Settings."
      )}`
    );
  }

  if (!isPublicAppUrl(env.APP_URL)) {
    redirect(
      `/settings?channelConnect=error&channelType=telegram&channelDetail=${encodeURIComponent(
        "Telegram connect needs a public HTTPS APP_URL."
      )}`
    );
  }

  const botUsername = await getTelegramBotUsername();

  if (!env.TELEGRAM_BOT_TOKEN || !botUsername) {
    redirect(
      `/settings?channelConnect=error&channelType=telegram&channelDetail=${encodeURIComponent(
        "Telegram bot credentials are missing or the bot username could not be resolved."
      )}`
    );
  }

  const webhook = await ensureTelegramWebhook();

  if (!webhook.ok) {
    redirect(
      `/settings?channelConnect=error&channelType=telegram&channelDetail=${encodeURIComponent(
        webhook.reason
      )}`
    );
  }

  const authUrl = `${env.APP_URL.replace(/\/$/, "")}/api/bot/telegram/widget/callback?connectToken=${encodeURIComponent(
    connectToken
  )}`;
  const directBotUrl = buildTelegramConnectUrl(botUsername, connectToken);
  const manualCommand = `/start connect-${connectToken}`;
  const webhookWarning =
    webhook.info?.last_error_message || webhook.info?.last_synchronization_error_date
      ? webhook.info?.last_error_message ??
        "Telegram reported a recent delivery issue, but the webhook is still pointed at this app."
      : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Card className="rounded-[32px] border-border/60 bg-card/92 shadow-xl shadow-black/5">
        <CardContent className="space-y-6 p-8">
          <div className="space-y-3">
            <p className="text-sm uppercase tracking-[0.22em] text-amber-600 dark:text-amber-300">
              Telegram connect
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-balance">
              Connect Telegram without manual ids.
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              StockPilot already prepared the webhook and the secure connect token. Use either
              Telegram path below and this manager chat will link automatically.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <StepCard
              step="1"
              title="Open Telegram"
              detail="Use the big button below to open the bot with your secure connect token."
            />
            <StepCard
              step="2"
              title="Tap Start"
              detail="Telegram will prompt you to start the bot if this is the first time."
            />
            <StepCard
              step="3"
              title="Come back linked"
              detail="StockPilot will link the manager automatically and the bot can take stock commands."
            />
          </div>

          <div className="rounded-[28px] border border-emerald-200/70 bg-emerald-50/70 p-5 dark:border-emerald-500/30 dark:bg-emerald-950/20">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">Telegram delivery is ready</p>
              <p className="text-sm text-muted-foreground">
                Webhook confirmed at{" "}
                <span className="font-medium text-foreground">{webhook.webhookUrl}</span>
              </p>
              {webhook.changed ? (
                <p className="text-xs text-muted-foreground">
                  StockPilot refreshed the Telegram webhook for this public app URL just now.
                </p>
              ) : null}
            </div>
          </div>

          {webhookWarning ? (
            <div className="rounded-[28px] border border-amber-200/80 bg-amber-50/80 p-5 dark:border-amber-500/30 dark:bg-amber-950/20">
              <p className="text-sm font-semibold text-foreground">
                Telegram had a recent delivery hiccup
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {webhookWarning}. The connect flow below is still available, and StockPilot will
                keep using this webhook URL.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-[28px] border border-border/60 bg-background/80 p-5">
              <div className="space-y-3">
                <p className="text-sm font-semibold text-foreground">Recommended path</p>
                <h2 className="text-2xl font-semibold tracking-tight">Open Telegram and connect</h2>
                <p className="text-sm text-muted-foreground">
                  This is the most reliable path. It works even if Telegram web approval is not
                  available for the current domain yet.
                </p>
              </div>

              <div className="mt-5 space-y-4">
                <a
                  href={directBotUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Open Telegram bot
                </a>

                <div className="rounded-[22px] border border-border/60 bg-card/70 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Manual fallback command
                  </p>
                  <p className="mt-2 break-all font-mono text-sm text-foreground">{manualCommand}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Only use this if Telegram opens the bot without sending the start payload
                    automatically.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-border/60 bg-background/80 p-5">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground">Optional web approval</p>
                <p className="text-sm text-muted-foreground">
                  If the domain is linked in BotFather, this official Telegram widget can connect
                  you on the web without opening the chat first.
                </p>
              </div>

              <div className="mt-4">
                <TelegramLoginWidget botUsername={botUsername} authUrl={authUrl} />
              </div>

              <div className="mt-4 rounded-[22px] border border-border/60 bg-card/70 p-4 text-xs text-muted-foreground">
                Telegram web approval still depends on the bot domain being linked in BotFather.
                The Telegram app button on the left remains the primary path and does not depend on
                that widget rendering.
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <a
              href="/settings"
              className="inline-flex h-10 items-center justify-center rounded-2xl border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Back to settings
            </a>
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
