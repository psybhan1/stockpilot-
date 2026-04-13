import type { ReactNode } from "react";
import { Cable, Mail, MessageCircle, Phone, Send, Settings2, Smartphone, Wifi } from "lucide-react";

import {
  connectSquareAction,
  connectSmtpEmailChannelAction,
  disconnectBotChannelAction,
  disconnectTelegramChannelAction,
  disconnectEmailChannelAction,
  generateTelegramChannelCodeAction,
  generateWhatsAppChannelCodeAction,
  disconnectWhatsAppChannelAction,
  runJobsAction,
  startTelegramBotConnectAction,
  startWhatsAppBotConnectAction,
  syncSalesAction,
  updateBotIdentityAction,
} from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Role } from "@/lib/domain-enums";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { BotChannel } from "@/lib/prisma";
import { db } from "@/lib/db";
import { requireSession } from "@/modules/auth/session";
import { getSettingsData } from "@/modules/dashboard/queries";
import { isPublicAppUrl } from "@/modules/operator-bot/connect";
import { getLocationChannels } from "@/modules/channels/service";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    square?: string;
    reason?: string;
    channelCode?: string;
    channelCodeExpiry?: string;
    channel?: string;
    channelConnect?: string;
    channelType?: string;
    channelDetail?: string;
    [key: string]: string | undefined;
  }>;
}) {
  const session = await requireSession(Role.MANAGER);
  const params = await searchParams;
  const { integration, jobs } = await getSettingsData(session.locationId);

  const [locationChannels, currentManager] = await Promise.all([
    getLocationChannels(session.locationId),
    db.user.findUniqueOrThrow({
      where: { id: session.userId },
      select: { phoneNumber: true, telegramChatId: true, telegramUsername: true },
    }),
  ]);

  const telegramTokenReady = Boolean(env.TELEGRAM_BOT_TOKEN);
  const publicAppUrlReady = isPublicAppUrl(env.APP_URL);

  // Pairing code from URL (after generating) — telegram or whatsapp
  const pairingCode =
    params.channelCode && (params.channel === "telegram" || params.channel === "whatsapp")
      ? {
          code: params.channelCode,
          channel: params.channel as "telegram" | "whatsapp",
          expiresAt: params.channelCodeExpiry ? new Date(params.channelCodeExpiry) : null,
        }
      : null;

  // Banner after channel connect/disconnect
  const channelBanner = params.channelConnect
    ? {
        type: params.channelConnect as "connected" | "disconnected" | "error",
        channel: params.channelType ?? "",
        detail: params.channelDetail ?? "",
      }
    : null;

  return (
    <div className="space-y-10">
      {/* ─── Header ─── */}
      <section>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Settings
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Integrations & channels
        </h1>
        <p className="mt-2 text-muted-foreground">
          Connect your POS, notification channels, and automation tools.
        </p>
      </section>

      {/* ─── Banners ─── */}
      {channelBanner && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            channelBanner.type === "connected"
              ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
              : channelBanner.type === "error"
                ? "border-red-500/20 bg-red-500/5 text-red-600 dark:text-red-400"
                : "border-border/50 bg-muted/30 text-muted-foreground"
          }`}
        >
          {channelBanner.type === "connected" && `${channelBanner.channel} connected successfully.`}
          {channelBanner.type === "disconnected" && `${channelBanner.channel} disconnected.`}
          {channelBanner.type === "error" && (channelBanner.detail || "Connection failed.")}
        </div>
      )}

      {pairingCode && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            {pairingCode.channel === "whatsapp"
              ? `Send this code to your WhatsApp bot number (${env.TWILIO_WHATSAPP_FROM ?? "configured number"})`
              : "Send this code to your Telegram bot"}
          </p>
          <p className="mt-3 font-mono text-3xl font-bold tracking-[0.15em] text-primary">
            {pairingCode.code}
          </p>
          {pairingCode.expiresAt && (
            <p className="mt-2 text-xs text-muted-foreground">
              Expires {formatDateTime(pairingCode.expiresAt)}
            </p>
          )}
          {pairingCode.channel === "whatsapp" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Open WhatsApp, message the bot number exactly: <span className="font-mono font-semibold">{pairingCode.code}</span>
            </p>
          )}
        </div>
      )}

      {/* ─── POS Integration ─── */}
      <Section title="POS" description="Point-of-sale connection">
        <SettingRow
          icon={Cable}
          title="Square"
          status={integration?.status ?? "DISCONNECTED"}
          statusTone={integration?.status === "CONNECTED" ? "success" : "warning"}
        >
          <form action={connectSquareAction}>
            <Button type="submit" variant="outline" size="sm" className="h-8 text-xs">
              {integration?.status === "CONNECTED" ? "Reconnect" : "Connect"}
            </Button>
          </form>
        </SettingRow>
      </Section>

      {/* ─── Notification Channels ─── */}
      <Section title="Channels" description="Where alerts and order approvals get delivered">
        {/* Telegram (location-level) */}
        <SettingRow
          icon={Send}
          title="Telegram"
          status={locationChannels.telegram?.enabled ? "Connected" : "Not connected"}
          statusTone={locationChannels.telegram?.enabled ? "success" : "info"}
          detail={
            locationChannels.telegram?.enabled
              ? `Chat ${locationChannels.telegram.chatId}`
              : undefined
          }
        >
          <div className="flex gap-2">
            <form action={generateTelegramChannelCodeAction}>
              <Button type="submit" variant="outline" size="sm" className="h-8 text-xs">
                {locationChannels.telegram?.enabled ? "Reconnect" : "Pair"}
              </Button>
            </form>
            {locationChannels.telegram?.enabled && (
              <form action={disconnectTelegramChannelAction}>
                <Button type="submit" variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground">
                  Disconnect
                </Button>
              </form>
            )}
          </div>
        </SettingRow>

        {/* WhatsApp (location-level) */}
        <SettingRow
          icon={Smartphone}
          title="WhatsApp"
          status={locationChannels.whatsapp?.enabled ? "Connected" : "Not connected"}
          statusTone={locationChannels.whatsapp?.enabled ? "success" : "info"}
          detail={
            locationChannels.whatsapp?.enabled
              ? locationChannels.whatsapp.phone ?? undefined
              : env.TWILIO_WHATSAPP_FROM
                ? `Bot number: ${env.TWILIO_WHATSAPP_FROM}`
                : "Twilio not configured"
          }
        >
          <div className="flex gap-2">
            <form action={generateWhatsAppChannelCodeAction}>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_WHATSAPP_FROM || !publicAppUrlReady}
              >
                {locationChannels.whatsapp?.enabled ? "Reconnect" : "Pair"}
              </Button>
            </form>
            {locationChannels.whatsapp?.enabled && (
              <form action={disconnectWhatsAppChannelAction}>
                <Button type="submit" variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground">
                  Disconnect
                </Button>
              </form>
            )}
          </div>
        </SettingRow>

        {/* Email */}
        <SettingRow
          icon={Mail}
          title="Email"
          status={
            locationChannels.email
              ? `${locationChannels.email.provider.toUpperCase()}`
              : "Not connected"
          }
          statusTone={locationChannels.email ? "success" : "info"}
          detail={locationChannels.email?.address ?? undefined}
        >
          {locationChannels.email ? (
            <form action={disconnectEmailChannelAction}>
              <input type="hidden" name="provider" value={locationChannels.email.provider} />
              <Button type="submit" variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground">
                Disconnect
              </Button>
            </form>
          ) : null}
        </SettingRow>

        {/* SMTP form (only if no email connected) */}
        {!locationChannels.email && (
          <div className="rounded-xl border border-border/50 bg-card p-5">
            <p className="text-sm font-medium">Connect SMTP email</p>
            <p className="mt-1 text-xs text-muted-foreground">Send order emails directly from your domain</p>
            <form action={connectSmtpEmailChannelAction} className="mt-4 grid gap-3 sm:grid-cols-2">
              <Input name="smtp_host" placeholder="smtp.gmail.com" className="h-9 text-sm" required />
              <Input name="smtp_port" type="number" defaultValue="587" placeholder="Port" className="h-9 text-sm" required />
              <Input name="smtp_user" type="email" placeholder="you@domain.com" className="h-9 text-sm" required />
              <Input name="smtp_pass" type="password" placeholder="Password" className="h-9 text-sm" required />
              <Input name="smtp_from_name" placeholder="From name" className="h-9 text-sm" />
              <Input name="smtp_from_email" type="email" placeholder="From email" className="h-9 text-sm" required />
              <div className="sm:col-span-2">
                <Button type="submit" size="sm" className="h-8 text-xs">
                  Connect
                </Button>
              </div>
            </form>
          </div>
        )}
      </Section>

      {/* ─── Bot Connections (user-level) ─── */}
      <Section title="Chat bot" description="Personal bot link for your account">
        {/* WhatsApp one-click connect card */}
        <div className="rounded-xl border border-border/50 bg-card px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Phone className="size-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">WhatsApp</p>
                  <StatusBadge
                    label={currentManager.phoneNumber ? "Linked" : "Not linked"}
                    tone={currentManager.phoneNumber ? "success" : "info"}
                  />
                </div>
                {currentManager.phoneNumber ? (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{currentManager.phoneNumber}</p>
                ) : (
                  <p className="mt-0.5 text-xs text-muted-foreground">Tap the button — WhatsApp opens with the message ready to send</p>
                )}
              </div>
            </div>
            <form action={startWhatsAppBotConnectAction} className="shrink-0">
              <Button
                type="submit"
                size="sm"
                className="h-8 text-xs bg-[#25D366] hover:bg-[#1ebe5d] text-white border-0"
                disabled={!env.TWILIO_WHATSAPP_FROM}
              >
                {currentManager.phoneNumber ? "Relink WhatsApp" : "Connect WhatsApp"}
              </Button>
            </form>
          </div>
        </div>

        <SettingRow
          icon={MessageCircle}
          title="Telegram bot"
          status={currentManager.telegramChatId ? "Linked" : "Not linked"}
          statusTone={currentManager.telegramChatId ? "success" : "info"}
          detail={currentManager.telegramUsername ?? currentManager.telegramChatId ?? undefined}
        >
          <form action={startTelegramBotConnectAction}>
            <Button type="submit" variant="outline" size="sm" className="h-8 text-xs"
              disabled={!telegramTokenReady || !publicAppUrlReady}>
              {currentManager.telegramChatId ? "Relink" : "Connect"}
            </Button>
          </form>
        </SettingRow>
      </Section>

      {/* ─── System ─── */}
      <Section title="System" description="Background jobs and maintenance">
        <div className="flex flex-wrap gap-2">
          <form action={syncSalesAction}>
            <Button type="submit" variant="outline" size="sm" className="h-8 text-xs">
              Import sample sale
            </Button>
          </form>
          <form action={runJobsAction}>
            <Button type="submit" variant="outline" size="sm" className="h-8 text-xs">
              Run queued jobs
            </Button>
          </form>
        </div>
        {jobs.length > 0 && (
          <div className="mt-3 space-y-2">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between rounded-lg border border-border/50 bg-card px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{job.type}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(job.createdAt)}</p>
                </div>
                <StatusBadge label={job.status} tone="info" />
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ─── Layout components ─── */

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function SettingRow({
  icon: Icon,
  title,
  status,
  statusTone = "info",
  detail,
  children,
}: {
  icon: typeof Settings2;
  title: string;
  status: string;
  statusTone?: "success" | "info" | "warning" | "critical";
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-card px-5 py-4">
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="size-4 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{title}</p>
            <StatusBadge label={status} tone={statusTone} />
          </div>
          {detail && <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>}
        </div>
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}
