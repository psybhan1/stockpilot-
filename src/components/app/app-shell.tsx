"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
import { Role } from "@/lib/domain-enums";
import { Bell, MapPin, Menu, Moon, SunMedium } from "lucide-react";
import { useTheme } from "next-themes";

import { logoutAction } from "@/app/actions/auth";
import { AppLiveRefresh } from "@/components/app/app-live-refresh";
import { AssistantPanel } from "@/components/app/assistant-panel";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  assistantPanel: {
    alerts: Array<{
      id: string;
      title: string;
      severity: string;
      inventoryItem: { name: string } | null;
    }>;
    recommendations: Array<{
      id: string;
      rationale: string;
      urgency: string;
      recommendedPackCount: number;
      recommendedPurchaseUnit: string;
      inventoryItem: { name: string };
      supplier: { name: string };
    }>;
    tasks: Array<{
      id: string;
      title: string;
      status: string;
      supplier: { name: string } | null;
    }>;
  };
  autoRefreshMs: number;
  children: ReactNode;
};

function getActiveNavigationItem(
  pathname: string,
  items: Array<(typeof navigationItems)[number]>
) {
  return [...items]
    .sort((left, right) => right.href.length - left.href.length)
    .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}

export function AppShell({ session, assistantPanel, autoRefreshMs, children }: AppShellProps) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionCenterOpen, setActionCenterOpen] = useState(false);

  const visibleNavigationItems = navigationItems.filter((item) =>
    hasMinimumRole(session.role, item.minimumRole)
  );
  const activeNavigationItem = getActiveNavigationItem(pathname, visibleNavigationItems);
  const mobilePrimaryItems = useMemo(() => {
    const primary = visibleNavigationItems.filter(
      (item) => "primaryMobile" in item && item.primaryMobile
    );
    return (primary.length ? primary : visibleNavigationItems).slice(0, 4);
  }, [visibleNavigationItems]);
  const openActionCount =
    assistantPanel.alerts.length +
    assistantPanel.recommendations.length +
    assistantPanel.tasks.length;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.12),transparent_24%),linear-gradient(180deg,_rgba(255,252,248,1),rgba(250,250,249,1))] text-foreground dark:bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.08),transparent_18%),linear-gradient(180deg,_rgba(12,10,9,1),rgba(24,24,27,1))]">
      <AppLiveRefresh intervalMs={autoRefreshMs} />

      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-amber-600 dark:text-amber-300">
              {productName}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold tracking-tight">
                {activeNavigationItem?.label ?? productName}
              </h1>
              <span className="hidden items-center gap-1 text-sm text-muted-foreground sm:inline-flex">
                <MapPin className="size-3.5" />
                {session.locationName}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="hidden h-10 rounded-full px-4 sm:inline-flex"
              onClick={() => setActionCenterOpen(true)}
            >
              <Bell data-icon="inline-start" />
              Action center
              {openActionCount ? (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                  {openActionCount}
                </span>
              ) : null}
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setActionCenterOpen(true)}
              className="sm:hidden"
            >
              <Bell />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            >
              {resolvedTheme === "dark" ? <SunMedium /> : <Moon />}
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              className="lg:hidden"
              onClick={() => setMenuOpen(true)}
            >
              <Menu />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] gap-6 px-4 py-4 pb-24 lg:grid-cols-[220px_minmax(0,1fr)_320px] lg:pb-8">
        <aside className="hidden lg:flex lg:flex-col lg:gap-4">
          <div className="rounded-[28px] border border-border/60 bg-card/82 p-4 shadow-lg shadow-black/5 backdrop-blur">
            <p className="text-sm font-medium">{session.userName}</p>
            <p className="mt-1 text-sm text-muted-foreground">{session.businessName}</p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <StatusBadge label={session.role} tone="info" />
              <span className="text-xs text-muted-foreground">{session.locationName}</span>
            </div>
          </div>

          <nav className="rounded-[28px] border border-border/60 bg-card/78 p-2 shadow-lg shadow-black/5 backdrop-blur">
            <div className="space-y-1">
              {visibleNavigationItems.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition-colors",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="rounded-[28px] border border-border/60 bg-card/78 p-4 text-sm text-muted-foreground shadow-lg shadow-black/5 backdrop-blur">
            Keep the main flows simple:
            <div className="mt-2 space-y-2">
              <p>1. Review what is urgent.</p>
              <p>2. Count anything uncertain.</p>
              <p>3. Approve supplier work only when it looks right.</p>
            </div>
          </div>

          <form action={logoutAction}>
            <Button type="submit" variant="outline" className="h-11 w-full rounded-2xl">
              Sign out
            </Button>
          </form>
        </aside>

        <main className="min-w-0 space-y-6">{children}</main>

        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <AssistantPanel role={session.role} summary={assistantPanel} />
          </div>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-4 gap-1 rounded-[28px] border border-border/70 bg-card/95 p-2 shadow-2xl shadow-black/10 backdrop-blur-xl">
          {mobilePrimaryItems.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-[3.75rem] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className="size-4" />
                {item.shortLabel}
              </Link>
            );
          })}
        </div>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="left"
          className="w-[88vw] max-w-sm border-r border-border/60 bg-background/96"
        >
          <SheetHeader>
            <SheetTitle>{productName}</SheetTitle>
            <SheetDescription>
              Signed in as {session.userName}. Pick a place to work.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 px-4 pb-4">
            {visibleNavigationItems.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/70 text-foreground hover:bg-muted"
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              );
            })}

            <form action={logoutAction} className="pt-2">
              <Button type="submit" variant="outline" className="h-11 w-full rounded-2xl">
                Sign out
              </Button>
            </form>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={actionCenterOpen} onOpenChange={setActionCenterOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[88svh] rounded-t-[32px] border-t border-border/60 bg-background/96"
        >
          <SheetHeader>
            <SheetTitle>Action center</SheetTitle>
            <SheetDescription>
              Alerts, approvals, and follow-ups collected in one place.
            </SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto px-4 pb-6">
            <AssistantPanel role={session.role} summary={assistantPanel} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
