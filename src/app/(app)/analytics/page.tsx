import {
  BarChart3,
  CheckCircle2,
  Clock,
  DollarSign,
  Minus,
  PackageX,
  RefreshCcw,
  TrendingUp,
} from "lucide-react";

import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { getAnalyticsOverview } from "@/modules/analytics/queries";

export default async function AnalyticsPage() {
  const session = await requireSession(Role.SUPERVISOR);
  const data = await getAnalyticsOverview(session.locationId);

  const spendFormatted = (data.totalSpendCents / 100).toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  });
  const replyLabel =
    data.averageReplyHours == null
      ? "—"
      : data.averageReplyHours < 1
      ? `${Math.round(data.averageReplyHours * 60)}m`
      : `${data.averageReplyHours.toFixed(1)}h`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Last {data.windowDays} days
        </p>
        <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Analytics
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Everything we&apos;ve learned about how your café orders, which suppliers come through for you, and what&apos;s costing what.
        </p>
      </div>

      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Orders sent"
          value={data.ordersSent.toString()}
          icon={TrendingUp}
          sub={
            data.ordersConfirmed > 0
              ? `${data.ordersConfirmed} confirmed by suppliers`
              : "awaiting replies"
          }
        />
        <KpiCard
          label="Spend"
          value={spendFormatted}
          icon={DollarSign}
          sub="from confirmed line items"
        />
        <KpiCard
          label="Avg supplier reply"
          value={replyLabel}
          icon={Clock}
          sub={
            data.averageReplyHours && data.averageReplyHours < 6
              ? "faster than most"
              : "measured across paired threads"
          }
        />
        <KpiCard
          label="Auto-rescues"
          value={data.rescueOrders.toString()}
          icon={RefreshCcw}
          sub={
            data.ordersOutOfStock > 0
              ? `${data.ordersOutOfStock} OOS replies triggered rescues`
              : "no rescues needed"
          }
          tone={data.rescueOrders > 0 ? "accent" : undefined}
        />
      </div>

      {/* Supplier scorecards */}
      <Card className="rounded-[28px] border-border/60 bg-card/88">
        <CardContent className="space-y-5 p-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Supplier scorecards
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Confirm rate, decline rate, and average reply speed per supplier.
              </p>
            </div>
            <StatusBadge label={`${data.topSuppliers.length} active`} tone="info" />
          </div>

          {data.topSuppliers.length === 0 ? (
            <EmptyRow
              title="No supplier activity in the last 30 days"
              detail="Scorecards appear here once orders and replies start flowing."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                    <Th>Supplier</Th>
                    <Th>Orders</Th>
                    <Th>Confirmed</Th>
                    <Th>OOS / declined</Th>
                    <Th>Pending</Th>
                    <Th>Confirm rate</Th>
                    <Th>Avg reply</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.topSuppliers.map((s) => (
                    <tr key={s.supplierId} className="border-b border-border/60">
                      <Td>
                        <div className="font-medium">{s.name}</div>
                        {s.lastActivityAt ? (
                          <div className="text-xs text-muted-foreground">
                            last · {new Date(s.lastActivityAt).toLocaleDateString()}
                          </div>
                        ) : null}
                      </Td>
                      <Td>{s.totalOrders}</Td>
                      <Td>
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckCircle2 className="size-3.5" />
                          {s.confirmed}
                        </span>
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1 text-red-700">
                          <PackageX className="size-3.5" />
                          {s.declined}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-muted-foreground">{s.pending}</span>
                      </Td>
                      <Td>
                        <ConfirmRateBar rate={s.confirmRate} />
                      </Td>
                      <Td>
                        {s.avgReplyHours == null
                          ? "—"
                          : s.avgReplyHours < 1
                          ? `${Math.round(s.avgReplyHours * 60)}m`
                          : `${s.avgReplyHours.toFixed(1)}h`}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        {/* Top items */}
        <Card className="rounded-[28px] border-border/60 bg-card/88">
          <CardContent className="space-y-4 p-5">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Top reordered items</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Which items go through your ordering loop the most.
              </p>
            </div>
            {data.topItems.length === 0 ? (
              <EmptyRow
                title="No items ordered recently"
                detail="Items you order often show up here, with how many times and the total quantity."
              />
            ) : (
              <ul className="space-y-2">
                {data.topItems.map((item, idx) => {
                  const max = data.topItems[0].orderCount;
                  const pct = Math.max(8, Math.round((item.orderCount / max) * 100));
                  return (
                    <li
                      key={item.inventoryItemId}
                      className="notif-card p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.totalQuantityOrdered} {item.unit} across {item.orderCount} order{item.orderCount === 1 ? "" : "s"}
                          </p>
                        </div>
                        <span className="font-mono text-xs text-muted-foreground">
                          #{idx + 1}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-foreground"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Daily PO volume */}
        <Card className="rounded-[28px] border-border/60 bg-card/88">
          <CardContent className="space-y-4 p-5">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Daily order volume</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Purchase orders drafted per day, last {data.windowDays} days.
              </p>
            </div>
            {data.dailyOrders.length === 0 ? (
              <EmptyRow title="No orders yet" detail="The chart fills as you place orders." />
            ) : (
              <DailyBars
                days={data.dailyOrders}
                windowDays={data.windowDays}
                nowMs={data.nowMs}
              />
            )}
            <div className="grid grid-cols-3 gap-3 border-t border-border/60 pt-4 text-xs text-muted-foreground">
              <Stat label="Confirmed" value={data.ordersConfirmed} tone="pos" />
              <Stat label="Failed / OOS" value={data.ordersFailed + data.ordersOutOfStock} tone="neg" />
              <Stat label="Rescues" value={data.rescueOrders} tone="neutral" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent activity feed */}
      <Card className="rounded-[28px] border-border/60 bg-card/88">
        <CardContent className="space-y-4 p-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Recent activity</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Live feed of audit events from your location.
            </p>
          </div>
          {data.recentActivity.length === 0 ? (
            <EmptyRow title="Nothing yet" detail="Activity shows up here as you use the app." />
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.recentActivity.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-card px-3 py-2"
                >
                  <span className="flex items-center gap-2">
                    <BarChart3 className="size-3.5 text-muted-foreground" aria-hidden />
                    <span className="font-medium">{a.label}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(a.at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  icon: typeof BarChart3;
  tone?: "accent";
}) {
  return (
    <Card
      className={
        "rounded-3xl border-border/60 " +
        (tone === "accent"
          ? "bg-[linear-gradient(135deg,rgba(41,37,36,0.98),rgba(87,83,78,0.96))] text-white"
          : "bg-card/88")
      }
    >
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between">
          <div>
            <p
              className={
                "text-[11px] uppercase tracking-[0.12em] " +
                (tone === "accent" ? "text-white/60" : "text-muted-foreground")
              }
            >
              {label}
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
          </div>
          <div
            className={
              "grid size-10 place-items-center rounded-2xl border " +
              (tone === "accent"
                ? "border-white/15 bg-white/5"
                : "border-border/50 bg-card")
            }
          >
            <Icon className="size-4" aria-hidden />
          </div>
        </div>
        <p
          className={
            "text-xs " +
            (tone === "accent" ? "text-white/60" : "text-muted-foreground")
          }
        >
          {sub}
        </p>
      </CardContent>
    </Card>
  );
}

function ConfirmRateBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const tone = rate >= 0.8 ? "bg-emerald-500" : rate >= 0.5 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={"h-full rounded-full " + tone} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs tabular-nums">{pct}%</span>
    </div>
  );
}

function DailyBars({
  days,
  windowDays,
  nowMs,
}: {
  days: Array<{ date: string; count: number }>;
  windowDays: number;
  nowMs: number;
}) {
  // Normalise into a windowDays-sized array. `nowMs` is passed in
  // so render stays pure — Date.now() captured once at the request
  // boundary, not during each child render.
  const byDate = new Map(days.map((d) => [d.date, d.count]));
  const arr: Array<{ date: string; count: number }> = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(nowMs - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    arr.push({ date: key, count: byDate.get(key) ?? 0 });
  }
  const max = Math.max(1, ...arr.map((a) => a.count));
  return (
    <div className="flex h-28 items-end gap-1">
      {arr.map((d) => {
        const pct = Math.round((d.count / max) * 100);
        const h = Math.max(2, pct);
        return (
          <div
            key={d.date}
            className="flex flex-1 flex-col items-stretch"
            title={`${d.date}: ${d.count} order${d.count === 1 ? "" : "s"}`}
          >
            <div
              className="w-full rounded-t-md bg-foreground/85"
              style={{ height: `${h}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "pos" | "neg" | "neutral";
}) {
  const color =
    tone === "pos"
      ? "text-emerald-700"
      : tone === "neg"
      ? "text-red-700"
      : "text-foreground";
  return (
    <div>
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
      <p className="text-[11px] uppercase tracking-[0.12em]">{label}</p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="border-b border-border/60 py-2 pr-3 font-medium">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="py-3 pr-3 align-top">{children}</td>;
}

function EmptyRow({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      <div className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
        <Minus className="size-3" aria-hidden />
        <span>check back after some activity</span>
      </div>
    </div>
  );
}
