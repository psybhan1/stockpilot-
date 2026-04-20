"use client";

/**
 * PageTransition — wraps the main content and replays a smooth
 * fade+slide animation every time the route changes. The trick is a
 * pathname-keyed wrapper: React unmounts the old subtree and mounts a
 * new one when the path changes, and CSS keyframes on mount do the
 * rest. Paired with the canvas palette tween, route changes feel like
 * a single orchestrated motion instead of a hard cut.
 */

import { usePathname } from "next/navigation";
import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageTransition({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  return (
    <div key={pathname} className={cn("page-transition-enter", className)}>
      {children}
    </div>
  );
}
