import type { ReactNode } from "react";
import Link from "next/link";
import { Mail, MessageSquareText, Smartphone } from "lucide-react";

import {
  queueTestNotificationAction,
  retryNotificationAction,
} from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
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

  const queuedCount = notifications.filter((n) => n.status === "QUEUED").length;
  const sentCount = notifications.filter((n) => n.status === "SENT").length;
  const failedCount = notifications.filter((n) => n.status === "FAILED").length;

  const channelForms = [
    {
      channel: NotificationChannel.EMAIL,
      icon: Mail,
      title: "Email",
      readinessLabel: env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY ? "Live" : "Local",
      readinessTone: (env.DEFAULT_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY ? "success" : "info") as "success" | "info" | "warning",
      recipientLabel: "Email address",
      recipientPlaceholder: "manager@example.com",
    },
    {
      channel: NotificationChannel.PUSH,
      icon: Smartphone,
      title: "Expo push",
      readinessLabel: env.EXPO_ACCESS_TOKEN ? "Live" : "Ready",
      readinessTone: "success" as const,
      recipientLabel: "Push token",
      recipientPlaceholder: "ExponentPushToken[xxx]",
    },
    {
      channel: NotificationChannel.WHATSAPP,
      icon: MessageSquareText,
      title: "WhatsApp",
      readinessLabel: env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM ? "Live" : "Missing creds",
      readinessTone: (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM ? "success" : "warning") as "success" | "info" | "warning",
      recipientLabel: "WhatsApp number",
      recipientPlaceholder: "+14155550123",
    },
  ] as const;

  const feedbackMessage = params.error
    ? { tone: "critical" as const, text: params.error }
    : params.queued
      ? { tone: "success" as const, text: `${params.queued} test queued successfully` }
      : null;

  return (
    <div className="space-y-10">
      {/* Header */}
      <section>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Notifications
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Delivery channels
        </h1>
        <p className="mt-2 text-muted-foreground">
          Test and monitor email, push, and WhatsApp delivery.
        </p>
      </section>

      {/* Metrics */}
      <section className="grid grid-cols-3 gap-3">
        <MetricCard label="Queued" value={queuedCount} />
        <MetricCard label="Sent" value={sentCount} />
        <MetricCard label="Failed" value={failedCount} highlight={failedCount > 0 ? "critical" : undefined} />
      </section>

      {/* Feedback banner */}
      {feedbackMessage && (
        <div className={`rounded-xl border p-4 text-sm ${
          feedbackMessage.tone === "success"
            ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
            : "border-red-500/20 bg-red-500/5 text-red-600 dark:text-red-400"
        }`}>
          {feedbackMessage.text}
        </div>
      )}

      {/* Channel test forms */}
      <Section title="Test channels" description="Send live test notifications through each provider">
        <div className="grid gap-3 lg:grid-cols-3">
          {channelForms.map((config) => {
            const draft = getDefaultTestNotificationDraft(config.channel);
            const recipient = getSuggestedTestRecipient({
              channel: config.channel,
              sessionEmail: session.email,
              expoTestPushToken: env.EXPO_TEST_PUSH_TOKEN,
              twilioTestWhatsappTo: env.TWILIO_TEST_WHATSAPP_TO,
            });

            return (
              <div key={config.channel} className="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <config.icon className="size-4 text-primary" />
                    <p className="text-sm font-medium">{config.title}</p>
                  </div>
                  <StatusBadge label={config.readinessLabel} tone={config.readinessTone} />
                </div>

                <form action={queueTestNotificationAction} className="space-y-2">
                  <input type="hidden" name="channel" value={config.channel} />
                  <Input name="recipient" defaultValue={recipient} placeholder={config.recipientPlaceholder} required className="h-8 text-xs" />
                  <Input name="subject" defaultValue={draft.subject} className="h-8 text-xs" />
                  <Textarea name="body" defaultValue={draft.body} className="min-h-16 text-xs" />
                  <Button type="submit" size="sm" variant="outline" className="h-8 w-full text-xs">
                    Send test
                  </Button>
                </form>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Notification log */}
      <Section title="Notification log" description="Delivery history with provider references and retry controls">
        <div className="space-y-2">
          {notifications.length ? (
            notifications.map((notification) => {
              const failureSummary = readFailureSummary(notification.metadata);

              return (
                <div key={notification.id} className="rounded-xl border border-border/50 bg-card p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{notification.subject ?? "No subject"}</p>
                        <span className="text-xs text-muted-foreground">{notification.channel}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{notification.recipient}</p>
                    </div>
                    <StatusBadge
                      label={notification.status}
                      tone={notification.status === "FAILED" ? "critical" : notification.status === "SENT" ? "success" : "warning"}
                    />
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    <span>Created {formatDateTime(notification.createdAt)}</span>
                    {notification.sentAt && <span>Sent {formatDateTime(notification.sentAt)}</span>}
                    {notification.providerMessageId && <span>Ref: {notification.providerMessageId}</span>}
                    {notification.alert && (
                      <Link href="/alerts" className="hover:underline">Alert: {notification.alert.title}</Link>
                    )}
                  </div>

                  {notification.status === "FAILED" && (
                    <div className="flex items-center gap-3">
                      {failureSummary && <p className="text-xs text-red-500 dark:text-red-400">{failureSummary}</p>}
                      <form action={retryNotificationAction}>
                        <input type="hidden" name="notificationId" value={notification.id} />
                        <Button type="submit" size="sm" variant="outline" className="h-7 text-xs">
                          Retry
                        </Button>
                      </form>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-border/50 px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">No notification activity yet</p>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function MetricCard({ label, value, highlight }: { label: string; value: number; highlight?: "warning" | "critical" }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${
        highlight === "critical" ? "text-red-500" : highlight === "warning" ? "text-amber-500" : ""
      }`}>{value}</p>
    </div>
  );
}

function readFailureSummary(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  if (typeof (metadata as Record<string, unknown>).error === "string") return (metadata as Record<string, unknown>).error as string;
  const errors = (metadata as Record<string, unknown>).errors;
  if (Array.isArray(errors) && typeof errors[0] === "string") return errors[0];
  return null;
}
