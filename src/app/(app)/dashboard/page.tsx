import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  Package,
  RefreshCcw,
  ShoppingCart,
  Store,
  TrendingDown,
} from "lucide-react";

import { connectSquareAction, runJobsAction, syncSalesAction } from "@/app/actions/operations";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Role } from "@/lib/domain-enums";
import { formatRelativeDays } from "@/lib/format";
import { requireSession } from "@/modules/auth/session";
import { getDashboardData } from "@/modules/dashboard/queries";
import { formatQuantityBase } from "@/modules/inventory/units";

/* ─── colour tokens (match globals.css .dark) ─── */
const C = {
  bg:      "#07080F",
  card:    "#0D0E1A",
  card2:   "#111220",
  border:  "rgba(255,255,255,0.07)",
  blue:    "#5B73F7",
  blueGlow:"rgba(91,115,247,0.18)",
  text:    "#F0F2FC",
  muted:   "#5A6285",
  red:     "#F87171",
  amber:   "#FCD34D",
  green:   "#34D399",
};

export default async function DashboardPage() {
  const session = await requireSession(Role.SUPERVISOR);
  const data    = await getDashboardData(session.locationId);
  const firstName = session.userName.split(" ")[0];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"24px" }}>

      {/* ── HERO ── */}
      <GlowCard className="anim-fade-up" style={{ padding:"44px 48px", position:"relative", overflow:"hidden" }}>
        {/* background blobs */}
        <div style={{ position:"absolute", top:"-80px", left:"-80px", width:"360px", height:"360px",
          borderRadius:"50%", background:"radial-gradient(circle, rgba(91,115,247,0.22) 0%, transparent 65%)",
          filter:"blur(50px)", pointerEvents:"none" }} />
        <div style={{ position:"absolute", bottom:"-60px", right:"-40px", width:"280px", height:"280px",
          borderRadius:"50%", background:"radial-gradient(circle, rgba(91,115,247,0.10) 0%, transparent 70%)",
          filter:"blur(40px)", pointerEvents:"none" }} />
        {/* dot grid */}
        <div style={{ position:"absolute", inset:0, pointerEvents:"none",
          backgroundImage:"radial-gradient(circle, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize:"22px 22px" }} />

        <div style={{ position:"relative" }}>
          {/* location pill */}
          <span style={{ display:"inline-flex", alignItems:"center", gap:"6px",
            border:`1px solid rgba(91,115,247,0.30)`,
            background:"rgba(91,115,247,0.12)",
            borderRadius:"100px", padding:"5px 14px",
            fontSize:"11px", fontWeight:600, letterSpacing:"0.14em",
            textTransform:"uppercase", color:C.blue }}>
            {session.locationName}
          </span>

          {/* giant heading */}
          <h1 style={{ marginTop:"20px",
            fontSize:"clamp(2.4rem, 5vw, 3.6rem)", fontWeight:800,
            letterSpacing:"-0.05em", lineHeight:1.0,
            background:"linear-gradient(160deg, #fff 0%, rgba(255,255,255,0.55) 100%)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
            backgroundClip:"text" }}>
            Good morning,<br />{firstName}.
          </h1>

          <p style={{ marginTop:"14px", fontSize:"15px", color:C.muted, maxWidth:"380px", lineHeight:1.6 }}>
            Here&apos;s what needs your attention today.
          </p>
        </div>
      </GlowCard>

      {/* ── METRICS ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:"12px" }}
           className="sm:grid-cols-4">
        {([
          { label:"Items tracked",  value:data.metrics.inventoryCount, icon:null,         color:C.text },
          { label:"Running low",    value:data.metrics.lowStockCount,  icon:TrendingDown, color:data.metrics.lowStockCount  > 0 ? C.amber : C.text },
          { label:"Urgent",         value:data.metrics.criticalCount,  icon:AlertTriangle,color:data.metrics.criticalCount  > 0 ? C.red   : C.text },
          { label:"Pending review", value:data.metrics.pendingRecommendations+data.metrics.pendingRecipes, icon:null, color:C.text },
        ] as const).map((m, i) => (
          <GlowCard key={m.label} className={`anim-fade-up d-${(i+1)*50 as 50|100|150|200}`}
            hoverable style={{ padding:"22px 24px" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <p style={{ fontSize:"10px", fontWeight:700, letterSpacing:"0.14em",
                textTransform:"uppercase", color:C.muted }}>
                {m.label}
              </p>
              {m.icon && <m.icon style={{ width:14, height:14, color:m.color, opacity:0.7 }} />}
            </div>
            <p style={{ marginTop:"12px", fontSize:"3rem", fontWeight:800,
              letterSpacing:"-0.05em", lineHeight:1, color:m.color,
              fontVariantNumeric:"tabular-nums" }}>
              {m.value}
            </p>
          </GlowCard>
        ))}
      </div>

      {/* ── QUICK ACTIONS ── */}
      <div style={{ display:"grid", gap:"12px" }} className="sm:grid-cols-3">
        {([
          { href:"/stock-count",     icon:ClipboardCheck, title:"Count stock",  desc:"Confirm uncertain items" },
          { href:"/inventory",       icon:Package,        title:"Inventory",    desc:"Search and review all items" },
          { href:"/purchase-orders", icon:ShoppingCart,   title:"Orders",       desc:"Review supplier actions" },
        ] as const).map((a, i) => (
          <ActionCard key={a.href} {...a} delay={(i * 75) as 0|75|150} />
        ))}
      </div>

      {/* ── ALERTS + WATCH LIST ── */}
      <div style={{ display:"grid", gap:"20px" }} className="lg:grid-cols-2">

        <section style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          <SectionLabel title="Alerts" sub="Issues requiring attention now" />
          <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
            {data.alerts.length ? data.alerts.map((alert) => (
              <GlowCard key={alert.id} hoverable style={{ padding:"14px 18px" }}>
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:"12px" }}>
                  <div style={{ minWidth:0 }}>
                    <p style={{ fontSize:"13px", fontWeight:500, color:C.text, lineHeight:1.4 }}>{alert.title}</p>
                    <p style={{ marginTop:"3px", fontSize:"12px", color:C.muted, overflow:"hidden",
                      textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{alert.message}</p>
                  </div>
                  <StatusBadge
                    label={alert.severity==="CRITICAL"?"Urgent":alert.severity==="WARNING"?"Watch":"Info"}
                    tone={alert.severity==="CRITICAL"?"critical":alert.severity==="WARNING"?"warning":"info"} />
                </div>
              </GlowCard>
            )) : (
              <EmptyCard text="All clear — no active alerts" />
            )}
          </div>
        </section>

        <section style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          <SectionLabel title="Watch list" sub="Items running low on stock" />
          <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
            {data.inventory.slice(0,6).map((item) => (
              <Link key={item.id} href={`/inventory/${item.id}`} style={{ textDecoration:"none" }}>
                <GlowCard hoverable style={{ padding:"14px 18px", cursor:"pointer" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px" }}>
                    <div style={{ minWidth:0 }}>
                      <p style={{ fontSize:"13px", fontWeight:500, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.name}</p>
                      <p style={{ marginTop:"3px", fontSize:"12px", color:C.muted }}>
                        {formatQuantityBase(item.stockOnHandBase, item.displayUnit, item.packSizeBase)} on hand
                        {item.snapshot?.daysLeft != null ? ` · ${formatRelativeDays(item.snapshot.daysLeft)} left` : ""}
                      </p>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:"8px", flexShrink:0 }}>
                      <StatusBadge
                        label={item.snapshot?.urgency==="CRITICAL"?"Urgent":item.snapshot?.urgency==="WARNING"?"Low":"OK"}
                        tone={item.snapshot?.urgency==="CRITICAL"?"critical":item.snapshot?.urgency==="WARNING"?"warning":"success"} />
                      <ArrowRight style={{ width:13, height:13, color:C.muted, opacity:0.5 }} />
                    </div>
                  </div>
                </GlowCard>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* ── PENDING ORDERS ── */}
      {data.recommendations.length > 0 && (
        <section style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          <SectionLabel title="Pending orders" sub="Recommendations waiting for your approval" />
          <div style={{ display:"grid", gap:"6px" }} className="sm:grid-cols-2">
            {data.recommendations.map((rec) => (
              <Link key={rec.id} href="/purchase-orders" style={{ textDecoration:"none" }}>
                <GlowCard hoverable style={{ padding:"14px 18px", cursor:"pointer" }}>
                  <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:"12px" }}>
                    <div style={{ minWidth:0 }}>
                      <p style={{ fontSize:"13px", fontWeight:500, color:C.text }}>{rec.inventoryItem.name}</p>
                      <p style={{ marginTop:"3px", fontSize:"12px", color:C.muted }}>{rec.supplier.name}</p>
                    </div>
                    <StatusBadge
                      label={rec.urgency==="CRITICAL"?"Urgent":rec.urgency==="WARNING"?"Soon":"Planned"}
                      tone={rec.urgency==="CRITICAL"?"critical":rec.urgency==="WARNING"?"warning":"info"} />
                  </div>
                </GlowCard>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── MANAGER ACTIONS ── */}
      {session.role === Role.MANAGER && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:"8px",
          borderTop:`1px solid ${C.border}`, paddingTop:"24px" }}>
          <form action={connectSquareAction}>
            <PillButton icon={Store} label="Connect Square" />
          </form>
          <form action={syncSalesAction}>
            <PillButton icon={ShoppingCart} label="Sync sales" />
          </form>
          <form action={runJobsAction}>
            <PillButton icon={RefreshCcw} label="Run jobs" />
          </form>
        </div>
      )}
    </div>
  );
}

/* ─── Shared components ─── */

function GlowCard({
  children, style, className = "", hoverable,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  hoverable?: boolean;
}) {
  return (
    <div
      className={className + (hoverable ? " group/card" : "")}
      style={{
        borderRadius:"14px",
        padding:"1px",
        background:"linear-gradient(145deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 55%, rgba(91,115,247,0.12) 100%)",
        transition: hoverable ? "box-shadow 0.3s cubic-bezier(0,0.44,0.6,1), transform 0.3s cubic-bezier(0,0.44,0.6,1)" : undefined,
      }}
    >
      <div
        style={{
          borderRadius:"13px",
          background:"#0D0E1A",
          height:"100%",
          transition:"background 0.3s cubic-bezier(0,0.44,0.6,1)",
          ...style,
        }}
        className={hoverable ? "group-hover/card:bg-[#101123]" : ""}
      >
        {children}
      </div>
    </div>
  );
}

function ActionCard({ href, icon: Icon, title, desc, delay }:{
  href: string; icon: typeof ClipboardCheck; title: string; desc: string; delay?: number;
}) {
  return (
    <Link href={href} style={{ textDecoration:"none" }}>
      <GlowCard hoverable className={`anim-fade-up${delay ? ` d-${delay}` : ""}`}
        style={{ padding:"28px 24px", position:"relative", cursor:"pointer", minHeight:"130px" }}>
        {/* icon */}
        <div style={{ width:42, height:42, borderRadius:"12px",
          background:"rgba(91,115,247,0.12)",
          border:"1px solid rgba(91,115,247,0.22)",
          display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Icon style={{ width:18, height:18, color:"#5B73F7" }} />
        </div>
        {/* text */}
        <p style={{ marginTop:"18px", fontSize:"15px", fontWeight:700,
          letterSpacing:"-0.025em", color:"#F0F2FC" }}>{title}</p>
        <p style={{ marginTop:"4px", fontSize:"13px", color:"#5A6285" }}>{desc}</p>
        {/* arrow */}
        <ArrowRight style={{ position:"absolute", right:"20px", bottom:"22px",
          width:14, height:14, color:"rgba(91,115,247,0.45)",
          transition:"transform 0.25s cubic-bezier(0,0.44,0.6,1), color 0.25s" }} />
      </GlowCard>
    </Link>
  );
}

function SectionLabel({ title, sub }:{ title:string; sub:string }) {
  return (
    <div>
      <h2 style={{ fontSize:"16px", fontWeight:700, letterSpacing:"-0.03em", color:"#F0F2FC" }}>{title}</h2>
      <p style={{ marginTop:"2px", fontSize:"12px", color:"#5A6285" }}>{sub}</p>
    </div>
  );
}

function EmptyCard({ text }:{ text:string }) {
  return (
    <div style={{ borderRadius:"12px", border:"1px dashed rgba(255,255,255,0.09)",
      padding:"28px 16px", textAlign:"center" }}>
      <p style={{ fontSize:"13px", color:"#5A6285" }}>{text}</p>
    </div>
  );
}

function PillButton({ icon: Icon, label }:{ icon: typeof Store; label: string }) {
  return (
    <Button type="submit" variant="outline" size="sm"
      style={{ borderRadius:"100px", height:"34px", padding:"0 16px",
        fontSize:"12px", fontWeight:600, letterSpacing:"0.01em",
        border:"1px solid rgba(255,255,255,0.10)",
        background:"rgba(255,255,255,0.04)",
        color:"#A0AACC",
        transition:"all 0.25s cubic-bezier(0,0.44,0.6,1)" }}>
      <Icon style={{ width:12, height:12, marginRight:6 }} />
      {label}
    </Button>
  );
}
