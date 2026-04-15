"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Menu, Moon, MoreHorizontal, SunMedium, X } from "lucide-react";
import { useTheme } from "next-themes";

import { logoutAction } from "@/app/actions/auth";
import { AppLiveRefresh } from "@/components/app/app-live-refresh";
import { GlassFilter } from "@/components/app/glass-filter";
import { InkCanvas } from "@/components/app/ink-canvas";
import { PointerGloss } from "@/components/app/pointer-gloss";
import {
  NavigationFader,
  NavigationTransitionProvider,
  TransitionLink,
} from "@/components/app/navigation-transition";
import { PageTransition } from "@/components/app/page-transition";
import { ScrollRevealController } from "@/components/app/scroll-reveal-controller";
import { Toaster } from "@/components/app/toaster";
import { Role } from "@/lib/domain-enums";
import { primaryNav, productName, secondaryNav } from "@/lib/navigation";
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

  const visiblePrimary = useMemo(
    () => primaryNav.filter((item) => hasMinimumRole(session.role, item.minimumRole)),
    [session.role]
  );
  const visibleSecondary = useMemo(
    () => secondaryNav.filter((item) => hasMinimumRole(session.role, item.minimumRole)),
    [session.role]
  );
  const allVisible = useMemo(
    () => [...visiblePrimary, ...visibleSecondary],
    [visiblePrimary, visibleSecondary]
  );

  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const initials = session.userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <NavigationTransitionProvider>
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Skip-to-content for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-foreground focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:font-bold focus:uppercase focus:tracking-[0.18em] focus:text-background"
      >
        Skip to content
      </a>

      {/* Global SVG filter defs for liquid-glass refraction. */}
      <GlassFilter />
      {/* Global pointer tracker — feeds specular highlight on hovered cards. */}
      <PointerGloss />
      {/* Global scroll-reveal — cards animate in as they cross the viewport. */}
      <ScrollRevealController />

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

          <nav className="hidden lg:flex lg:flex-1 lg:items-center lg:gap-1 lg:px-4">
            {visiblePrimary.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <TransitionLink
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative rounded-md px-3 py-1.5 text-sm font-medium tracking-tight",
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

            {/* "More" dropdown for secondary nav */}
            {visibleSecondary.length > 0 && (
              <div ref={moreRef} className="relative">
                <button
                  type="button"
                  onClick={() => setMoreOpen((o) => !o)}
                  aria-expanded={moreOpen}
                  aria-haspopup="menu"
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium tracking-tight text-muted-foreground hover:text-foreground",
                    moreOpen && "text-foreground"
                  )}
                >
                  More
                  <MoreHorizontal className="size-3.5" />
                </button>
                {moreOpen && (
                  <div
                    role="menu"
                    className="notif-card absolute left-0 top-full z-50 mt-2 w-64 p-2 !opacity-100 !translate-y-0 !blur-0"
                    style={{ animation: "toastIn 0.22s cubic-bezier(0.22,1,0.36,1) both" }}
                  >
                    {visibleSecondary.map((item) => {
                      const active =
                        pathname === item.href || pathname.startsWith(`${item.href}/`);
                      return (
                        <TransitionLink
                          key={item.href}
                          href={item.href}
                          onClick={() => setMoreOpen(false)}
                          role="menuitem"
                          className={cn(
                            "flex items-start gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors",
                            active
                              ? "bg-foreground/[0.06] text-foreground"
                              : "text-foreground/80 hover:bg-foreground/[0.04] hover:text-foreground"
                          )}
                        >
                          <item.icon className="mt-0.5 size-4 shrink-0 opacity-70" />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">{item.label}</span>
                            {item.description && (
                              <span className="block truncate text-xs text-muted-foreground">
                                {item.description}
                              </span>
                            )}
                          </span>
                        </TransitionLink>
                      );
                    })}
                    <style>{`
                      @keyframes toastIn {
                        from { opacity: 0; transform: translateY(-4px); }
                        to { opacity: 1; transform: translateY(0); }
                      }
                    `}</style>
                  </div>
                )}
              </div>
            )}
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
            <nav className="mx-auto flex max-w-[1600px] flex-col p-4">
              {allVisible.map((item, idx) => {
                const isFirstSecondary =
                  idx === visiblePrimary.length && visibleSecondary.length > 0;
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <div key={item.href}>
                    {isFirstSecondary && (
                      <p className="mt-3 mb-1 px-3 font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                        More
                      </p>
                    )}
                    <TransitionLink
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                        active
                          ? "bg-foreground text-background"
                          : "text-foreground/80 hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <item.icon className="size-4 opacity-80" />
                      {item.label}
                    </TransitionLink>
                  </div>
                );
              })}
            </nav>
          </div>
        )}
      </header>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <main id="main-content" className="relative z-10 flex-1">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 sm:py-10 lg:px-10 lg:py-12">
          <NavigationFader>
            <PageTransition>{children}</PageTransition>
          </NavigationFader>
        </div>
      </main>

      <AppLiveRefresh intervalMs={autoRefreshMs} />
      <Toaster />
    </div>
    </NavigationTransitionProvider>
  );
}
