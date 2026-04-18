import type { ReactNode } from "react";
import Link from "next/link";
import { Cable, Settings2 } from "lucide-react";

import {
  connectGenericPosAction,
  connectResendEmailChannelAction,
  disconnectEmailChannelAction,
  rotatePosWebhookSecretAction,
  runJobsAction,
  sendTestEmailAction,
  sendTestPosSaleAction,
  sendTestTelegramAction,
  sendTestWhatsAppAction,
  startTelegramBotConnectAction,
  startWhatsAppBotConnectAction,
  syncSalesAction,
  updateAutoApproveThresholdAction,
} from "@/app/actions/operations";
import { CloverConnectButton } from "@/components/app/clover-connect-button";
import { PageHero } from "@/components/app/page-hero";
import { ShopifyConnectButton } from "@/components/app/shopify-connect-button";
import { SquareConnectButton } from "@/components/app/square-connect-button";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
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
  const { integration, jobs, emailProvider } = await getSettingsData(session.locationId);

  // All POS integrations for this location (Square, Toast, Clover,
  // Lightspeed, Shopify, Generic). Used to render one connect/status
  // row per brand in the POS section. Each non-Square row exposes
  // its webhook secret so the admin can paste it into the POS side.
  const posIntegrations = await db.posIntegration.findMany({
    where: { locationId: session.locationId },
    select: {
      id: true,
      provider: true,
      status: true,
      settings: true,
      lastSyncedAt: true,
      externalMerchantId: true,
    },
  });
  const webhookBaseUrl = `${env.APP_URL?.replace(/\/$/, "") ?? ""}/api/pos/webhook`;
  const posByProvider = Object.fromEntries(
    posIntegrations.map((p) => [p.provider, p])
  );

  // Per-integration "sales received" counts over the last 7 days so
  // the Settings UI can show a live health indicator next to each
  // POS row — a Zapier bridge that says "Connected" but hasn't
  // received anything is silently broken, and this tells the user.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentSaleCounts = await db.posSaleEvent.groupBy({
    by: ["integrationId"],
    where: { locationId: session.locationId, occurredAt: { gte: sevenDaysAgo } },
    _count: { _all: true },
  });
  const salesByIntegration = Object.fromEntries(
    recentSaleCounts.map((r) => [r.integrationId ?? "", r._count._all])
  );

  // Headline nudge: any unmapped webhook products waiting for a
  // mapping. Shows up once near the top of Settings so the user
  // never misses the work their POS has queued for them.
  const { getUnmappedPosProducts } = await import("@/modules/pos/unmapped");
  const unmappedPosProducts = await getUnmappedPosProducts(session.locationId);

  // Live Square token health — 3s timeout so Settings never hangs.
  // Surfaces on the Square row so "Connected but token's dead" is
  // visible; without this the row stays a happy green even as every
  // actual sync 401s.
  const { checkSquareHealth } = await import("@/modules/pos/health");
  const squareHealth = await checkSquareHealth(session.locationId).catch(
    () =>
      ({
        status: "unreachable" as const,
        reason: "health-check failed",
        checkedAt: new Date(),
      })
  );

  const [locationChannels, currentManager, locationSettings] = await Promise.all([
    getLocationChannels(session.locationId),
    db.user.findUniqueOrThrow({
      where: { id: session.userId },
      select: { phoneNumber: true, telegramChatId: true, telegramUsername: true },
    }),
    db.location.findUniqueOrThrow({
      where: { id: session.locationId },
      select: { autoApproveEmailUnderCents: true },
    }),
  ]);

  const autoApproveDollars =
    locationSettings.autoApproveEmailUnderCents != null
      ? (locationSettings.autoApproveEmailUnderCents / 100).toString()
      : "";

  // "Send PO emails" is ready whenever EITHER Gmail is connected OR
  // Resend is configured. New cafés hit Resend by default with zero
  // setup, so we show a green-ready state and keep the Gmail OAuth
  // button as an optional upgrade behind a disclosure — no scary
  // "Sign in with Google" prompt on first visit.
  const gmailConnected = locationChannels?.email?.provider === "gmail";
  const tenantResendConnected = locationChannels?.email?.provider === "resend";
  // Display string for Resend-connected rows: "Name <addr>".
  const emailSendingAs = (() => {
    if (emailProvider.name === "resend") {
      const addr = emailProvider.email?.match(/<([^>]+)>/)?.[1] ?? emailProvider.email ?? "";
      return emailProvider.displayName
        ? `${emailProvider.displayName} <${addr}>`
        : addr;
    }
    return null;
  })();

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
          {channelBanner.type === "connected" &&
            (channelBanner.detail || `${channelBanner.channel} connected successfully.`)}
          {channelBanner.type === "disconnected" &&
            (channelBanner.detail || `${channelBanner.channel} disconnected.`)}
          {channelBanner.type === "error" &&
            (channelBanner.detail || "Connection failed.")}
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

      {/* Integration health strip — at-a-glance view of every wire
          connecting the app to the outside world. A connected chip
          that hasn't fired anything lately is the worst kind of
          silent failure; this strip surfaces that by showing a live
          activity stat beside each channel. */}
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Integration health
        </p>
        <Link
          href="/settings/activity"
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          Activity log →
        </Link>
      </div>
      <section className="grid gap-2 rounded-2xl border border-border/50 bg-card/60 p-4 sm:grid-cols-2 md:grid-cols-4">
        <HealthChip
          label="Square"
          connected={posByProvider.SQUARE?.status === "CONNECTED"}
          activity={(() => {
            const c =
              salesByIntegration[posByProvider.SQUARE?.id ?? ""] ?? 0;
            return c > 0 ? `${c} sale${c === 1 ? "" : "s"} · 7d` : "no sales";
          })()}
        />
        <HealthChip
          label="Telegram"
          connected={Boolean(currentManager.telegramChatId)}
          activity={
            currentManager.telegramUsername
              ? currentManager.telegramUsername
              : currentManager.telegramChatId
                ? "paired"
                : "not paired"
          }
        />
        <HealthChip
          label="WhatsApp"
          connected={Boolean(currentManager.phoneNumber)}
          activity={currentManager.phoneNumber ?? "not paired"}
        />
        <HealthChip
          label="Email"
          connected={emailProvider.name !== "console"}
          activity={
            emailProvider.name === "gmail"
              ? "gmail auto-send"
              : emailProvider.name === "resend"
                ? "resend auto-send"
                : "tap-to-send"
          }
        />
      </section>

      {/* Unmapped-POS nudge — only renders when the webhook has
          queued products waiting for a mapping. Makes that work
          impossible to miss and is a click away from /pos-mapping. */}
      {unmappedPosProducts.length > 0 ? (
        <Link
          href="/pos-mapping"
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm hover:bg-amber-500/10"
        >
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-200">
              {unmappedPosProducts.length} POS product
              {unmappedPosProducts.length === 1 ? "" : "s"} need mapping
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Your POS is sending sales for SKUs we can&apos;t yet deplete —
              one-click wire each in /pos-mapping.
            </p>
          </div>
          <span className="font-mono text-xs">→ map now</span>
        </Link>
      ) : null}

      {/* ─── POS Integration ─── */}
      <Section
        title="POS"
        description="Point-of-sale connection — sales flow in and auto-deplete inventory."
      >
        {/* Square is the only POS with a real one-click OAuth today.
            We sync the catalog, AI-generate starter recipes, and
            auto-deplete inventory on every sale. Other POS vendors
            each need their own OAuth app registered with the vendor;
            those are in-progress and the generic webhook handles
            the long tail in the meantime. */}
        <BrandCard
          logo={<SquareLogo />}
          name="Square"
          tagline={(() => {
            const sqStatus = posByProvider.SQUARE?.status;
            if (sqStatus !== "CONNECTED") {
              return "One-click OAuth — catalog syncs, sales auto-deplete inventory.";
            }
            if (squareHealth.status === "token_dead") {
              return `Token rejected by Square (HTTP ${squareHealth.httpStatus}). Click Reconnect to re-auth.`;
            }
            if (squareHealth.status === "unreachable") {
              return `Couldn't reach Square's API (${squareHealth.reason}). Try again in a minute.`;
            }
            const count =
              salesByIntegration[posByProvider.SQUARE?.id ?? ""] ?? 0;
            return count > 0
              ? `Token live — ${count} sale${count === 1 ? "" : "s"} processed this week.`
              : "Token live — waiting for your first sale (or run 'Import sample sale').";
          })()}
          status={
            posByProvider.SQUARE?.status !== "CONNECTED"
              ? "Not connected"
              : squareHealth.status === "healthy"
                ? "Live"
                : squareHealth.status === "token_dead"
                  ? "Reconnect needed"
                  : "Checking…"
          }
          statusTone={
            posByProvider.SQUARE?.status !== "CONNECTED"
              ? "info"
              : squareHealth.status === "healthy"
                ? "success"
                : "warning"
          }
        >
          <div className="flex items-center gap-2">
            <Link
              href="/docs/square-setup"
              className="text-[11px] text-muted-foreground hover:text-foreground whitespace-nowrap"
            >
              Setup guide →
            </Link>
            <SquareConnectButton
              label={
                posByProvider.SQUARE?.status === "CONNECTED"
                  ? "Reconnect"
                  : "Connect Square"
              }
              className="h-9 gap-2 bg-[#3E4348] hover:bg-[#2d3136] text-white text-xs border-0"
              connected={posByProvider.SQUARE?.status === "CONNECTED"}
            />
          </div>
        </BrandCard>

        {/* Clover — same one-click OAuth path as Square. Each Clover
            merchant installs our app from clover.com, approves access,
            and we exchange the code for a per-merchant token via the
            /api/integrations/clover/callback endpoint. */}
        <BrandCard
          logo={<CloverLogo />}
          name="Clover"
          tagline={
            posByProvider.CLOVER?.status === "CONNECTED"
              ? `Connected — merchant ${posByProvider.CLOVER.externalMerchantId ?? "unknown"}.`
              : "One-click OAuth — catalog syncs, sales auto-deplete inventory."
          }
          status={
            posByProvider.CLOVER?.status === "CONNECTED"
              ? "Live"
              : "Not connected"
          }
          statusTone={
            posByProvider.CLOVER?.status === "CONNECTED" ? "success" : "info"
          }
        >
          <CloverConnectButton
            label={
              posByProvider.CLOVER?.status === "CONNECTED"
                ? "Reconnect"
                : "Connect Clover"
            }
            className="h-9 gap-2 bg-[#00B140] hover:bg-[#008f35] text-white text-xs border-0"
            connected={posByProvider.CLOVER?.status === "CONNECTED"}
          />
        </BrandCard>

        {/* Shopify POS — per-shop OAuth. Each merchant types their
            shop URL ({shop}.myshopify.com) before the OAuth popup
            can open; we build their personal authorize URL from it. */}
        <BrandCard
          logo={<ShopifyLogo />}
          name="Shopify POS"
          tagline={
            posByProvider.SHOPIFY?.status === "CONNECTED"
              ? `Connected — ${posByProvider.SHOPIFY.externalMerchantId ?? "shop"}.`
              : "One-click OAuth — catalog + sales auto-sync from any Shopify store."
          }
          status={
            posByProvider.SHOPIFY?.status === "CONNECTED"
              ? "Live"
              : "Not connected"
          }
          statusTone={
            posByProvider.SHOPIFY?.status === "CONNECTED" ? "success" : "info"
          }
        >
          <ShopifyConnectButton
            label={
              posByProvider.SHOPIFY?.status === "CONNECTED"
                ? "Reconnect"
                : "Connect Shopify"
            }
            className="h-9 gap-2 bg-[#96BF48] hover:bg-[#7aa03a] text-white text-xs border-0"
            connected={posByProvider.SHOPIFY?.status === "CONNECTED"}
            currentShopDomain={
              posByProvider.SHOPIFY?.externalMerchantId ?? null
            }
          />
        </BrandCard>

        {/* One row for every other POS. Honest framing: native
            one-click is coming; for now it's a Zapier bridge with a
            per-tenant webhook. Advanced users click to expand. */}
        {(() => {
          const otherProviders = [
            "TOAST",
            "LIGHTSPEED",
            "GENERIC_WEBHOOK",
          ] as const;
          const activeOther = otherProviders
            .map((p) => ({ provider: p, row: posByProvider[p] }))
            .filter((x) => x.row?.status === "CONNECTED");
          const any = activeOther.length > 0;
          return (
            <details className="rounded-xl border border-border/50 bg-card/60 px-5 py-3 text-sm group">
              <summary className="flex cursor-pointer items-center justify-between text-xs text-muted-foreground hover:text-foreground">
                <span>
                  Other POS (Toast · Lightspeed · other)
                </span>
                <span className="font-mono text-[10px]">
                  {any ? `${activeOther.length} connected` : "native OAuth in progress"}
                </span>
              </summary>
              <div className="mt-4 space-y-4 text-muted-foreground">
                <p className="text-xs">
                  Native one-click OAuth ships next for Toast (pending their
                  partner approval) and Lightspeed — each needs its own
                  OAuth app registered with the vendor.
                  Until those land, a 2-minute Zapier bridge gets any POS
                  forwarding sales to StockPilot with the same end result:
                  real sales land on your dashboard, inventory depletes
                  automatically.
                </p>
                <Link
                  href="/docs/pos-quickstart"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground hover:underline"
                >
                  Step-by-step Zapier walkthrough →
                </Link>
                <div className="grid gap-2 sm:grid-cols-2">
                  {otherProviders.map((provider) => {
                    const row = posByProvider[provider];
                    const connected = row?.status === "CONNECTED";
                    const label =
                      provider === "GENERIC_WEBHOOK"
                        ? "Custom / other POS"
                        : provider === "LIGHTSPEED"
                          ? "Lightspeed"
                          : provider.charAt(0) + provider.slice(1).toLowerCase();
                    return (
                      <form
                        key={provider}
                        action={connectGenericPosAction}
                        className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 px-3 py-2"
                      >
                        <input type="hidden" name="provider" value={provider} />
                        <span className="text-xs font-medium text-foreground">
                          {label}
                        </span>
                        <Button
                          type="submit"
                          size="sm"
                          variant={connected ? "ghost" : "outline"}
                          className="h-7 text-[11px]"
                        >
                          {connected ? "Rotate" : "Bridge via webhook"}
                        </Button>
                      </form>
                    );
                  })}
                </div>
                {activeOther.map(({ provider, row }) => {
                  const storedSecret =
                    row?.settings && typeof row.settings === "object"
                      ? (row.settings as Record<string, unknown>).webhookSecret
                      : null;
                  if (typeof storedSecret !== "string") return null;
                  return (
                    <div
                      key={provider}
                      className="rounded-lg border border-border/50 bg-muted/30 p-3 text-xs space-y-2"
                    >
                      <p className="font-semibold text-foreground">
                        {provider.replace("_", " ")} webhook
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 break-all rounded bg-muted/70 px-2 py-1 font-mono text-[10px]">
                          {webhookBaseUrl}
                        </code>
                        <CopyButton value={webhookBaseUrl} label="URL" />
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 break-all rounded bg-muted/70 px-2 py-1 font-mono text-[10px]">
                          Bearer {storedSecret}
                        </code>
                        <CopyButton
                          value={`Bearer ${storedSecret}`}
                          label="Header"
                        />
                      </div>
                      <p className="text-[10px]">
                        Zapier trigger → <em>Webhooks by Zapier → POST</em>.
                        JSON body with <code>lineItems[]</code> ·
                        <code> externalProductId</code> + <code> quantity</code>.
                        First sale creates a mapping alert; wire it once at{" "}
                        <Link href="/pos-mapping" className="underline">
                          /pos-mapping
                        </Link>
                        .
                      </p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <form action={sendTestPosSaleAction}>
                          <input
                            type="hidden"
                            name="integrationId"
                            value={row.id}
                          />
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px]"
                          >
                            Send test sale
                          </Button>
                        </form>
                        {(() => {
                          const zapierUrl =
                            provider === "TOAST"
                              ? "https://zapier.com/apps/toast/integrations/webhook"
                              : provider === "LIGHTSPEED"
                                ? "https://zapier.com/apps/lightspeed-retail/integrations/webhook"
                                : "https://zapier.com/app-directory";
                          return (
                            <a
                              href={zapierUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-7 items-center rounded-md border border-border/50 bg-background/50 px-2 text-[10px] font-medium hover:bg-muted"
                            >
                              Open Zapier →
                            </a>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })()}
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
          <div className="flex items-center gap-2">
            {currentManager.phoneNumber ? (
              <form action={sendTestWhatsAppAction}>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs"
                >
                  Send test
                </Button>
              </form>
            ) : null}
            <form action={startWhatsAppBotConnectAction}>
              <Button type="submit" size="sm" className="h-9 gap-2 bg-[#25D366] hover:bg-[#1ebe5d] text-white text-xs border-0">
                <WhatsAppLogo size={14} />
                {currentManager.phoneNumber ? "Reconnect" : "Connect WhatsApp"}
              </Button>
            </form>
          </div>
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
          <div className="flex items-center gap-2">
            {currentManager.telegramChatId ? (
              <form action={sendTestTelegramAction}>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs"
                >
                  Send test
                </Button>
              </form>
            ) : null}
            <form action={startTelegramBotConnectAction}>
              <Button type="submit" size="sm" className="h-9 gap-2 bg-[#2CA5E0] hover:bg-[#1d96d3] text-white text-xs border-0">
                <TelegramLogo size={14} />
                {currentManager.telegramChatId ? "Reconnect" : "Connect Telegram"}
              </Button>
            </form>
          </div>
        </BrandCard>

        <BrandCard
          logo={<GmailLogo />}
          name="Gmail"
          tagline={
            gmailConnected
              ? `Connected as ${locationChannels.email?.address ?? "your Gmail"}`
              : tenantResendConnected
                ? `Auto-send via Resend${emailSendingAs ? ` (${emailSendingAs})` : ""}`
                : "Tap Connect — POs send from your own Gmail automatically"
          }
          status={
            gmailConnected || tenantResendConnected ? "Connected" : "Not connected"
          }
          statusTone={
            gmailConnected || tenantResendConnected ? "success" : "info"
          }
        >
          {gmailConnected || tenantResendConnected ? (
            <div className="flex items-center gap-2">
              <form action={sendTestEmailAction}>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs"
                >
                  Send test
                </Button>
              </form>
              <form action={disconnectEmailChannelAction}>
                <input
                  type="hidden"
                  name="provider"
                  value={locationChannels.email!.provider}
                />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="h-9 text-xs text-muted-foreground"
                >
                  Disconnect
                </Button>
              </form>
            </div>
          ) : (
            <a href="/api/auth/google/gmail">
              <Button
                size="sm"
                className="h-9 gap-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 text-xs shadow-sm"
              >
                <GoogleLogo size={14} />
                Connect Gmail
              </Button>
            </a>
          )}
        </BrandCard>

        {!gmailConnected && !tenantResendConnected ? (
          <details className="rounded-xl border border-border/50 bg-card/60 px-5 py-3 text-sm">
            <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
              Alternative · auto-send via Resend API key
            </summary>
            <form
              action={connectResendEmailChannelAction}
              className="mt-3 space-y-3 text-muted-foreground"
            >
              <p className="text-[11px]">
                Free at 100 emails/day. Create a key at{" "}
                <a
                  href="https://resend.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  resend.com/api-keys
                </a>{" "}
                and paste it here.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="password"
                  name="apiKey"
                  required
                  placeholder="re_XXXXXXXX"
                  className="h-9 rounded-md border border-border/50 bg-background px-3 text-xs"
                />
                <input
                  type="email"
                  name="fromEmail"
                  required
                  placeholder="orders@yourcafe.com"
                  className="h-9 rounded-md border border-border/50 bg-background px-3 text-xs"
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[10px]">
                  Encrypted before storage. Never logged.
                </p>
                <Button type="submit" size="sm" className="h-8 text-xs">
                  Save
                </Button>
              </div>
            </form>
          </details>
        ) : null}
      </Section>

      {/* ─── Ordering automation ─── */}
      <Section
        title="Ordering"
        description="Let the bot send small email orders automatically, so you only get pinged for ones that matter."
      >
        <form
          action={updateAutoApproveThresholdAction}
          className="rounded-xl border border-border/50 bg-card p-5"
        >
          <label
            htmlFor="auto-approve-threshold"
            className="block text-sm font-semibold"
          >
            Auto-approve email orders under
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            When a bot-drafted order is to an email supplier (Sysco, local
            vendors…) and the total is at or under this cap, the bot sends
            it right away — no Telegram tap required. Leave blank to always
            require your approval.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <input
              id="auto-approve-threshold"
              name="thresholdDollars"
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              defaultValue={autoApproveDollars}
              placeholder="200"
              className="h-9 w-32 rounded-md border border-border/50 bg-background px-3 text-sm"
            />
            <Button type="submit" size="sm" className="h-9 text-xs">
              Save
            </Button>
            {autoApproveDollars && (
              <span className="text-xs text-muted-foreground">
                Currently: ${autoApproveDollars} cap
              </span>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Website orders (Amazon, Costco) always wait for your approval —
            auto-approve only applies to email suppliers.
          </p>
        </form>
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

function HealthChip({
  label,
  connected,
  activity,
}: {
  label: string;
  connected: boolean;
  activity: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
        connected
          ? "border-emerald-500/20 bg-emerald-500/5"
          : "border-border/50 bg-background/30"
      }`}
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold">{label}</p>
        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          {activity}
        </p>
      </div>
      <span
        className={`size-2 shrink-0 rounded-full ${
          connected ? "bg-emerald-500" : "bg-muted-foreground/40"
        }`}
        aria-hidden
      />
    </div>
  );
}

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

function CloverLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#00B140" />
      <path d="M12 6.5c-1 0-1.8.8-1.8 1.8 0 .2.02.4.07.58-.18-.05-.38-.08-.57-.08-1 0-1.8.8-1.8 1.8s.8 1.8 1.8 1.8c.2 0 .4-.03.57-.08-.05.18-.07.38-.07.57 0 1 .8 1.8 1.8 1.8s1.8-.8 1.8-1.8c0-.2-.03-.4-.08-.57.18.05.38.08.58.08 1 0 1.8-.8 1.8-1.8s-.8-1.8-1.8-1.8c-.2 0-.4.03-.58.08.05-.18.08-.38.08-.58 0-1-.8-1.8-1.8-1.8z" fill="white"/>
      <rect x="11.5" y="14.5" width="1" height="3" rx="0.5" fill="white" />
    </svg>
  );
}

function ShopifyLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#96BF48" />
      <path d="M15.8 7.7c-.02-.13-.13-.2-.22-.2-.1 0-1.88-.05-1.88-.05s-1.51-1.47-1.66-1.62c-.15-.15-.44-.1-.56-.06 0 0-.28.09-.76.24-.08-.26-.2-.57-.37-.89-.55-1.05-1.35-1.61-2.32-1.61h-.03c-.07 0-.14.01-.2.02l-.07-.08c-.42-.45-.97-.67-1.62-.65-1.26.04-2.51 1-3.52 2.71C3.07 6.73 2.5 8.34 2.33 9.59c-1.45.45-2.47.77-2.49.78-.74.23-.76.25-.85.95C-1.05 11.81.16 22 .16 22l8.85.16L15.9 22 15.8 7.7zm-2.95-.74l-.73.23c-.01-.57-.08-1.37-.35-2.06.85.16 1.27 1.13 1.43 1.58l-.35.25zm-1.3.4l-1.8.56c.17-.66.5-1.3 1.05-1.72.2-.16.43-.28.66-.35.27.54.33 1.3.09 1.51z" fill="white"/>
    </svg>
  );
}
