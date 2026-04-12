"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
import { Role } from "@/lib/domain-enums";
import { ChevronRight, Menu, Moon, SunMedium, X } from "lucide-react";
import { useTheme } from "next-themes";

import { logoutAction } from "@/app/actions/auth";
import { AppLiveRefresh } from "@/components/app/app-live-refresh";
import { Button } from "@/components/ui/button";
import { navigationItems, productName } from "@/lib/navigation";
import { hasMinimumRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type AppShellProps = {
  session: {
    businessName: string;
    userName: string;
    role: Role;
    locationName: string;
  };
  assistantPanel: unknown;
  autoRefreshMs: number;
  children: ReactNode;
};

export function AppShell({ session, autoRefreshMs, children }: AppShellProps) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const visibleNavigationItems = navigationItems.filter((item) =>
    hasMinimumRole(session.role, item.minimumRole)
  );

  const mobilePrimaryItems = useMemo(() => {
    const primary = visibleNavigationItems.filter(
      (item) => "primaryMobile" in item && item.primaryMobile
    );
    return (primary.length ? primary : visibleNavigationItems).slice(0, 5);
  }, [visibleNavigationItems]);

  return (
    <div className="flex min-h-screen bg-background">
      <AppLiveRefresh intervalMs={autoRefreshMs} />

      {/* ─── Sidebar (desktop) ─── */}
      <aside className="hidden lg:flex lg:w-[260px] lg:flex-col lg:border-r lg:border-border/50">
        <div className="flex h-full flex-col px-4 py-6">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-3 px-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
              <span className="text-sm font-bold text-primary">SP</span>
            </div>
            <span className="text-sm font-semibold tracking-tight">{productName}</span>
          </Link>

          {/* Nav links */}
          <nav className="mt-8 flex-1 space-y-1">
            {visibleNavigationItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  <item.icon className="size-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* User + sign out */}
          <div className="mt-auto space-y-3 border-t border-border/50 pt-4">
            <div className="px-3">
              <p className="text-sm font-medium">{session.userName}</p>
              <p className="text-xs text-muted-foreground">{session.locationName}</p>
            </div>
            <div className="flex items-center gap-2 px-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              >
                {resolvedTheme === "dark" ? (
                  <SunMedium className="size-3.5" />
                ) : (
                  <Moon className="size-3.5" />
                )}
              </Button>
              <form action={logoutAction} className="flex-1">
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start text-xs text-muted-foreground"
                >
                  Sign out
                </Button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      {/* ─── Mobile sidebar overlay ─── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[280px] flex-col border-r border-border/50 bg-background">
            <div className="flex items-center justify-between px-6 py-5">
              <Link href="/dashboard" className="flex items-center gap-3" onClick={() => setSidebarOpen(false)}>
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
                  <span className="text-sm font-bold text-primary">SP</span>
                </div>
                <span className="text-sm font-semibold tracking-tight">{productName}</span>
              </Link>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setSidebarOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>
            <nav className="flex-1 space-y-1 px-4">
              {visibleNavigationItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                  >
                    <item.icon className="size-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-border/50 p-4">
              <form action={logoutAction}>
                <Button type="submit" variant="ghost" size="sm" className="w-full justify-start text-xs text-muted-foreground">
                  Sign out
                </Button>
              </form>
            </div>
          </aside>
        </div>
      )}

      {/* ─── Main content ─── */}
      <div className="flex flex-1 flex-col">
        {/* Top bar (mobile) */}
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border/50 bg-background/90 px-4 py-3 backdrop-blur-xl lg:hidden">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setSidebarOpen(true)}>
              <Menu className="size-4" />
            </Button>
            <span className="text-sm font-semibold">{productName}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            {resolvedTheme === "dark" ? <SunMedium className="size-3.5" /> : <Moon className="size-3.5" />}
          </Button>
        </header>

        {/* Page content */}
        <main className="flex-1 px-4 py-6 lg:px-10 lg:py-8">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>

      {/* ─── Mobile bottom nav ─── */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/50 bg-background/95 backdrop-blur-xl lg:hidden">
        <nav className="mx-auto grid max-w-lg grid-cols-5 gap-1 px-2 py-2">
          {mobilePrimaryItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <item.icon className="size-4" />
                {item.shortLabel}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
