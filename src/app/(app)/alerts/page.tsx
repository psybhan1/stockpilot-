import { BellRing, CheckCheck, TriangleAlert } from "lucide-react";

import {
  acknowledgeAlertAction,
  resolveAlertAction,
} from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { getAlertsPageData } from "@/modules/dashboard/queries";

export default async function AlertsPage() {
  const session = await requireSession(Role.SUPERVISOR);
  const alerts = await getAlertsPageData(session.locationId);

  const openAlerts = alerts.filter((alert) => alert.status === "OPEN").length;
  const acknowledgedAlerts = alerts.filter(
    (alert) => alert.status === "ACKNOWLEDGED"
  ).length;
  const resolvedAlerts = alerts.filter((alert) => alert.status === "RESOLVED").length;

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border-border/60 bg-[linear-gradient(135deg,rgba(41,37,36,0.98),rgba(87,83,78,0.96))] text-white shadow-2xl shadow-black/10">
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.22em] text-white/60">Alerts</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Keep the queue calm by handling the few things that actually need attention.
            </h1>
            <p className="mt-3 text-base text-white/70 sm:text-lg">
              Low stock, missing counts, recipe gaps, and sync problems all land here with a clear
              next step.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard label="Open now" value={openAlerts} />
            <MetricCard label="Acknowledged" value={acknowledgedAlerts} />
            <MetricCard label="Resolved" value={resolvedAlerts} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {alerts.length ? (
          alerts.map((alert) => (
            <Card
              key={alert.id}
              className="rounded-[28px] border-border/60 bg-card/88 shadow-lg shadow-black/5"
            >
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <BellRing className="size-4" />
                      <p className="text-xs uppercase tracking-[0.16em]">
                        {alert.inventoryItem?.name ?? "System alert"}
                      </p>
                    </div>
                    <h2 className="mt-3 text-lg font-semibold">{alert.title}</h2>
                    <p className="mt-2 text-sm text-muted-foreground">{alert.message}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <StatusBadge
                      label={
                        alert.severity === "CRITICAL"
                          ? "Urgent"
                          : alert.severity === "WARNING"
                            ? "Watch"
                            : "Info"
                      }
                      tone={
                        alert.severity === "CRITICAL"
                          ? "critical"
                          : alert.severity === "WARNING"
                            ? "warning"
                            : "info"
                      }
                    />
                    <StatusBadge
                      label={
                        alert.status === "OPEN"
                          ? "Open"
                          : alert.status === "ACKNOWLEDGED"
                            ? "Seen"
                            : "Resolved"
                      }
                      tone={alert.status === "RESOLVED" ? "success" : "neutral"}
                    />
                  </div>
                </div>

                {alert.notifications.length ? (
                  <div className="rounded-[24px] border border-border/60 bg-background/80 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Notifications sent
                    </p>
                    <div className="mt-3 space-y-2">
                      {alert.notifications.map((notification) => (
                        <div
                          key={notification.id}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-3 py-2"
                        >
                          <span className="truncate text-sm">{notification.recipient}</span>
                          <StatusBadge label={notification.status} tone="info" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {alert.status !== "RESOLVED" ? (
                  <div className="flex flex-wrap gap-2">
                    {alert.status === "OPEN" ? (
                      <form action={acknowledgeAlertAction}>
                        <input type="hidden" name="alertId" value={alert.id} />
                        <Button type="submit" variant="outline" className="rounded-full">
                          <TriangleAlert data-icon="inline-start" />
                          Mark as seen
                        </Button>
                      </form>
                    ) : null}
                    <form action={resolveAlertAction}>
                      <input type="hidden" name="alertId" value={alert.id} />
                      <Button type="submit" className="rounded-full">
                        <CheckCheck data-icon="inline-start" />
                        Resolve
                      </Button>
                    </form>
                  </div>
                ) : (
                  <div className="rounded-[24px] border border-border/60 bg-background/75 p-4 text-sm text-muted-foreground">
                    This alert has already been resolved.
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="rounded-[28px] border-dashed border-border/60 bg-card/70">
            <CardContent className="px-6 py-10 text-center">
              <p className="font-medium">No alerts right now</p>
              <p className="mt-2 text-sm text-muted-foreground">
                New inventory, sync, or recipe issues will appear here when they need attention.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
      <p className="text-sm text-white/65">{label}</p>
      <p className="mt-3 text-4xl font-semibold">{value}</p>
    </div>
  );
}
