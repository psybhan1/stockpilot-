"use client";

/**
 * Editorial UI primitives — the building blocks of the new StockPilot look.
 *
 * - EditorialBackground: ambient animated gradient-mesh + grain overlay.
 *   Optionally layers a <video> behind it when a src is provided.
 * - RevealText: letter-by-letter cinematic reveal for display headings.
 * - ScrollReveal: intersection-observer based rise-in wrapper.
 * - MarqueeStrip: infinite horizontal ticker for labels/metrics.
 * - Eyebrow: small all-caps label for section headers.
 */

import { cn } from "@/lib/utils";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

// ── Background (ambient gradient mesh + grain + optional looping video) ──
type EditorialBackgroundProps = {
  videoSrc?: string;
  /** Adds a vignette on top of the background when true. */
  vignette?: boolean;
  /** Accent color override — defaults to the CSS --accent. */
  accent?: string;
  className?: string;
};

export function EditorialBackground({
  videoSrc,
  vignette = true,
  accent,
  className,
}: EditorialBackgroundProps) {
  const [videoReady, setVideoReady] = useState(false);

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        "grain",
        vignette && "vignette",
        className
      )}
    >
      {/* Ambient gradient-mesh blobs. These animate with meshDrift. */}
      <div className="absolute inset-0">
        <span
          className="mesh-blob"
          style={{
            top: "-18%",
            left: "-10%",
            width: "55vw",
            height: "55vw",
            background: accent ?? "var(--accent)",
          }}
        />
        <span
          className="mesh-blob"
          style={{
            bottom: "-14%",
            right: "-8%",
            width: "48vw",
            height: "48vw",
            background: "var(--chart-2)",
            animationDelay: "-8s",
          }}
        />
        <span
          className="mesh-blob"
          style={{
            top: "35%",
            left: "45%",
            width: "32vw",
            height: "32vw",
            background: "var(--chart-3)",
            animationDelay: "-14s",
            opacity: 0.35,
          }}
        />
      </div>

      {/* Optional background video — layered above the mesh when available. */}
      {videoSrc && (
        <video
          autoPlay
          muted
          loop
          playsInline
          onCanPlay={() => setVideoReady(true)}
          className={cn(
            "absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-1000",
            videoReady && "opacity-60"
          )}
          style={{ filter: "grayscale(0.15) contrast(1.05)" }}
        >
          <source src={videoSrc} type="video/mp4" />
        </video>
      )}
    </div>
  );
}

// ── RevealText ───────────────────────────────────────────────────────────
type RevealTextProps = {
  children: string;
  as?: "h1" | "h2" | "h3" | "p" | "span" | "div";
  className?: string;
  /** Stagger in ms between letters. */
  stagger?: number;
  /** Initial delay before the first letter animates. */
  startDelay?: number;
};

export function RevealText({
  children,
  as = "h1",
  className,
  stagger = 28,
  startDelay = 0,
}: RevealTextProps) {
  const Tag = as as "h1";
  const letters = useMemo(() => Array.from(children), [children]);

  return (
    <Tag className={cn(className)} aria-label={children}>
      {letters.map((ch, i) => (
        <span
          key={i}
          aria-hidden
          className="letter-rise inline-block whitespace-pre"
          style={{ animationDelay: `${startDelay + i * stagger}ms` }}
        >
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </Tag>
  );
}

// ── ScrollReveal (Intersection Observer wrapper) ─────────────────────────
type ScrollRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  /** CSS translate amount when hidden. */
  offset?: number;
};

export function ScrollReveal({
  children,
  className,
  delay = 0,
  offset = 24,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            obs.disconnect();
          }
        }
      },
      { threshold: 0.15, rootMargin: "-40px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const style: CSSProperties = {
    transition:
      "opacity 900ms cubic-bezier(0.22,1,0.36,1), transform 900ms cubic-bezier(0.22,1,0.36,1)",
    transitionDelay: `${delay}ms`,
    opacity: shown ? 1 : 0,
    transform: shown ? "translateY(0)" : `translateY(${offset}px)`,
  };

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}

// ── MarqueeStrip ─────────────────────────────────────────────────────────
type MarqueeStripProps = {
  items: string[];
  speed?: "slow" | "normal" | "fast";
  className?: string;
};

export function MarqueeStrip({ items, speed = "normal", className }: MarqueeStripProps) {
  const speedClass =
    speed === "slow" ? "marquee-slow" : speed === "fast" ? "marquee-fast" : "";
  return (
    <div className={cn("overflow-hidden border-y border-border/50 py-3", className)}>
      <div className={cn("flex w-max whitespace-nowrap marquee-track", speedClass)}>
        {[...items, ...items].map((item, i) => (
          <span
            key={i}
            className="flex items-center gap-6 px-6 font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground"
          >
            {item}
            <span className="text-accent">✦</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Eyebrow ──────────────────────────────────────────────────────────────
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground",
        className
      )}
    >
      <span className="h-px w-6 bg-current opacity-60" />
      {children}
    </span>
  );
}

// ── LiveDot — for "live / watching" indicators ───────────────────────────
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2 items-center justify-center", className)}>
      <span className="absolute inset-0 rounded-full bg-accent opacity-70 live-dot" />
      <span className="relative size-1.5 rounded-full bg-accent" />
    </span>
  );
}
