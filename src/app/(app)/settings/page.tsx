import type { ReactNode } from "react";
import { Cable, Settings2 } from "lucide-react";

import {
  connectSquareAction,
  connectSmtpEmailChannelAction,
  disconnectTelegramChannelAction,
  disconnectEmailChannelAction,
  generateTelegramChannelCodeAction,
  generateWhatsAppChannelCodeAction,
  disconnectWhatsAppChannelAction,
  runJobsAction,
  startTelegramBotConnectAction,
  startWhatsAppBotConnectAction,
  syncSalesAction,
} from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Role } from "@/lib/domain-enums";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
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

  const pairingCode =
    params.channelCode && (params.channel === "telegram" || params.channel === "whatsapp")
      ? {
          code: params.channelCode,
          channel: params.channel as "telegram" | "whatsapp",
          expiresAt: params.channelCodeExpiry ? new Date(params.channelCodeExpiry) : null,
        }
      : null;

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
        </div>
      )}

      {/* ─── POS Integration ─── */}
      <Section title="POS" description="Point-of-sale connection">
        <BrandCard
          logo={<SquareLogo />}
          name="Square"
          tagline="Sync sales and inventory from your Square register"
          status={integration?.status ?? "DISCONNECTED"}
          statusTone={integration?.status === "CONNECTED" ? "success" : "warning"}
        >
          <form action={connectSquareAction}>
            <Button
              type="submit"
              size="sm"
              className="h-9 gap-2 bg-[#3E4348] hover:bg-[#2d3136] text-white text-xs border-0"
            >
              <SquareLogo size={14} />
              {integration?.status === "CONNECTED" ? "Reconnect Square" : "Connect Square"}
            </Button>
          </form>
        </BrandCard>
      </Section>

      {/* ─── Notification Channels ─── */}
      <Section title="Channels" description="Where alerts and order approvals get delivered">

        {/* Telegram channel */}
        <BrandCard
          logo={<TelegramLogo />}
          name="Telegram"
          tagline={
            locationChannels.telegram?.enabled
              ? `Alerts sent to chat ${locationChannels.telegram.chatId}`
              : "Receive stock alerts and order updates in Telegram"
          }
          status={locationChannels.telegram?.enabled ? "Connected" : "Not connected"}
          statusTone={locationChannels.telegram?.enabled ? "success" : "info"}
        >
          <div className="flex gap-2">
            <form action={generateTelegramChannelCodeAction}>
              <Button
                type="submit"
                size="sm"
                className="h-9 gap-2 bg-[#2CA5E0] hover:bg-[#1d96d3] text-white text-xs border-0"
                disabled={!telegramTokenReady}
              >
                <TelegramLogo size={14} />
                {locationChannels.telegram?.enabled ? "Reconnect" : "Connect Telegram"}
              </Button>
            </form>
            {locationChannels.telegram?.enabled && (
              <form action={disconnectTelegramChannelAction}>
                <Button type="submit" variant="ghost" size="sm" className="h-9 text-xs text-muted-foreground">
                  Disconnect
                </Button>
              </form>
            )}
          </div>
        </BrandCard>

        {/* WhatsApp channel */}
        <BrandCard
          logo={<WhatsAppLogo />}
          name="WhatsApp"
          tagline={
            locationChannels.whatsapp?.enabled
              ? `Notifications sent to ${locationChannels.whatsapp.phone ?? "linked number"}`
              : env.TWILIO_WHATSAPP_FROM
                ? `Bot number: ${env.TWILIO_WHATSAPP_FROM}`
                : "Receive alerts as WhatsApp messages"
          }
          status={locationChannels.whatsapp?.enabled ? "Connected" : "Not connected"}
          statusTone={locationChannels.whatsapp?.enabled ? "success" : "info"}
        >
          <div className="flex gap-2">
            <form action={generateWhatsAppChannelCodeAction}>
              <Button
                type="submit"
                size="sm"
                className="h-9 gap-2 bg-[#25D366] hover:bg-[#1ebe5d] text-white text-xs border-0"
                disabled={!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_WHATSAPP_FROM || !publicAppUrlReady}
              >
                <WhatsAppLogo size={14} />
                {locationChannels.whatsapp?.enabled ? "Reconnect" : "Pair WhatsApp"}
              </Button>
            </form>
            {locationChannels.whatsapp?.enabled && (
              <form action={disconnectWhatsAppChannelAction}>
                <Button type="submit" variant="ghost" size="sm" className="h-9 text-xs text-muted-foreground">
                  Disconnect
                </Button>
              </form>
            )}
          </div>
        </BrandCard>

        {/* Email channel */}
        <BrandCard
          logo={<GmailLogo />}
          name="Email"
          tagline={
            locationChannels.email
              ? `Sending from ${locationChannels.email.address ?? locationChannels.email.provider}`
              : "Send order emails directly from your domain"
          }
          status={locationChannels.email ? `${locationChannels.email.provider.toUpperCase()} connected` : "Not connected"}
          statusTone={locationChannels.email ? "success" : "info"}
        >
          {locationChannels.email ? (
            <form action={disconnectEmailChannelAction}>
              <input type="hidden" name="provider" value={locationChannels.email.provider} />
              <Button type="submit" variant="ghost" size="sm" className="h-9 text-xs text-muted-foreground">
                Disconnect
              </Button>
            </form>
          ) : null}
        </BrandCard>

        {/* SMTP form — only when no email connected */}
        {!locationChannels.email && (
          <div className="rounded-xl border border-border/50 bg-card p-5">
            <div className="flex items-center gap-2 mb-1">
              <GmailLogo size={16} />
              <p className="text-sm font-medium">Connect via SMTP</p>
            </div>
            <p className="text-xs text-muted-foreground mb-4">Works with Gmail, Outlook, or any SMTP provider</p>
            <form action={connectSmtpEmailChannelAction} className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">SMTP host</label>
                <Input name="smtp_host" placeholder="smtp.gmail.com" className="h-9 text-sm" required />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Port</label>
                <Input name="smtp_port" type="number" defaultValue="587" className="h-9 text-sm" required />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Username / email</label>
                <Input name="smtp_user" type="email" placeholder="you@gmail.com" className="h-9 text-sm" required />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Password / app password</label>
                <Input name="smtp_pass" type="password" placeholder="••••••••" className="h-9 text-sm" required />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">From name (optional)</label>
                <Input name="smtp_from_name" placeholder="StockPilot" className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">From email</label>
                <Input name="smtp_from_email" type="email" placeholder="orders@yourdomain.com" className="h-9 text-sm" required />
              </div>
              <div className="sm:col-span-2 pt-1">
                <Button type="submit" size="sm" className="h-9 gap-2 text-xs">
                  <GmailLogo size={14} />
                  Connect email
                </Button>
              </div>
            </form>
          </div>
        )}
      </Section>

      {/* ─── Chat bot (user-level) ─── */}
      <Section title="Chat bot" description="Your personal bot — get alerts and send reorder commands">

        {/* WhatsApp bot */}
        <BrandCard
          logo={<WhatsAppLogo />}
          name="WhatsApp"
          tagline={
            currentManager.phoneNumber
              ? `Linked to ${currentManager.phoneNumber}`
              : "Opens WhatsApp with the connect message pre-filled — just tap Send"
          }
          status={currentManager.phoneNumber ? "Linked" : "Not linked"}
          statusTone={currentManager.phoneNumber ? "success" : "info"}
        >
          <form action={startWhatsAppBotConnectAction}>
            <Button
              type="submit"
              size="sm"
              className="h-9 gap-2 bg-[#25D366] hover:bg-[#1ebe5d] text-white text-xs border-0"
              disabled={!env.TWILIO_WHATSAPP_FROM}
            >
              <WhatsAppLogo size={14} />
              {currentManager.phoneNumber ? "Relink WhatsApp" : "Connect on WhatsApp"}
            </Button>
          </form>
        </BrandCard>

        {/* Telegram bot */}
        <BrandCard
          logo={<TelegramLogo />}
          name="Telegram"
          tagline={
            currentManager.telegramChatId
              ? `Linked as ${currentManager.telegramUsername ?? currentManager.telegramChatId}`
              : "Opens Telegram and starts the bot — one tap to link"
          }
          status={currentManager.telegramChatId ? "Linked" : "Not linked"}
          statusTone={currentManager.telegramChatId ? "success" : "info"}
        >
          <form action={startTelegramBotConnectAction}>
            <Button
              type="submit"
              size="sm"
              className="h-9 gap-2 bg-[#2CA5E0] hover:bg-[#1d96d3] text-white text-xs border-0"
              disabled={!telegramTokenReady || !publicAppUrlReady}
            >
              <TelegramLogo size={14} />
              {currentManager.telegramChatId ? "Relink Telegram" : "Connect on Telegram"}
            </Button>
          </form>
        </BrandCard>
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

/* ─── Layout helpers ─── */

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

function BrandCard({
  logo,
  name,
  tagline,
  status,
  statusTone = "info",
  children,
}: {
  logo: ReactNode;
  name: string;
  tagline: string;
  status: string;
  statusTone?: "success" | "info" | "warning" | "critical";
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-card px-5 py-4">
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-background">
          {logo}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{name}</p>
            <StatusBadge label={status} tone={statusTone} />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{tagline}</p>
        </div>
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

/* ─── Brand SVG logos ─── */

function WhatsAppLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2C6.477 2 2 6.477 2 12c0 1.89.527 3.656 1.438 5.168L2 22l4.975-1.395A9.953 9.953 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"
        fill="#25D366"
      />
      <path
        d="M17.006 14.698c-.274-.137-1.622-.8-1.873-.891-.25-.092-.433-.137-.616.137-.182.274-.707.891-.867 1.074-.16.182-.32.205-.593.069-.274-.137-1.156-.426-2.202-1.358-.814-.726-1.364-1.622-1.524-1.896-.16-.274-.017-.422.12-.558.124-.124.274-.32.411-.48.137-.16.182-.274.274-.457.091-.182.046-.343-.023-.48-.069-.137-.616-1.484-.844-2.032-.222-.534-.448-.462-.616-.47l-.525-.01c-.182 0-.48.069-.731.343-.25.274-.959.937-.959 2.285 0 1.347.982 2.649 1.119 2.831.137.182 1.933 2.95 4.684 4.137.654.283 1.165.452 1.564.578.657.208 1.255.179 1.728.109.527-.079 1.622-.663 1.851-1.304.228-.64.228-1.19.16-1.304-.069-.113-.25-.182-.525-.32z"
        fill="white"
      />
    </svg>
  );
}

function TelegramLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" fill="#2CA5E0" />
      <path
        d="M17.726 7.538l-2.09 9.86c-.157.7-.569.873-1.154.543l-3.2-2.358-1.544 1.486c-.17.17-.313.314-.642.314l.228-3.256 5.931-5.358c.258-.228-.056-.355-.4-.127L7.02 13.668l-3.15-.984c-.685-.214-.699-.685.143-1.015l12.3-4.742c.571-.213 1.07.128.413 1.611z"
        fill="white"
      />
    </svg>
  );
}

function GmailLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 6a2 2 0 012-2h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" fill="#EA4335" />
      <path d="M2 6l10 7 10-7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2 6v12l6-6M22 6v12l-6-6" fill="white" fillOpacity="0.15" />
      <path
        d="M2 6l10 7 10-7V6L12 13 2 6z"
        fill="#FBBC05"
        fillOpacity="0"
      />
    </svg>
  );
}

function SquareLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#3E4348" />
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="white" />
    </svg>
  );
}
