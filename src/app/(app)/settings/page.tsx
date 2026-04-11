import type { ReactNode } from "react";
import { Cable, MessageSquareText, Settings2, Workflow } from "lucide-react";

import {
  connectSquareAction,
  disconnectBotChannelAction,
  runJobsAction,
  startLocalTelegramBotConnectAction,
  startLocalWhatsAppBotConnectAction,
  startTelegramBotConnectAction,
  startWhatsAppBotConnectAction,
  syncSalesAction,
  updateBotIdentityAction,
} from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Role } from "@/lib/domain-enums";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import type { Prisma } from "@/lib/prisma";
import { BotChannel } from "@/lib/prisma";
import { db } from "@/lib/db";
import { requireSession } from "@/modules/auth/session";
import { getSettingsData } from "@/modules/dashboard/queries";
import { isPublicAppUrl, isTwilioSandboxSender } from "@/modules/operator-bot/connect";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    square?: string;
    reason?: string;
    bot?: string;
    botWhatsapp?: string;
    botWhatsappDetail?: string;
    botTelegram?: string;
    botTelegramDetail?: string;
    chatConnect?: string;
    chatChannel?: string;
    chatDetail?: string;
  }>;
}) {
  const session = await requireSession(Role.MANAGER);
  const params = await searchParams;
  const { integration, jobs, auditLogs } = await getSettingsData(session.locationId);
  const [currentManager, pendingConnectRequests, recentConnectEvents] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: {
        id: session.userId,
      },
      select: {
        phoneNumber: true,
        telegramChatId: true,
        telegramUsername: true,
      },
    }),
    db.botConnectRequest.findMany({
      where: {
        userId: session.userId,
        consumedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    db.auditLog.findMany({
      where: {
        userId: session.userId,
        action: {
          in: ["bot.connect_conflict", "bot.connect_expired"],
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 12,
      select: {
        action: true,
        createdAt: true,
        details: true,
      },
    }),
  ]);
  const squareMode = env.DEFAULT_POS_PROVIDER === "square" ? "Real Square" : "Fake Square";
  const automationWebhookUrl = env.N8N_AUTOMATION_WEBHOOK_URL;
  const notificationWebhookUrl = env.N8N_NOTIFICATION_WEBHOOK_URL;
  const automationMode =
    env.DEFAULT_AUTOMATION_PROVIDER === "n8n" && automationWebhookUrl
      ? "n8n website-order webhook"
      : "Built-in internal automation";
  const notificationMode =
    notificationWebhookUrl && env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY
      ? "Resend email + n8n external channels"
      : notificationWebhookUrl
        ? "Console or Resend email + n8n external channels"
        : env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY
          ? "Resend email only"
          : "Console-backed local delivery";
  const emailReady = env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY;
  const expoReady = true;
  const twilioReady = Boolean(
    env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM
  );
  const publicAppUrlReady = isPublicAppUrl(env.APP_URL);
  const localRelayMode = !publicAppUrlReady;
  const whatsappConnected = Boolean(currentManager.phoneNumber);
  const telegramConnected = Boolean(currentManager.telegramChatId);
  const telegramTokenReady = Boolean(env.TELEGRAM_BOT_TOKEN);
  const whatsappConnectReady = publicAppUrlReady && twilioReady;
  const telegramConnectReady = publicAppUrlReady && telegramTokenReady;
  const telegramOneTapReady = telegramConnectReady;
  const whatsappPendingRequest = pendingConnectRequests.find(
    (request) => request.channel === BotChannel.WHATSAPP
  );
  const telegramPendingRequest = pendingConnectRequests.find(
    (request) => request.channel === BotChannel.TELEGRAM
  );
  const whatsappCard = getChannelCardState({
    channel: BotChannel.WHATSAPP,
    isConnected: whatsappConnected,
    isConfigured: twilioReady,
    isProductionReady: whatsappConnectReady,
    publicAppUrlReady,
    pendingRequest: whatsappPendingRequest,
    recentIssue: getLatestConnectIssue(recentConnectEvents, BotChannel.WHATSAPP),
    connectedValue: currentManager.phoneNumber,
    isSandboxSender: isTwilioSandboxSender(env.TWILIO_WHATSAPP_FROM),
    supportsOneTap: false,
  });
  const telegramCard = getChannelCardState({
    channel: BotChannel.TELEGRAM,
    isConnected: telegramConnected,
    isConfigured: telegramTokenReady,
    isProductionReady: telegramConnectReady,
    publicAppUrlReady,
    pendingRequest: telegramPendingRequest,
    recentIssue: getLatestConnectIssue(recentConnectEvents, BotChannel.TELEGRAM),
    supportsOneTap: telegramOneTapReady,
    connectedValue: currentManager.telegramUsername
      ? `${currentManager.telegramUsername} • ${currentManager.telegramChatId ?? ""}`
      : currentManager.telegramChatId,
  });
  const squareBanner =
    params.square === "connected"
      ? "Square OAuth connection completed. Catalog sync is queued automatically."
      : params.square === "error"
        ? `Square connection failed: ${params.reason ?? "Unknown error"}`
        : params.square === "missing_code"
          ? "Square callback did not include a valid authorization code."
          : null;
  const botBanner =
    params.bot === "updated"
      ? {
          title: "Bot identity saved",
          whatsappStatus: params.botWhatsapp ?? "skipped",
          whatsappDetail: params.botWhatsappDetail ?? "",
          telegramStatus: params.botTelegram ?? "skipped",
          telegramDetail: params.botTelegramDetail ?? "",
        }
      : null;
  const chatConnectBanner =
    params.chatConnect === "error"
      ? {
          tone: "critical" as const,
          title: `${formatChannelLabel(params.chatChannel)} connection needs attention`,
          detail: params.chatDetail ?? "Unknown connection error.",
        }
      : params.chatConnect === "disconnected"
        ? {
            tone: "info" as const,
            title: `${formatChannelLabel(params.chatChannel)} disconnected`,
            detail: "You can reconnect at any time from this page.",
          }
        : params.chatConnect === "connected"
          ? {
              tone: "success" as const,
              title: `${formatChannelLabel(params.chatChannel)} connected`,
              detail: params.chatDetail ?? "This manager chat is now linked to StockPilot.",
            }
          : null;

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border-border/60 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(255,255,255,0.92))] shadow-xl shadow-black/5 dark:bg-[linear-gradient(135deg,rgba(68,64,60,0.98),rgba(28,25,23,0.94))]">
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.22em] text-amber-600 dark:text-amber-300">
              Settings
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Keep integrations and operations setup understandable at a glance.
            </h1>
            <p className="mt-3 text-base text-muted-foreground sm:text-lg">
              Most of the team should rarely need this page. When you do open it, the important
              connection state and background health should be obvious immediately.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <SettingsCard
              icon={Cable}
              title="Square mode"
              value={squareMode}
              helper={integration?.status ?? "Disconnected"}
            />
            <SettingsCard
              icon={Workflow}
              title="Automation"
              value={automationMode}
              helper={automationWebhookUrl ? "External ready" : "Internal only"}
            />
            <SettingsCard
              icon={MessageSquareText}
              title="Notifications"
              value={notificationMode}
              helper={notificationWebhookUrl ? "External channels ready" : "Local testing mode"}
            />
          </div>
        </CardContent>
      </Card>

      {squareBanner ? (
        <Card className="rounded-[28px] border-border/60 bg-card/88 shadow-lg shadow-black/5">
          <CardContent className="px-5 py-4 text-sm text-muted-foreground">
            {squareBanner}
          </CardContent>
        </Card>
      ) : null}

      {botBanner ? (
        <Card className="rounded-[28px] border-border/60 bg-card/88 shadow-lg shadow-black/5">
          <CardContent className="space-y-4 px-5 py-4 text-sm text-muted-foreground">
            <div>
              <p className="font-medium text-foreground">{botBanner.title}</p>
              <p className="mt-1">
                StockPilot attempted to send a welcome message to each connected channel right
                after save.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <BotStatusCard
                label="WhatsApp welcome"
                status={botBanner.whatsappStatus}
                detail={botBanner.whatsappDetail}
              />
              <BotStatusCard
                label="Telegram welcome"
                status={botBanner.telegramStatus}
                detail={botBanner.telegramDetail}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {chatConnectBanner ? (
        <Card className="rounded-[28px] border-border/60 bg-card/88 shadow-lg shadow-black/5">
          <CardContent className="px-5 py-4 text-sm text-muted-foreground">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-foreground">{chatConnectBanner.title}</p>
                <p className="mt-1">{chatConnectBanner.detail}</p>
              </div>
              <StatusBadge
                label={
                  chatConnectBanner.tone === "critical"
                    ? "Needs setup"
                    : chatConnectBanner.tone === "success"
                      ? "Connected"
                      : "Updated"
                }
                tone={chatConnectBanner.tone}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <Panel
            title="Square connection"
            description="Use this when connecting a real Square account or re-running the demo sync."
          >
            <div className="rounded-[24px] border border-border/60 bg-background/80 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">Current connection</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {integration?.status ?? "DISCONNECTED"} - last sync{" "}
                    {formatDateTime(integration?.lastSyncedAt)}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Provider mode: {squareMode}
                    {integration?.externalLocationId
                      ? ` - Square location ${integration.externalLocationId}`
                      : ""}
                  </p>
                </div>
                <StatusBadge
                  label={integration?.status ?? "DISCONNECTED"}
                  tone={integration?.status === "CONNECTED" ? "success" : "warning"}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <form action={connectSquareAction}>
                <Button type="submit" className="rounded-2xl">
                  Connect or refresh Square
                </Button>
              </form>
              <form action={syncSalesAction}>
                <Button type="submit" variant="outline" className="rounded-2xl">
                  Import sample sale
                </Button>
              </form>
              <form action={runJobsAction}>
                <Button type="submit" variant="outline" className="rounded-2xl">
                  Run queued jobs
                </Button>
              </form>
            </div>
          </Panel>

          <Panel
            title="Background jobs"
            description="Sync, forecast, alert, and reorder work all flow through the same queue."
          >
            <div className="space-y-3">
              {jobs.length ? (
                jobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between gap-3 rounded-[24px] border border-border/60 bg-background/80 p-4"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{job.type}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Created {formatDateTime(job.createdAt)}
                      </p>
                    </div>
                    <StatusBadge label={job.status} tone="info" />
                  </div>
                ))
              ) : (
                <EmptyState
                  title="No recent jobs"
                  description="Background activity will appear here when it runs."
                />
              )}
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel
            title="Automation"
            description="Website ordering can stay in-app or dispatch to an external workflow."
          >
            <SettingCallout
              icon={Workflow}
              title="Current automation provider"
              value={automationMode}
              helper={
                automationWebhookUrl
                  ? "Website-order prep can dispatch to the dedicated n8n automation workflow."
                  : "No external webhook is configured. StockPilot will keep automation prep in-app."
              }
              statusLabel={automationWebhookUrl ? "Configured" : "Internal"}
              statusTone={automationWebhookUrl ? "success" : "info"}
            />
          </Panel>

          <Panel
            title="Notifications"
            description="See each live notification path separately so you know what is production-ready right now."
          >
            <div className="space-y-3">
              <SettingCallout
                icon={MessageSquareText}
                title="Email delivery"
                value={emailReady ? "Resend transactional email" : "Console email provider"}
                helper={
                  emailReady
                    ? "Email is ready to reach a real inbox through Resend."
                    : "Email tests stay local until a Resend API key is configured."
                }
                statusLabel={emailReady ? "Live" : "Local"}
                statusTone={emailReady ? "success" : "info"}
              />
              <SettingCallout
                icon={MessageSquareText}
                title="Expo push"
                value={
                  env.EXPO_ACCESS_TOKEN
                    ? "Direct Expo Push API with access token"
                    : "Direct Expo Push API"
                }
                helper={
                  env.EXPO_ACCESS_TOKEN
                    ? "Enhanced push security is configured server-side."
                    : "Expo is ready for live testing. An access token is optional unless your Expo project requires enhanced push security."
                }
                statusLabel={expoReady ? "Ready" : "Blocked"}
                statusTone={expoReady ? "success" : "warning"}
              />
              <SettingCallout
                icon={MessageSquareText}
                title="Twilio WhatsApp"
                value={
                  twilioReady
                    ? `Live sender ${env.TWILIO_WHATSAPP_FROM}`
                    : "Credentials still needed"
                }
                helper={
                  twilioReady
                    ? "WhatsApp is ready for real delivery through Twilio."
                    : "Add Account SID, Auth Token, and a WhatsApp-enabled sender to turn on live delivery."
                }
                statusLabel={twilioReady ? "Live" : "Missing creds"}
                statusTone={twilioReady ? "success" : "warning"}
              />
              <SettingCallout
                icon={MessageSquareText}
                title="External notification handoff"
                value={notificationMode}
                helper={
                  notificationWebhookUrl
                    ? "n8n is configured if you want non-native external routing or orchestration."
                    : "No notification webhook is configured. Native providers or local fallbacks will be used."
                }
                statusLabel={notificationWebhookUrl ? "Configured" : "Optional"}
                statusTone={notificationWebhookUrl ? "success" : "info"}
              />
            </div>
          </Panel>

          <Panel
            title="Manager chat bot"
            description="Production-first chat linking for managers. Tap connect, finish inside the chat app, and let StockPilot link the channel automatically."
          >
            <div className="space-y-4">
              <div className="rounded-[24px] border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">How it works</p>
                <p className="mt-2">
                  WhatsApp opens a prefilled connect message. Telegram opens the bot with a secure
                  start link. Once the manager sends the message or taps Start, StockPilot links
                  that chat automatically and confirms inside the conversation.
                </p>
              </div>

              <div className="grid gap-3">
                <ConnectChannelCard
                  channel={BotChannel.WHATSAPP}
                  title="WhatsApp"
                  connectedValue={currentManager.phoneNumber}
                  isConnected={whatsappConnected}
                  isReady={whatsappConnectReady}
                  readinessHint={
                    !twilioReady
                      ? "Add Twilio credentials and a WhatsApp-enabled sender to turn this on."
                      : !publicAppUrlReady
                        ? "Local relay mode is ready. Keep StockPilot and its worker running, then tap connect."
                        : twilioReady
                        ? "Tap connect, send the prefilled message, and you are done."
                        : "Add Twilio credentials and a WhatsApp-enabled sender to turn this on."
                  }
                  helper={
                    whatsappConnected
                      ? "Orders from this WhatsApp number will be accepted immediately."
                      : "Best for managers who want to reorder from the same phone they already use daily."
                  }
                  statusLabel={whatsappCard.statusLabel}
                  statusTone={whatsappCard.statusTone}
                  detailLabel={whatsappCard.detailLabel}
                  detailText={whatsappCard.detailText}
                  primaryActionLabel={whatsappCard.primaryActionLabel}
                  primaryActionDisabled={whatsappCard.primaryActionDisabled}
                  connectAction={startWhatsAppBotConnectAction}
                  disconnectAction={disconnectBotChannelAction}
                />

                <ConnectChannelCard
                  channel={BotChannel.TELEGRAM}
                  title="Telegram"
                  connectedValue={
                    currentManager.telegramUsername
                      ? `${currentManager.telegramUsername} • ${currentManager.telegramChatId ?? ""}`
                      : currentManager.telegramChatId
                  }
                  isConnected={telegramConnected}
                  isReady={telegramConnectReady}
                  readinessHint={
                    !env.TELEGRAM_BOT_TOKEN
                      ? "Add a Telegram bot token to enable this connect button."
                      : !publicAppUrlReady
                        ? "Local relay mode is ready. Keep StockPilot and its worker running, then tap connect."
                        : env.TELEGRAM_BOT_TOKEN
                        ? "Tap connect, hit Start in Telegram, and you are done."
                        : "Add a Telegram bot token to enable this connect button."
                  }
                  helper={
                    telegramConnected
                      ? "Orders from this Telegram chat will be accepted immediately."
                      : "Useful when a manager prefers a separate operations chat instead of WhatsApp."
                  }
                  statusLabel={telegramCard.statusLabel}
                  statusTone={telegramCard.statusTone}
                  detailLabel={telegramCard.detailLabel}
                  detailText={telegramCard.detailText}
                  primaryActionLabel={telegramCard.primaryActionLabel}
                  primaryActionDisabled={telegramCard.primaryActionDisabled}
                  connectAction={startTelegramBotConnectAction}
                  disconnectAction={disconnectBotChannelAction}
                />
              </div>

              {localRelayMode ? (
                <details className="group rounded-[24px] border border-dashed border-amber-300/70 bg-amber-50/70 p-4 dark:border-amber-500/40 dark:bg-amber-950/20">
                  <summary className="cursor-pointer list-none font-medium text-foreground">
                    Developer-only local relay
                  </summary>
                  <p className="mt-2 text-sm text-muted-foreground">
                    StockPilot can still help engineering test chat linking while the app is on
                    localhost, but this is not the normal customer path. Production linking needs
                    a public HTTPS APP_URL.
                  </p>

                  <div className="mt-4 grid gap-3">
                    <ConnectChannelCard
                      channel={BotChannel.WHATSAPP}
                      title="WhatsApp local relay"
                      helper="Use this only while the app and worker are running on your machine."
                      statusLabel={twilioReady ? "Dev ready" : "Needs setup"}
                      statusTone="warning"
                      detailLabel="Before you connect"
                      detailText={
                        twilioReady
                          ? "Keep StockPilot and its worker running locally, then send the prefilled message from the same manager phone."
                          : "Add Twilio credentials and a WhatsApp-enabled sender before testing locally."
                      }
                      primaryActionLabel="Open local WhatsApp connect"
                      primaryActionDisabled={!twilioReady}
                      connectAction={startLocalWhatsAppBotConnectAction}
                      disconnectAction={disconnectBotChannelAction}
                    />

                    <ConnectChannelCard
                      channel={BotChannel.TELEGRAM}
                      title="Telegram local relay"
                      helper="Use this only for local engineering tests before deployment."
                      statusLabel={telegramTokenReady ? "Dev ready" : "Needs setup"}
                      statusTone="warning"
                      detailLabel="Before you connect"
                      detailText={
                        telegramTokenReady
                          ? "Keep StockPilot and its worker running locally, then tap Start in Telegram so the local relay can pick it up."
                          : "Add a Telegram bot token before testing locally."
                      }
                      primaryActionLabel="Open local Telegram connect"
                      primaryActionDisabled={!telegramTokenReady}
                      connectAction={startLocalTelegramBotConnectAction}
                      disconnectAction={disconnectBotChannelAction}
                    />
                  </div>
                </details>
              ) : null}

              <details className="group rounded-[24px] border border-border/60 bg-background/80 p-4">
                <summary className="cursor-pointer list-none font-medium text-foreground">
                  Advanced fallback
                </summary>
                <p className="mt-2 text-sm text-muted-foreground">
                  Only use this if you already know the exact WhatsApp number or Telegram chat id
                  and want to set it manually.
                </p>

                <form action={updateBotIdentityAction} className="mt-4 space-y-4">
                  <label className="block space-y-1">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      WhatsApp phone number
                    </span>
                    <Input
                      name="phoneNumber"
                      defaultValue={currentManager.phoneNumber ?? ""}
                      placeholder="+14155550123"
                      className="h-10 rounded-2xl"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Telegram chat id
                    </span>
                    <Input
                      name="telegramChatId"
                      defaultValue={currentManager.telegramChatId ?? ""}
                      placeholder="700100200"
                      className="h-10 rounded-2xl"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Telegram username
                    </span>
                    <Input
                      name="telegramUsername"
                      defaultValue={currentManager.telegramUsername ?? ""}
                      placeholder="maya_manager"
                      className="h-10 rounded-2xl"
                    />
                  </label>

                  <div className="rounded-[24px] border border-border/60 bg-card/70 p-4 text-sm text-muted-foreground">
                    WhatsApp webhook:{" "}
                    <span className="font-medium text-foreground">{`${env.APP_URL.replace(/\/$/, "")}/api/bot/whatsapp`}</span>
                    <br />
                    Telegram webhook:{" "}
                    <span className="font-medium text-foreground">{`${env.APP_URL.replace(/\/$/, "")}/api/bot/telegram`}</span>
                    <br />
                    <br />
                    Telegram welcome and replies only work after the user has started the bot at
                    least once. Manual fields are only a fallback. For the normal production flow,
                    use the connect buttons above with a public HTTPS APP_URL.
                  </div>

                  <Button type="submit" variant="outline" className="rounded-2xl">
                    Save manual values
                  </Button>
                </form>
              </details>
            </div>
          </Panel>

          <Panel
            title="Audit activity"
            description="Important operational changes stay visible here for trust and troubleshooting."
          >
            <div className="space-y-3">
              {auditLogs.length ? (
                auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-[24px] border border-border/60 bg-background/80 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{log.action}</p>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(log.createdAt)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{log.entityType}</p>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="No recent audit entries"
                  description="Important changes will appear here automatically."
                />
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function SettingsCard({
  icon: Icon,
  title,
  value,
  helper,
}: {
  icon: typeof Settings2;
  title: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-[24px] border border-border/60 bg-background/85 p-4 shadow-lg shadow-black/5">
      <Icon className="size-5 text-amber-600 dark:text-amber-300" />
      <p className="mt-4 text-sm text-muted-foreground">{title}</p>
      <p className="mt-2 font-semibold">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{helper}</p>
    </div>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="rounded-[28px] border-border/60 bg-card/88 shadow-lg shadow-black/5">
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function SettingCallout({
  icon: Icon,
  title,
  value,
  helper,
  statusLabel,
  statusTone,
}: {
  icon: typeof Workflow;
  title: string;
  value: string;
  helper: string;
  statusLabel: string;
  statusTone: "success" | "info" | "warning";
}) {
  return (
    <div className="rounded-[24px] border border-border/60 bg-background/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon className="size-4" />
            <p className="text-xs uppercase tracking-[0.16em]">{title}</p>
          </div>
          <p className="mt-3 font-semibold">{value}</p>
          <p className="mt-2 text-sm text-muted-foreground">{helper}</p>
        </div>
        <StatusBadge label={statusLabel} tone={statusTone} />
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-border px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function BotStatusCard({
  label,
  status,
  detail,
}: {
  label: string;
  status: string;
  detail: string;
}) {
  const tone =
    status === "sent"
      ? "success"
      : status === "failed"
        ? "critical"
        : status === "not_configured"
          ? "warning"
          : "info";

  const summary =
    status === "sent"
      ? "Welcome message sent."
      : status === "failed"
        ? "The provider rejected the welcome message."
        : status === "not_configured"
          ? "This channel is not configured yet."
          : "No message was sent for this channel.";

  return (
    <div className="rounded-[24px] border border-border/60 bg-background/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-foreground">{label}</p>
          <p className="mt-2">{summary}</p>
          {detail ? <p className="mt-2 text-xs">{detail}</p> : null}
        </div>
        <StatusBadge label={status.replaceAll("_", " ")} tone={tone} />
      </div>
    </div>
  );
}

function ConnectChannelCard({
  channel,
  title,
  connectedValue,
  isConnected,
  isReady,
  readinessHint,
  helper,
  statusLabel,
  statusTone,
  detailLabel,
  detailText,
  primaryActionLabel,
  primaryActionDisabled,
  connectAction,
  disconnectAction,
}: {
  channel: BotChannel;
  title: string;
  connectedValue?: string | null;
  isConnected?: boolean;
  isReady?: boolean;
  readinessHint?: string;
  helper: string;
  statusLabel?: string;
  statusTone?: "success" | "info" | "warning" | "critical";
  detailLabel?: string;
  detailText?: string;
  primaryActionLabel?: string;
  primaryActionDisabled?: boolean;
  connectAction: () => Promise<void>;
  disconnectAction: (formData: FormData) => Promise<void>;
}) {
  const resolvedConnected = statusLabel === "Connected" || Boolean(isConnected);
  const resolvedStatusLabel =
    statusLabel ?? (resolvedConnected ? "Connected" : isReady ? "Ready" : "Needs setup");
  const resolvedStatusTone =
    statusTone ?? (resolvedConnected ? "success" : isReady ? "info" : "warning");
  const resolvedDetailLabel =
    detailLabel ?? (resolvedConnected ? "Currently linked" : "Before you connect");
  const resolvedDetailText =
    detailText ?? (resolvedConnected ? connectedValue ?? "" : readinessHint ?? "");
  const resolvedPrimaryActionLabel =
    primaryActionLabel ?? (resolvedConnected ? `Reconnect ${title}` : `Connect ${title}`);
  const resolvedPrimaryActionDisabled = primaryActionDisabled ?? !Boolean(isReady);

  return (
    <div className="rounded-[24px] border border-border/60 bg-background/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-foreground">{title}</p>
            <StatusBadge label={resolvedStatusLabel} tone={resolvedStatusTone} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{helper}</p>
          <p className="mt-3 text-sm">
            <span className="font-medium text-foreground">{resolvedDetailLabel}</span>
            <span className="text-muted-foreground"> {resolvedDetailText}</span>
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <form action={connectAction}>
          <Button type="submit" className="rounded-2xl" disabled={resolvedPrimaryActionDisabled}>
            {resolvedPrimaryActionLabel}
          </Button>
        </form>
        {resolvedConnected ? (
          <form action={disconnectAction}>
            <input type="hidden" name="channel" value={channel} />
            <Button type="submit" variant="outline" className="rounded-2xl">
              Disconnect
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function formatChannelLabel(channel?: string) {
  if (!channel) {
    return "Chat";
  }

  return channel.toLowerCase() === "telegram" ? "Telegram" : "WhatsApp";
}

type PendingConnectRequest = {
  channel: BotChannel;
  expiresAt: Date;
  createdAt: Date;
};

type ConnectIssue = {
  status: "expired" | "conflict";
  createdAt: Date;
  detail: string | null;
};

function getChannelCardState(input: {
  channel: BotChannel;
  isConnected: boolean;
  isConfigured: boolean;
  isProductionReady: boolean;
  publicAppUrlReady: boolean;
  pendingRequest?: PendingConnectRequest | null;
  recentIssue?: ConnectIssue | null;
  connectedValue?: string | null;
  isSandboxSender?: boolean;
  supportsOneTap?: boolean;
}) {
  const channelLabel = input.channel === BotChannel.TELEGRAM ? "Telegram" : "WhatsApp";
  const now = Date.now();
  const hasPendingRequest =
    input.pendingRequest !== null &&
    input.pendingRequest !== undefined &&
    input.pendingRequest.expiresAt.getTime() > now;
  const hasExpiredPendingRequest =
    input.pendingRequest !== null &&
    input.pendingRequest !== undefined &&
    input.pendingRequest.expiresAt.getTime() <= now;

  if (input.isConnected) {
    return {
      statusLabel: "Connected",
      statusTone: "success" as const,
      detailLabel: "Currently linked",
      detailText: input.connectedValue ?? `${channelLabel} is connected for this manager.`,
      primaryActionLabel: `Reconnect ${channelLabel}`,
      primaryActionDisabled: !input.isProductionReady,
    };
  }

  if (hasPendingRequest) {
    return {
      statusLabel: "Connect link issued",
      statusTone: "info" as const,
      detailLabel: "Next step",
      detailText:
        input.channel === BotChannel.TELEGRAM
          ? input.supportsOneTap
            ? `Finish the Telegram approval flow before ${formatDateTime(input.pendingRequest?.expiresAt ?? null)}.`
            : `Open Telegram, tap Start, and finish before ${formatDateTime(input.pendingRequest?.expiresAt ?? null)}.`
          : `Open WhatsApp, send the prefilled message, and finish before ${formatDateTime(input.pendingRequest?.expiresAt ?? null)}.`,
      primaryActionLabel: `Reissue ${channelLabel} link`,
      primaryActionDisabled: !input.isProductionReady,
    };
  }

  if (input.recentIssue?.status === "conflict") {
    return {
      statusLabel: "Conflict",
      statusTone: "critical" as const,
      detailLabel: "Needs attention",
      detailText:
        input.recentIssue.detail ??
        `${channelLabel} is already linked to another StockPilot manager. Disconnect it there or reconnect from the correct account.`,
      primaryActionLabel: `Try ${channelLabel} again`,
      primaryActionDisabled: !input.isProductionReady,
    };
  }

  if (hasExpiredPendingRequest || input.recentIssue?.status === "expired") {
    return {
      statusLabel: "Expired",
      statusTone: "warning" as const,
      detailLabel: "Next step",
      detailText: `That ${channelLabel.toLowerCase()} connect link expired. Issue a new one and complete it right away.`,
      primaryActionLabel: `Get new ${channelLabel} link`,
      primaryActionDisabled: !input.isProductionReady,
    };
  }

  if (!input.isConfigured) {
    return {
      statusLabel: "Needs setup",
      statusTone: "warning" as const,
      detailLabel: "Before you connect",
      detailText:
        input.channel === BotChannel.TELEGRAM
          ? "Add a Telegram bot token and webhook secret to enable live Telegram linking."
          : "Add Twilio Account SID, Auth Token, and a WhatsApp-enabled sender to enable live WhatsApp linking.",
      primaryActionLabel: `Connect ${channelLabel}`,
      primaryActionDisabled: true,
    };
  }

  if (!input.publicAppUrlReady) {
    return {
      statusLabel: "Needs setup",
      statusTone: "warning" as const,
      detailLabel: "Before you connect",
      detailText:
        "Set APP_URL to a public HTTPS address first. Local relay is available below for engineering only.",
      primaryActionLabel: `Connect ${channelLabel}`,
      primaryActionDisabled: true,
    };
  }

  if (input.isProductionReady) {
    const sandboxNote =
      input.channel === BotChannel.WHATSAPP && input.isSandboxSender
        ? " Twilio sandbox senders also require the manager phone to join the sandbox first."
        : "";

    return {
      statusLabel: "Ready",
      statusTone: "info" as const,
      detailLabel: "Before you connect",
      detailText:
        input.channel === BotChannel.TELEGRAM
          ? input.supportsOneTap
            ? "Tap connect, approve Telegram access, and StockPilot will link this manager without the old bot-start step."
            : "Tap connect, then press Start in Telegram to link this manager chat."
          : `Tap connect, then send the prefilled WhatsApp message to link this manager chat.${sandboxNote}`,
      primaryActionLabel: `Connect ${channelLabel}`,
      primaryActionDisabled: false,
    };
  }

  return {
    statusLabel: "Needs setup",
    statusTone: "warning" as const,
    detailLabel: "Before you connect",
    detailText: "Finish the required setup above, then return here to connect the chat.",
    primaryActionLabel: `Connect ${channelLabel}`,
    primaryActionDisabled: true,
  };
}

function getLatestConnectIssue(
  events: Array<{
    action: string;
    createdAt: Date;
    details: Prisma.JsonValue;
  }>,
  channel: BotChannel
) {
  const match = events.find((event) => {
    const details =
      event.details && typeof event.details === "object" && !Array.isArray(event.details)
        ? (event.details as Record<string, Prisma.JsonValue>)
        : null;

    return details?.channel === channel;
  });

  if (!match) {
    return null;
  }

  const details =
    match.details && typeof match.details === "object" && !Array.isArray(match.details)
      ? (match.details as Record<string, Prisma.JsonValue>)
      : null;
  const detail =
    typeof details?.detail === "string" && details.detail.trim().length > 0 ? details.detail : null;

  return {
    status: match.action === "bot.connect_conflict" ? "conflict" : "expired",
    createdAt: match.createdAt,
    detail,
  } satisfies ConnectIssue;
}
