"use client";

/**
 * InkCanvas — generative gradient background that lives behind the whole
 * app. Each route gets its own palette, and we interpolate smoothly
 * between palettes over ~1.2 s when the path changes.
 *
 * Theme-aware: reads --background from CSS each frame so the fade trick
 * works on both the light paper theme and the near-black dark theme.
 * Cost-aware: pauses when off-screen or the tab is hidden.
 */

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import { cn } from "@/lib/utils";

type RGB = [number, number, number];

// Named palettes — keep entries to 5 colors so interpolation is cheap.
const PALETTES: Record<string, readonly RGB[]> = {
  dashboard: [
    [194, 168, 120], // ochre
    [176, 137, 107], // caramel
    [138, 160, 122], // sage
    [233, 184, 138], // sand
    [193, 39, 45], // red accent
  ],
  inventory: [
    [138, 160, 122], // sage
    [194, 168, 120], // ochre
    [176, 137, 107], // caramel
    [220, 210, 180], // cream
    [100, 140, 110], // deeper sage
  ],
  alerts: [
    [193, 39, 45], // red
    [227, 106, 92], // coral
    [233, 140, 90], // orange
    [194, 168, 120], // ochre
    [160, 40, 50], // deeper red
  ],
  suppliers: [
    [90, 120, 150], // blue-grey
    [138, 160, 122], // sage
    [176, 137, 107], // caramel
    [120, 145, 175], // steel
    [60, 90, 130], // deep blue
  ],
  "purchase-orders": [
    [194, 168, 120], // ochre
    [176, 137, 107], // caramel
    [227, 106, 92], // coral
    [233, 184, 138], // sand
    [193, 39, 45], // red
  ],
  recipes: [
    [210, 140, 110], // terracotta
    [227, 180, 160], // rose
    [194, 168, 120], // ochre
    [176, 137, 107], // caramel
    [230, 200, 170], // peach
  ],
  "stock-count": [
    [138, 160, 122], // sage
    [194, 168, 120], // ochre
    [170, 180, 130], // olive
    [210, 200, 150], // straw
    [100, 130, 100], // deep sage
  ],
  "pos-mapping": [
    [90, 120, 170], // indigo
    [138, 160, 122], // sage
    [194, 168, 120], // ochre
    [150, 140, 180], // lavender
    [70, 100, 150], // deep indigo
  ],
  settings: [
    [150, 150, 145], // stone
    [180, 175, 160], // silver
    [200, 195, 180], // platinum
    [120, 125, 125], // slate
    [194, 168, 120], // ochre accent
  ],
  notifications: [
    [230, 170, 100], // amber
    [227, 106, 92], // coral
    [180, 140, 110], // bronze
    [210, 180, 140], // sand
    [200, 90, 70], // terracotta
  ],
  "agent-tasks": [
    [140, 130, 180], // purple
    [90, 120, 170], // indigo
    [138, 160, 122], // sage
    [180, 155, 200], // lavender
    [110, 100, 160], // violet
  ],
};

const DEFAULT_PALETTE: readonly RGB[] = PALETTES.dashboard;

function pickPalette(pathname: string | null): readonly RGB[] {
  if (!pathname) return DEFAULT_PALETTE;
  const first = pathname.split("/").filter(Boolean)[0] ?? "";
  return PALETTES[first] ?? DEFAULT_PALETTE;
}

// ── Seeded noise (tiny Perlin-ish) ────────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed: number) {
  const rand = mulberry32(seed);
  const grid: number[] = [];
  const SIZE = 256;
  for (let i = 0; i < SIZE * SIZE; i++) grid.push(rand() * Math.PI * 2);
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const at = (x: number, y: number) => {
    const gx = (((x | 0) % SIZE) + SIZE) % SIZE;
    const gy = (((y | 0) % SIZE) + SIZE) % SIZE;
    return grid[gy * SIZE + gx];
  };
  return (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const a = Math.cos(at(x0, y0));
    const b = Math.cos(at(x0 + 1, y0));
    const c = Math.cos(at(x0, y0 + 1));
    const d = Math.cos(at(x0 + 1, y0 + 1));
    const u = fade(fx);
    const v = fade(fy);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
}

type Drop = { x: number; y: number; r: number; vx: number; vy: number; idx: number };

function parseCssColor(raw: string): RGB {
  const s = raw.trim();
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    const n =
      hex.length === 3
        ? hex.split("").map((c) => parseInt(c + c, 16))
        : [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    return [n[0] ?? 245, n[1] ?? 243, n[2] ?? 238];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
    return [parts[0] ?? 245, parts[1] ?? 243, parts[2] ?? 238];
  }
  return [245, 243, 238];
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function InkCanvas({ className }: { className?: string }) {
  const pathname = usePathname();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Stable palette ref the animation loop reads each frame.
  const paletteRef = useRef<{
    current: RGB[];
    target: RGB[];
    tween: number;
  }>({
    current: DEFAULT_PALETTE.map((c) => [...c] as unknown as RGB),
    target: DEFAULT_PALETTE.map((c) => [...c] as unknown as RGB),
    tween: 1,
  });

  // Selected target palette — re-computed whenever the route changes.
  const targetPalette = useMemo(() => pickPalette(pathname), [pathname]);

  // On route change: set a new target, restart the tween.
  useEffect(() => {
    paletteRef.current.target = targetPalette.map((c) => [...c] as unknown as RGB);
    paletteRef.current.tween = 0;
  }, [targetPalette]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const resizeObserver = new ResizeObserver(() => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      resize();
    });
    resizeObserver.observe(canvas);

    const rand = mulberry32(42);
    const drops: Drop[] = Array.from({ length: 9 }, (_, i) => ({
      x: rand() * (width || 1200),
      y: rand() * (height || 800),
      r: 280 + rand() * 360,
      vx: (rand() - 0.5) * 0.4,
      vy: (rand() - 0.5) * 0.4,
      idx: i % 5,
    }));

    const noiseA = makeNoise(7);
    const noiseB = makeNoise(91);

    let running = true;
    let visible = true;
    let last = performance.now();
    let t = 0;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible = e.isIntersecting;
      },
      { threshold: 0 }
    );
    io.observe(canvas);

    const handleVis = () => {
      visible = visible && document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", handleVis);

    // Palette tween speed (1 / seconds) — 1.2 s palette blend.
    const TWEEN_PER_MS = 1 / 1200;

    const readThemeBg = (): RGB => {
      const styles = getComputedStyle(document.documentElement);
      const raw = styles.getPropertyValue("--background") || "#F5F3EE";
      return parseCssColor(raw);
    };

    const step = (now: number) => {
      if (!running) return;
      requestAnimationFrame(step);
      if (!visible) return;
      const dt = Math.min(64, now - last);
      last = now;
      t += dt * 0.00018;

      // Advance palette tween.
      const pal = paletteRef.current;
      if (pal.tween < 1) {
        pal.tween = Math.min(1, pal.tween + dt * TWEEN_PER_MS);
        const eased =
          pal.tween < 0.5 ? 2 * pal.tween * pal.tween : 1 - Math.pow(-2 * pal.tween + 2, 2) / 2;
        for (let i = 0; i < pal.current.length; i++) {
          const cur = pal.current[i];
          const tgt = pal.target[i] ?? pal.target[pal.target.length - 1];
          cur[0] = lerp(cur[0], tgt[0], eased) as number;
          cur[1] = lerp(cur[1], tgt[1], eased) as number;
          cur[2] = lerp(cur[2], tgt[2], eased) as number;
        }
      }

      const [br, bg, bb] = readThemeBg();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(${br}, ${bg}, ${bb}, 0.12)`;
      ctx.fillRect(0, 0, width, height);

      for (const d of drops) {
        const fx =
          noiseA(d.x * 0.0015 + t * 1.4, d.y * 0.0015 - t * 0.7) * 1.6 +
          noiseB(d.x * 0.0045 - t * 0.8, d.y * 0.0045 + t * 0.3) * 0.5;
        const fy =
          noiseA(d.y * 0.0015 - t * 1.1, d.x * 0.0015 + t * 0.6) * 1.6 +
          noiseB(d.y * 0.0045 + t * 0.9, d.x * 0.0045 - t * 0.4) * 0.5;

        d.vx = d.vx * 0.985 + Math.cos(fx) * 0.35;
        d.vy = d.vy * 0.985 + Math.sin(fy) * 0.35;
        d.x += d.vx * dt * 0.05;
        d.y += d.vy * dt * 0.05;

        const m = d.r;
        if (d.x < -m) d.x = width + m;
        if (d.x > width + m) d.x = -m;
        if (d.y < -m) d.y = height + m;
        if (d.y > height + m) d.y = -m;

        const rgb = paletteRef.current.current[d.idx] ?? paletteRef.current.current[0];
        const grad = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
        grad.addColorStop(0, `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},0.35)`);
        grad.addColorStop(0.4, `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},0.14)`);
        grad.addColorStop(1, `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    requestAnimationFrame(step);

    return () => {
      running = false;
      resizeObserver.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", handleVis);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={cn("pointer-events-none size-full", className)}
      aria-hidden
    />
  );
}
