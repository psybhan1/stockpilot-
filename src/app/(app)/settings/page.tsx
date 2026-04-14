import type { ReactNode } from "react";
import { Cable, Settings2 } from "lucide-react";

import {
  connectSquareAction,
  disconnectEmailChannelAction,
  runJobsAction,
  startTelegramBotConnectAction,
  startWhatsAppBotConnectAction,
  syncSalesAction,
} from "@/app/actions/operations";
import { PageHero } from "@/components/app/page-hero";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
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
      <PageHero
        eyebrow="Settings"
        title="Integrations"
        subtitle="& channels."
        description="Connect your POS, notification channels, and automation tools."
      />

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

      {/* ─── Messaging ─── */}
      <Section title="Messaging" description="Alerts, reorder commands, and bot interactions">

        <BrandCard
          logo={<WhatsAppLogo />}
          name="WhatsApp"
          tagline={
            currentManager.phoneNumber
              ? `Connected as ${currentManager.phoneNumber}`
              : "Tap Connect — WhatsApp opens with the message ready to send"
          }
          status={currentManager.phoneNumber ? "Connected" : "Not connected"}
          statusTone={currentManager.phoneNumber ? "success" : "info"}
        >
          <form action={startWhatsAppBotConnectAction}>
            <Button type="submit" size="sm" className="h-9 gap-2 bg-[#25D366] hover:bg-[#1ebe5d] text-white text-xs border-0">
              <WhatsAppLogo size={14} />
              {currentManager.phoneNumber ? "Reconnect" : "Connect WhatsApp"}
            </Button>
          </form>
        </BrandCard>

        <BrandCard
          logo={<TelegramLogo />}
          name="Telegram"
          tagline={
            currentManager.telegramChatId
              ? `Connected as ${currentManager.telegramUsername ?? currentManager.telegramChatId}`
              : "Tap Connect — Telegram opens and links automatically"
          }
          status={currentManager.telegramChatId ? "Connected" : "Not connected"}
          statusTone={currentManager.telegramChatId ? "success" : "info"}
        >
          <form action={startTelegramBotConnectAction}>
            <Button type="submit" size="sm" className="h-9 gap-2 bg-[#2CA5E0] hover:bg-[#1d96d3] text-white text-xs border-0">
              <TelegramLogo size={14} />
              {currentManager.telegramChatId ? "Reconnect" : "Connect Telegram"}
            </Button>
          </form>
        </BrandCard>

        {/* Email */}
        <BrandCard
          logo={<GmailLogo />}
          name="Email"
          tagline={
            locationChannels.email
              ? `Sending from ${locationChannels.email.address ?? locationChannels.email.provider}`
              : "Connect Gmail to send order approval emails"
          }
          status={locationChannels.email ? "Connected" : "Not connected"}
          statusTone={locationChannels.email ? "success" : "info"}
        >
          {locationChannels.email ? (
            <form action={disconnectEmailChannelAction}>
              <input type="hidden" name="provider" value={locationChannels.email.provider} />
              <Button type="submit" variant="ghost" size="sm" className="h-9 text-xs text-muted-foreground">
                Disconnect
              </Button>
            </form>
          ) : (
            <a href="/api/auth/google/gmail">
              <Button size="sm" className="h-9 gap-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 text-xs shadow-sm">
                <GoogleLogo size={16} />
                Sign in with Google
              </Button>
            </a>
          )}
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

function GoogleLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
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
