"use client";

/**
 * InkCanvas — a real-time generative gradient background rendered every
 * frame on the client. Nine soft "ink drops" drift through a 2D velocity
 * field driven by two octaves of seeded gradient noise; each frame fades
 * the prior one toward the current theme background so trails bleed
 * organically instead of stacking into mud.
 *
 * Theme-aware: reads `--background` from CSS so it works cleanly on both
 * the warm-paper light theme and the near-black dark theme.
 * Cost-aware: pauses when off-screen or the tab is hidden.
 */

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

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

type Drop = {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  palette: number;
};

// Warm, inviting palette — ochre, sage, caramel, rose, sand.
const PALETTE = [
  [194, 168, 120],
  [138, 160, 122],
  [193, 39, 45],
  [176, 137, 107],
  [233, 184, 138],
] as const;

function parseCssColor(raw: string): [number, number, number] {
  const s = raw.trim();
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    const n = hex.length === 3
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

export function InkCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
      palette: i % PALETTE.length,
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

    const readThemeBg = (): [number, number, number] => {
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

      // Fade the prior frame toward the current theme background so the
      // canvas always reads correctly in light + dark, and trails softly
      // dissolve instead of building up.
      const [br, bg, bb] = readThemeBg();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(${br}, ${bg}, ${bb}, 0.12)`;
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = "source-over";

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

        const rgb = PALETTE[d.palette];
        const grad = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
        grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.35)`);
        grad.addColorStop(0.4, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.14)`);
        grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
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
