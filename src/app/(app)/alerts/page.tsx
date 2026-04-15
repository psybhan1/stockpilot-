import {
  acknowledgeAlertAction,
  resolveAlertAction,
} from "@/app/actions/operations";
import { PageHero } from "@/components/app/page-hero";
import { PendingButton } from "@/components/app/pending-button";
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
      <PageHero
        eyebrow="Alerts"
        title={openAlerts === 1 ? "One open alert" : `${openAlerts} open alerts`}
        subtitle="attention required."
        description="Low stock, sync issues, and missing counts that need attention."
        stats={[
          { label: "Open", value: String(openAlerts).padStart(2, "0"), highlight: openAlerts > 0 },
          { label: "Acknowledged", value: String(acknowledgedAlerts).padStart(2, "0") },
          { label: "Resolved", value: String(resolvedAlerts).padStart(2, "0") },
        ]}
      />

      {/* Alert list — brutalist treatment */}
      <section className="space-y-3">
        {alerts.length ? (
          alerts.map((alert, i) => (
            <div
              key={alert.id}
              className={`brutal-card ${alert.severity === "CRITICAL" ? "brutal-card-hot" : ""} p-5 space-y-3 ${alert.severity === "CRITICAL" ? "pl-7" : ""}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="brutal-number text-xs text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {alert.severity === "CRITICAL" && (
                      <span className="brutal-chip-hot">Urgent</span>
                    )}
                    {alert.severity === "WARNING" && (
                      <span className="brutal-chip-outline">Watch</span>
                    )}
                    <span className="brutal-chip-outline">
                      {alert.status === "OPEN"
                        ? "Open"
                        : alert.status === "ACKNOWLEDGED"
                        ? "Seen"
                        : "Resolved"}
                    </span>
                  </div>
                  <p className="mt-2 text-base font-bold uppercase tracking-[-0.02em]">
                    {alert.title}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                    {alert.message}
                  </p>
                  {alert.inventoryItem && (
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Item · {alert.inventoryItem.name}
                    </p>
                  )}
                </div>
              </div>

              {alert.notifications.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {alert.notifications.map((n) => (
                    <span key={n.id} className="brutal-chip-outline">
                      {n.recipient} · {n.status}
                    </span>
                  ))}
                </div>
              )}

              {alert.status !== "RESOLVED" && (
                <div className="flex gap-2">
                  {alert.status === "OPEN" && (
                    <form action={acknowledgeAlertAction}>
                      <input type="hidden" name="alertId" value={alert.id} />
                      <Button type="submit" variant="outline" size="sm" className="brutal-btn h-8 rounded-none border-2 text-xs font-bold uppercase tracking-[0.14em]">
                        Mark seen
                      </Button>
                    </form>
                  )}
                  <form action={resolveAlertAction}>
                    <input type="hidden" name="alertId" value={alert.id} />
                    <PendingButton
                      size="sm"
                      pendingLabel="Resolving…"
                      className="hot-cta h-8 rounded-none border-2 text-xs font-bold uppercase tracking-[0.14em]"
                    >
                      Resolve
                    </PendingButton>
                  </form>
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="empty-state">
            <span className="empty-state-title">All clear</span>
            <span className="empty-state-hint">
              No active alerts. Stock is tracked in the background and we'll
              surface anything that needs attention the moment it does.
            </span>
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
