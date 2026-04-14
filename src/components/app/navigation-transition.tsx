"use client";

/**
 * Client-side navigation transition.
 *
 * Wraps clicks on nav links in `startTransition(() => router.push(href))`
 * so React tells us (via `isPending`) the moment a navigation begins —
 * before the server responds. The content wrapper reads that state and
 * applies a fade-out class immediately, so the UI feels responsive
 * even when the next page takes a second to load.
 *
 * Pair this with PageTransition (pathname-keyed fade-in) for the full
 * exit → enter motion on every tab change.
 */

import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useTransition,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

type Ctx = { isPending: boolean; navigate: (href: string) => void };

const NavCtx = createContext<Ctx>({ isPending: false, navigate: () => {} });

export function NavigationTransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const navigate = (href: string) =>
    startTransition(() => {
      router.push(href);
    });
  return (
    <NavCtx.Provider value={{ isPending, navigate }}>{children}</NavCtx.Provider>
  );
}

export function useNavigationTransition() {
  return useContext(NavCtx);
}

type TransitionLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    children: ReactNode;
    className?: string;
  };

export function TransitionLink({
  href,
  children,
  onClick,
  className,
  ...rest
}: TransitionLinkProps) {
  const { navigate } = useNavigationTransition();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    // Only intercept simple left-clicks; let the browser handle cmd/ctrl-click, etc.
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    if (typeof href === "string") {
      event.preventDefault();
      navigate(href);
    }
  }

  return (
    <Link href={href} onClick={handleClick} className={className} {...rest}>
      {children}
    </Link>
  );
}

/**
 * Content wrapper that reads the transition state and fades out during
 * navigation. Only defines the OUT direction — when isPending flips back
 * to false the class is removed, the browser snaps to baseline with no
 * transition, and PageTransition's pageEnter animation on the newly
 * mounted content plays cleanly.
 */
export function NavigationFader({ children }: { children: ReactNode }) {
  const { isPending } = useNavigationTransition();
  return <div className={cn(isPending && "nav-fader-out")}>{children}</div>;
}
