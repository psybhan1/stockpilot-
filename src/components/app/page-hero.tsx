import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Clean page header — bold uppercase eyebrow, oversized sans title,
 * optional inline metric strip, optional right-rail action. No canvas,
 * no grain, no marquee. Designed for speed of scan.
 */

export type HeroStat = {
  label: string;
  value: string | number;
  highlight?: boolean;
};

type PageHeroProps = {
  eyebrow: string;
  title: string;
  /** Tiny muted tail — one short line. */
  subtitle?: string;
  /** Longer grey helper line. */
  description?: string;
  stats?: HeroStat[];
  /** Right-side action buttons / menus. */
  action?: ReactNode;
  /** Kept for back-compat; ignored in the simplified design. */
  compact?: boolean;
  /** Kept for back-compat; ignored. */
  marquee?: string[];
};

export function PageHero({
  eyebrow,
  title,
  description,
  stats,
  action,
}: PageHeroProps) {
  return (
    <header className="border-b border-border pb-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            {eyebrow}
          </p>
          <h1 className="mt-3 text-4xl font-extrabold uppercase leading-[0.95] tracking-[-0.03em] sm:text-5xl md:text-6xl">
            {title}
          </h1>
          {description && (
            <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>

      {stats && stats.length > 0 && (
        <div
          className={cn(
            "mt-8 grid gap-x-8 gap-y-6 border-t border-border pt-6",
            stats.length === 1 && "grid-cols-1",
            stats.length === 2 && "grid-cols-2",
            stats.length === 3 && "grid-cols-3",
            stats.length >= 4 && "grid-cols-2 sm:grid-cols-4"
          )}
        >
          {stats.map((s, i) => (
            <div key={i} className="min-w-0">
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                {s.label}
              </p>
              <p
                className={cn(
                  "mt-1.5 text-3xl font-bold tabular-nums leading-none",
                  s.highlight && "text-accent"
                )}
              >
                {s.value}
              </p>
            </div>
          ))}
        </div>
      )}
    </header>
  );
}
