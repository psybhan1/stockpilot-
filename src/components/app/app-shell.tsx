"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
import { Menu, Moon, SunMedium, X } from "lucide-react";
import { useTheme } from "next-themes";

import { logoutAction } from "@/app/actions/auth";
import { AppLiveRefresh } from "@/components/app/app-live-refresh";
import { GlassFilter } from "@/components/app/glass-filter";
import { InkCanvas } from "@/components/app/ink-canvas";
import {
  NavigationFader,
  NavigationTransitionProvider,
  TransitionLink,
} from "@/components/app/navigation-transition";
import { PageTransition } from "@/components/app/page-transition";
import { Role } from "@/lib/domain-enums";
import { navigationItems, productName } from "@/lib/navigation";
import { hasMinimumRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type AppShellProps = {
  session: { businessName: string; userName: string; role: Role; locationName: string };
  assistantPanel: unknown;
  autoRefreshMs: number;
  children: ReactNode;
};

/**
 * Flat, calm shell — horizontal top nav, minimal chrome, wide content.
 * Designed to get out of the way so the page content is the hero.
 */
export function AppShell({ session, autoRefreshMs, children }: AppShellProps) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleItems = useMemo(
    () => navigationItems.filter((item) => hasMinimumRole(session.role, item.minimumRole)),
    [session.role]
  );

  const initials = session.userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <NavigationTransitionProvider>
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Global SVG filter defs for liquid-glass refraction. */}
      <GlassFilter />

      {/* ── Living gradient background — fixed behind everything ──── */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        aria-hidden
      >
        <InkCanvas />
      </div>

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/75 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4 sm:px-6 lg:px-10">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm font-bold uppercase tracking-[-0.01em]"
          >
            <span className="flex size-7 items-center justify-center rounded bg-foreground text-background">
              <span className="text-[10px] font-extrabold">SP</span>
            </span>
            <span className="hidden sm:inline">{productName}</span>
          </Link>

          <nav className="hidden lg:flex lg:flex-1 lg:items-center lg:gap-0.5 lg:px-4">
            {visibleItems.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <TransitionLink
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative rounded-md px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em]",
                    "hover:text-foreground",
                    active ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {item.label}
                  {active && (
                    <span className="nav-active-indicator pointer-events-none absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-foreground" />
                  )}
                </TransitionLink>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Toggle theme"
            >
              {resolvedTheme === "dark" ? (
                <SunMedium className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </button>

            <div className="hidden items-center gap-2 sm:flex">
              <div className="flex size-8 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
                {initials}
              </div>
              <div className="hidden leading-tight md:block">
                <div className="text-xs font-semibold">{session.userName}</div>
                <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                  {session.locationName}
                </div>
              </div>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="ml-2 rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  Log out
                </button>
              </form>
            </div>

            <button
              type="button"
              onClick={() => setMobileOpen((x) => !x)}
              className="flex size-8 items-center justify-center rounded-md lg:hidden"
              aria-label="Menu"
            >
              {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="border-t border-border lg:hidden">
            <nav className="mx-auto flex max-w-[1600px] flex-col gap-1 p-4">
              {visibleItems.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <TransitionLink
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "rounded-md px-3 py-2 font-mono text-xs uppercase tracking-[0.16em] transition-colors",
                      active
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {item.label}
                  </TransitionLink>
                );
              })}
            </nav>
          </div>
        )}
      </header>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <main className="relative z-10 flex-1">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 sm:py-10 lg:px-10 lg:py-12">
          <NavigationFader>
            <PageTransition>{children}</PageTransition>
          </NavigationFader>
        </div>
      </main>

      <AppLiveRefresh intervalMs={autoRefreshMs} />
    </div>
    </NavigationTransitionProvider>
  );
}
