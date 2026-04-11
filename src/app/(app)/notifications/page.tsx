import type { ReactNode } from "react";
import Link from "next/link";
import { BellRing, Mail, MessageSquareText, Smartphone } from "lucide-react";

import {
  queueTestNotificationAction,
  retryNotificationAction,
} from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Role } from "@/lib/domain-enums";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { NotificationChannel } from "@/lib/prisma";
import { requireSession } from "@/modules/auth/session";
import { getNotificationsPageData } from "@/modules/dashboard/queries";
import {
  getDefaultTestNotificationDraft,
  getSuggestedTestRecipient,
} from "@/modules/notifications/channels";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ queued?: string; error?: string }>;
}) {
  const session = await requireSession(Role.MANAGER);
  const params = await searchParams;
  const notifications = await getNotificationsPageData(session.locationId);

  const queuedCount = notifications.filter((notification) => notification.status === "QUEUED").length;
  const sentCount = notifications.filter((notification) => notification.status === "SENT").length;
  const failedCount = notifications.filter((notification) => notification.status === "FAILED").length;

  const channelForms = [
    {
      channel: NotificationChannel.EMAIL,
      icon: Mail,
      title: "Email",
      description: "Queue a real email through the current provider path.",
      readinessLabel:
        env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY ? "Live" : "Local",
      readinessTone:
        env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY ? "success" : "info",
      helper:
        env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY
          ? "Resend is configured, so this can reach a real inbox now."
          : "This still uses the local console email provider until Resend is connected.",
      recipientLabel: "Email address",
      recipientPlaceholder: "manager@example.com",
    },
    {
      channel: NotificationChannel.PUSH,
      icon: Smartphone,
      title: "Expo push",
      description: "Send directly to the Expo Push API with a real device token.",
      readinessLabel: env.EXPO_ACCESS_TOKEN ? "Live" : "Ready",
      readinessTone: "success" as const,
      helper: env.EXPO_ACCESS_TOKEN
        ? "Expo access token is configured for projects using enhanced push security."
        : "Expo can send without a server token unless your Expo project requires enhanced push security.",
      recipientLabel: "Expo push token",
      recipientPlaceholder: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    },
    {
      channel: NotificationChannel.WHATSAPP,
      icon: MessageSquareText,
      title: "Twilio WhatsApp",
      description: "Queue a real WhatsApp message through Twilio using an international number.",
      readinessLabel:
        env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM
          ? "Live"
          : "Missing creds",
      readinessTone:
        env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM
          ? "success"
          : "warning",
      helper:
        env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM
          ? `Twilio is configured and will send from ${env.TWILIO_WHATSAPP_FROM}.`
          : "Add Twilio account credentials and a WhatsApp-enabled sender to enable live delivery.",
      recipientLabel: "WhatsApp number",
      recipientPlaceholder: "+14155550123",
    },
  ] as const;

  const feedbackMessage = params.error
    ? {
        tone: "critical" as const,
        title: "Test notification not queued",
        body: params.error,
      }
    : params.queued
      ? {
          tone: "success" as const,
          title: "Test notification queued",
          body: `The ${params.queued} test is now in the worker queue and will show up below as it progresses.`,
        }
      : null;

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border-border/60 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(255,255,255,0.92))] shadow-xl shadow-black/5 dark:bg-[linear-gradient(135deg,rgba(68,64,60,0.98),rgba(28,25,23,0.94))]">
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.22em] text-amber-600 dark:text-amber-300">
              Notifications
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Send real tests without guessing what channel is ready.
            </h1>
            <p className="mt-3 text-base text-muted-foreground sm:text-lg">
              Email, Expo push, and Twilio WhatsApp all flow through the same StockPilot queue, so
              you can verify real delivery paths without leaving the app.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard label="Queued" value={queuedCount} />
            <MetricCard label="Sent" value={sentCount} />
            <MetricCard label="Failed" value={failedCount} />
          </div>
        </CardContent>
      </Card>

      {feedbackMessage ? (
        <Card className="rounded-[28px] border-border/60 bg-card/88 shadow-lg shadow-black/5">
          <CardContent className="flex items-start justify-between gap-4 p-5">
            <div>
              <p className="font-semibold">{feedbackMessage.title}</p>
              <p className="mt-2 text-sm text-muted-foreground">{feedbackMessage.body}</p>
            </div>
            <StatusBadge
              label={feedbackMessage.tone === "success" ? "Queued" : "Needs input"}
              tone={feedbackMessage.tone}
            />
          </CardContent>
        </Card>
      ) : null}

      <Panel
        title="Live channel checks"
        description="Each form uses the same queue and worker path as real manager notifications."
      >
        <div className="grid gap-4 xl:grid-cols-3">
          {channelForms.map((config) => {
            const defaultDraft = getDefaultTestNotificationDraft(config.channel);
            const suggestedRecipient = getSuggestedTestRecipient({
              channel: config.channel,
              sessionEmail: session.email,
              expoTestPushToken: env.EXPO_TEST_PUSH_TOKEN,
              twilioTestWhatsappTo: env.TWILIO_TEST_WHATSAPP_TO,
            });

            return (
              <ChannelCard
                key={config.channel}
                icon={config.icon}
                title={config.title}
                description={config.description}
                helper={config.helper}
                readinessLabel={config.readinessLabel}
                readinessTone={config.readinessTone}
                channel={config.channel}
                recipientLabel={config.recipientLabel}
                recipientPlaceholder={config.recipientPlaceholder}
                defaultRecipient={suggestedRecipient}
                defaultSubject={defaultDraft.subject}
                defaultBody={defaultDraft.body}
              />
            );
          })}
        </div>
      </Panel>

      <Panel
        title="Notification log"
        description="Open alerts stay linked, provider message IDs are tracked, and failures can be retried."
      >
        <div className="space-y-3">
          {notifications.length ? (
            notifications.map((notification) => {
              const failureSummary = readNotificationFailureSummary(notification.metadata);

              return (
                <Card
                  key={notification.id}
                  className="rounded-[24px] border-border/60 bg-background/80 shadow-sm"
                >
                  <CardContent className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <BellRing className="size-4" />
                          <p className="text-xs uppercase tracking-[0.16em]">
                            {notification.channel}
                          </p>
                        </div>
                        <p className="mt-3 font-medium">
                          {notification.subject ?? "No subject"}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {notification.recipient}
                        </p>
                      </div>
                      <StatusBadge
                        label={notification.status}
                        tone={
                          notification.status === "FAILED"
                            ? "critical"
                            : notification.status === "SENT"
                              ? "success"
                              : "warning"
                        }
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <InfoPill label="Created" value={formatDateTime(notification.createdAt)} />
                      <InfoPill
                        label="Delivered"
                        value={formatDateTime(notification.sentAt)}
                      />
                      <InfoPill
                        label="Provider ref"
                        value={notification.providerMessageId ?? "Waiting for provider"}
                      />
                      <InfoPill
                        label="Linked alert"
                        value={
                          notification.alert ? notification.alert.title : "System delivery"
                        }
                        href={notification.alert ? "/alerts" : undefined}
                      />
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        {notification.status === "SENT"
                          ? "Delivered successfully and recorded in the audit trail."
                          : notification.status === "FAILED"
                            ? failureSummary ??
                              "This delivery failed and can be retried after correcting the provider setup."
                            : "Waiting in the queue or with the external provider."}
                      </p>

                      {notification.status === "FAILED" ? (
                        <form action={retryNotificationAction}>
                          <input type="hidden" name="notificationId" value={notification.id} />
                          <Button type="submit" size="sm" variant="outline" className="rounded-full">
                            Retry
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          ) : (
            <EmptyState
              title="No notification activity yet"
              description="Test deliveries and live alerts will show up here."
            />
          )}
        </div>
      </Panel>
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

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[24px] border border-border/60 bg-background/85 p-4 shadow-lg shadow-black/5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function ChannelCard({
  icon: Icon,
  title,
  description,
  helper,
  readinessLabel,
  readinessTone,
  channel,
  recipientLabel,
  recipientPlaceholder,
  defaultRecipient,
  defaultSubject,
  defaultBody,
}: {
  icon: typeof Mail;
  title: string;
  description: string;
  helper: string;
  readinessLabel: string;
  readinessTone: "success" | "info" | "warning";
  channel: NotificationChannel;
  recipientLabel: string;
  recipientPlaceholder: string;
  defaultRecipient: string;
  defaultSubject: string;
  defaultBody: string;
}) {
  return (
    <div className="rounded-[24px] border border-border/60 bg-background/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Icon className="size-5 text-amber-600 dark:text-amber-300" />
          <p className="mt-4 font-semibold">{title}</p>
        </div>
        <StatusBadge label={readinessLabel} tone={readinessTone} />
      </div>

      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <p className="mt-2 text-sm text-muted-foreground">{helper}</p>

      <form action={queueTestNotificationAction} className="mt-4 space-y-3">
        <input type="hidden" name="channel" value={channel} />

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            {recipientLabel}
          </span>
          <Input
            name="recipient"
            defaultValue={defaultRecipient}
            placeholder={recipientPlaceholder}
            required
            className="h-10 rounded-2xl"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Subject
          </span>
          <Input
            name="subject"
            defaultValue={defaultSubject}
            className="h-10 rounded-2xl"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Message
          </span>
          <Textarea
            name="body"
            defaultValue={defaultBody}
            className="min-h-24 rounded-2xl"
          />
        </label>

        <Button
          type="submit"
          variant={channel === NotificationChannel.EMAIL ? "default" : "outline"}
          className="w-full rounded-2xl"
        >
          Queue live test
        </Button>
      </form>
    </div>
  );
}

function InfoPill({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card px-3 py-3">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      {href ? (
        <Link href={href} className="mt-1 block font-medium hover:underline">
          {value}
        </Link>
      ) : (
        <p className="mt-1 font-medium">{value}</p>
      )}
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

function readNotificationFailureSummary(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  if (typeof (metadata as Record<string, unknown>).error === "string") {
    return (metadata as Record<string, unknown>).error as string;
  }

  const errors = (metadata as Record<string, unknown>).errors;
  if (Array.isArray(errors) && typeof errors[0] === "string") {
    return errors[0];
  }

  return null;
}
