import { type ReactNode } from "react";

import {
  EditorialBackground,
  Eyebrow,
  LiveDot,
  MarqueeStrip,
  RevealText,
  ScrollReveal,
} from "@/components/app/editorial";
import { cn } from "@/lib/utils";

/**
 * Editorial page hero — the shared header the whole app uses so every
 * screen feels part of the same publication.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │ eyebrow                        live ·          │
 *   │                                                │
 *   │           OVERSIZED DISPLAY TITLE             │
 *   │           italic subtitle                      │
 *   │                                                │
 *   │  ── stat 01   ── stat 02   ── stat 03          │
 *   └──────────────────────────────────────────────┘
 *   ▶▶▶ marquee strip of live metrics ▶▶▶
 */

const heroVideoUrl = process.env.STOCKPILOT_HERO_VIDEO_URL;

export type HeroStat = {
  label: string;
  value: string | number;
  highlight?: boolean;
};

type PageHeroProps = {
  eyebrow: string;
  title: string;
  /** Optional italic tail — rendered below the main title in italic display. */
  subtitle?: string;
  /** Small grey helper line. */
  description?: string;
  stats?: HeroStat[];
  marquee?: string[];
  /** Anything extra rendered in the hero, below stats. */
  children?: ReactNode;
  /** Optional right-rail affordance (buttons etc.) placed top-right. */
  action?: ReactNode;
  /** Smaller hero when you just want a header, no drama. */
  compact?: boolean;
};

export function PageHero({
  eyebrow,
  title,
  subtitle,
  description,
  stats,
  marquee,
  children,
  action,
  compact = false,
}: PageHeroProps) {
  return (
    <>
      <section
        className={cn(
          "relative isolate overflow-hidden rounded-[36px] border border-border/60 bg-card/40 backdrop-blur",
          compact ? "" : ""
        )}
      >
        <EditorialBackground videoSrc={heroVideoUrl} vignette />

        <div
          className={cn(
            "relative z-10 flex flex-col justify-between p-8 sm:p-12",
            compact ? "min-h-[240px]" : "min-h-[420px]"
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <Eyebrow>{eyebrow}</Eyebrow>
            <div className="flex items-center gap-3">
              {action}
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                <LiveDot />
                Live
              </div>
            </div>
          </div>

          <div className={cn(compact ? "mt-8" : "mt-16")}>
            <RevealText
              as="h1"
              className={cn(
                "font-display leading-[0.95] tracking-[-0.04em]",
                compact
                  ? "text-[clamp(2.25rem,6vw,4.5rem)]"
                  : "text-[clamp(3rem,9vw,7.5rem)]"
              )}
            >
              {title}
            </RevealText>
            {subtitle && (
              <RevealText
                as="p"
                startDelay={400}
                stagger={14}
                className={cn(
                  "mt-2 font-display italic leading-tight text-muted-foreground",
                  compact
                    ? "text-[clamp(1.1rem,2.5vw,1.8rem)]"
                    : "text-[clamp(1.5rem,4vw,3rem)]"
                )}
              >
                {subtitle}
              </RevealText>
            )}
            {description && (
              <p className="mt-5 max-w-xl font-mono text-[11px] uppercase leading-relaxed tracking-[0.18em] text-muted-foreground">
                {description}
              </p>
            )}
          </div>

          {stats && stats.length > 0 && (
            <ScrollReveal delay={600}>
              <div
                className={cn(
                  "mt-12 grid gap-6",
                  stats.length === 1 && "grid-cols-1",
                  stats.length === 2 && "sm:grid-cols-2",
                  stats.length === 3 && "sm:grid-cols-3",
                  stats.length >= 4 && "sm:grid-cols-2 lg:grid-cols-4"
                )}
              >
                {stats.map((s, i) => (
                  <HeroStatBlock key={i} index={i + 1} stat={s} />
                ))}
              </div>
            </ScrollReveal>
          )}

          {children}
        </div>
      </section>

      {marquee && marquee.length > 0 && (
        <MarqueeStrip items={marquee} speed="slow" className="mt-8" />
      )}
    </>
  );
}

function HeroStatBlock({ index, stat }: { index: number; stat: HeroStat }) {
  return (
    <div className="group relative">
      <div className="rule-thin mb-4" />
      <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-muted-foreground">
        {String(index).padStart(2, "0")} — {stat.label}
      </p>
      <p
        className={cn(
          "mt-3 font-display text-5xl tabular-nums leading-none",
          stat.highlight ? "text-destructive" : "text-foreground"
        )}
      >
        {stat.value}
      </p>
    </div>
  );
}
