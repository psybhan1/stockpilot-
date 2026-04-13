"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
import { Role } from "@/lib/domain-enums";
import { Menu, Moon, SunMedium, X } from "lucide-react";
import { useTheme } from "next-themes";

import { logoutAction } from "@/app/actions/auth";
import { AppLiveRefresh } from "@/components/app/app-live-refresh";
import { Button } from "@/components/ui/button";
import { navigationItems, productName } from "@/lib/navigation";
import { hasMinimumRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type AppShellProps = {
  session: { businessName:string; userName:string; role:Role; locationName:string };
  assistantPanel: unknown;
  autoRefreshMs: number;
  children: ReactNode;
};

export function AppShell({ session, autoRefreshMs, children }: AppShellProps) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const visibleItems = navigationItems.filter((item) =>
    hasMinimumRole(session.role, item.minimumRole)
  );
  const mobileItems = useMemo(() => {
    const primary = visibleItems.filter((i) => "primaryMobile" in i && i.primaryMobile);
    return (primary.length ? primary : visibleItems).slice(0, 5);
  }, [visibleItems]);

  const initials = session.userName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  const SidebarContent = ({ onNav }: { onNav?: () => void }) => (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>

      {/* Logo */}
      <div style={{ padding:"20px 16px 16px", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
        <Link href="/dashboard" onClick={onNav}
          style={{ display:"flex", alignItems:"center", gap:"10px", textDecoration:"none" }}>
          <div style={{
            width:30, height:30, borderRadius:"8px", flexShrink:0,
            background:"linear-gradient(135deg, #6B82FF 0%, #4C5FD5 100%)",
            boxShadow:"0 0 18px rgba(91,115,247,0.45)",
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>
            <span style={{ fontSize:"11px", fontWeight:800, color:"#fff", letterSpacing:"-0.02em" }}>SP</span>
          </div>
          <span style={{ fontSize:"14px", fontWeight:700, color:"#F0F2FC", letterSpacing:"-0.025em" }}>
            {productName}
          </span>
        </Link>
      </div>

      {/* Nav */}
      <nav style={{ flex:1, overflowY:"auto", padding:"10px 8px" }}>
        {visibleItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} onClick={onNav}
              style={{ textDecoration:"none", display:"block", marginBottom:"2px" }}>
              <div style={{
                display:"flex", alignItems:"center", gap:"10px",
                padding:"9px 12px", borderRadius:"9px",
                fontSize:"13px", fontWeight:500, letterSpacing:"-0.01em",
                cursor:"pointer",
                background: active ? "rgba(91,115,247,0.14)" : "transparent",
                color: active ? "#7B93FF" : "#5A6285",
                transition:"all 0.2s cubic-bezier(0,0.44,0.6,1)",
                position:"relative",
              }}>
                {/* Left accent */}
                {active && (
                  <div style={{
                    position:"absolute", left:0, top:"6px", bottom:"6px", width:"3px",
                    borderRadius:"0 3px 3px 0",
                    background:"linear-gradient(to bottom, #7B93FF, #4C5FD5)",
                    boxShadow:"0 0 10px rgba(91,115,247,0.7)",
                  }} />
                )}
                <item.icon style={{ width:15, height:15, flexShrink:0,
                  color: active ? "#7B93FF" : "#5A6285" }} />
                <span>{item.label}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)", padding:"10px 8px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"10px", padding:"8px 12px", borderRadius:"9px" }}>
          <div style={{
            width:28, height:28, borderRadius:"50%", flexShrink:0,
            background:"linear-gradient(135deg, #6B82FF, #4C5FD5)",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:"10px", fontWeight:800, color:"#fff",
          }}>
            {initials}
          </div>
          <div style={{ minWidth:0, flex:1 }}>
            <p style={{ fontSize:"12px", fontWeight:600, color:"#D0D6FF",
              letterSpacing:"-0.01em", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {session.userName}
            </p>
            <p style={{ fontSize:"11px", color:"#5A6285",
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {session.locationName}
            </p>
          </div>
          <button
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            style={{ background:"none", border:"none", cursor:"pointer", padding:"4px",
              color:"#5A6285", borderRadius:"6px", display:"flex", alignItems:"center" }}>
            {resolvedTheme === "dark"
              ? <SunMedium style={{ width:14, height:14 }} />
              : <Moon style={{ width:14, height:14 }} />}
          </button>
        </div>
        <form action={logoutAction}>
          <button type="submit" style={{
            width:"100%", padding:"8px 12px", borderRadius:"9px",
            background:"none", border:"none", cursor:"pointer",
            fontSize:"12px", fontWeight:500, color:"#5A6285",
            textAlign:"left", transition:"all 0.2s",
          }}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div style={{ display:"flex", minHeight:"100vh", background:"#07080F" }}>
      <AppLiveRefresh intervalMs={autoRefreshMs} />

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex" style={{
        width:"220px", flexShrink:0,
        borderRight:"1px solid rgba(255,255,255,0.06)",
        background:"#07080F",
      }}>
        <SidebarContent />
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.7)", backdropFilter:"blur(6px)" }}
            onClick={() => setSidebarOpen(false)} />
          <aside style={{
            position:"absolute", inset:"0 auto 0 0", width:"260px",
            background:"#07080F", borderRight:"1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end",
              padding:"16px", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
              <button onClick={() => setSidebarOpen(false)}
                style={{ background:"none", border:"none", cursor:"pointer", color:"#5A6285",
                  padding:"4px", borderRadius:"6px", display:"flex" }}>
                <X style={{ width:16, height:16 }} />
              </button>
            </div>
            <SidebarContent onNav={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0 }}>
        {/* Mobile header */}
        <header className="lg:hidden" style={{
          position:"sticky", top:0, zIndex:40,
          display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"12px 16px",
          borderBottom:"1px solid rgba(255,255,255,0.06)",
          background:"rgba(7,8,15,0.92)", backdropFilter:"blur(20px)",
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
            <button onClick={() => setSidebarOpen(true)}
              style={{ background:"none", border:"none", cursor:"pointer", color:"#5A6285",
                padding:"4px", borderRadius:"6px", display:"flex" }}>
              <Menu style={{ width:18, height:18 }} />
            </button>
            <span style={{ fontSize:"14px", fontWeight:700, color:"#F0F2FC", letterSpacing:"-0.025em" }}>
              {productName}
            </span>
          </div>
          <button onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            style={{ background:"none", border:"none", cursor:"pointer", color:"#5A6285",
              padding:"4px", borderRadius:"6px", display:"flex" }}>
            {resolvedTheme === "dark" ? <SunMedium style={{ width:16, height:16 }} /> : <Moon style={{ width:16, height:16 }} />}
          </button>
        </header>

        <main style={{ flex:1, padding:"32px 16px", paddingBottom:"88px" }}
             className="lg:px-10 lg:py-10 lg:pb-10">
          <div style={{ maxWidth:"960px", margin:"0 auto" }}>{children}</div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden" style={{
        borderTop:"1px solid rgba(255,255,255,0.06)",
        background:"rgba(7,8,15,0.95)", backdropFilter:"blur(20px)",
      }}>
        <nav style={{ display:"grid", gridTemplateColumns:`repeat(${mobileItems.length},1fr)`,
          padding:"8px 8px", maxWidth:"480px", margin:"0 auto" }}>
          {mobileItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href}
                style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"4px",
                  padding:"8px 4px", borderRadius:"10px", textDecoration:"none",
                  color: active ? "#7B93FF" : "#5A6285",
                  fontSize:"10px", fontWeight:600, letterSpacing:"0.02em",
                  transition:"color 0.2s" }}>
                <item.icon style={{ width:18, height:18,
                  filter: active ? "drop-shadow(0 0 6px rgba(91,115,247,0.7))" : "none" }} />
                {item.shortLabel}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
