import {
  acknowledgeAlertAction,
  resolveAlertAction,
} from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { getAlertsPageData } from "@/modules/dashboard/queries";

export default async function AlertsPage() {
  const session = await requireSession(Role.SUPERVISOR);
  const alerts = await getAlertsPageData(session.locationId);

  const openAlerts = alerts.filter((a) => a.status === "OPEN").length;
  const acknowledgedAlerts = alerts.filter((a) => a.status === "ACKNOWLEDGED").length;
  const resolvedAlerts = alerts.filter((a) => a.status === "RESOLVED").length;

  return (
    <div className="space-y-10">
      {/* Header */}
      <section>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Alerts
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {openAlerts} open alert{openAlerts !== 1 ? "s" : ""}
        </h1>
        <p className="mt-2 text-muted-foreground">
          Low stock, sync issues, and missing counts that need attention.
        </p>
      </section>

      {/* Metrics */}
      <section className="grid grid-cols-3 gap-3">
        <MetricCard label="Open" value={openAlerts} highlight={openAlerts > 0 ? "warning" : undefined} />
        <MetricCard label="Acknowledged" value={acknowledgedAlerts} />
        <MetricCard label="Resolved" value={resolvedAlerts} />
      </section>

      {/* Alert list */}
      <section className="space-y-3">
        {alerts.length ? (
          alerts.map((alert) => (
            <div
              key={alert.id}
              className="rounded-xl border border-border/50 bg-card p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{alert.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{alert.message}</p>
                  {alert.inventoryItem && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Item: {alert.inventoryItem.name}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge
                    label={alert.severity === "CRITICAL" ? "Urgent" : alert.severity === "WARNING" ? "Watch" : "Info"}
                    tone={alert.severity === "CRITICAL" ? "critical" : alert.severity === "WARNING" ? "warning" : "info"}
                  />
                  <StatusBadge
                    label={alert.status === "OPEN" ? "Open" : alert.status === "ACKNOWLEDGED" ? "Seen" : "Resolved"}
                    tone={alert.status === "RESOLVED" ? "success" : "neutral"}
                  />
                </div>
              </div>

              {alert.notifications.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {alert.notifications.map((n) => (
                    <span key={n.id} className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                      {n.recipient}
                      <StatusBadge label={n.status} tone="info" />
                    </span>
                  ))}
                </div>
              )}

              {alert.status !== "RESOLVED" && (
                <div className="flex gap-2">
                  {alert.status === "OPEN" && (
                    <form action={acknowledgeAlertAction}>
                      <input type="hidden" name="alertId" value={alert.id} />
                      <Button type="submit" variant="outline" size="sm" className="h-8 text-xs">
                        Mark as seen
                      </Button>
                    </form>
                  )}
                  <form action={resolveAlertAction}>
                    <input type="hidden" name="alertId" value={alert.id} />
                    <Button type="submit" size="sm" className="h-8 text-xs">
                      Resolve
                    </Button>
                  </form>
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-border/50 px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">No alerts right now</p>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: "warning" | "critical";
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${
        highlight === "critical" ? "text-red-500" : highlight === "warning" ? "text-amber-500" : ""
      }`}>{value}</p>
    </div>
  );
}
