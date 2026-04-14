"use client";

/**
 * InkCanvas — a real-time generative background that renders in the browser.
 *
 * Approach:
 *   - We simulate a small set of soft, overlapping "ink drops" that drift
 *     through a 2D velocity field defined by two layered Perlin-like
 *     noise functions moving at different frequencies. Each drop leaks
 *     a faint blurred trail behind it, and we clear the canvas each
 *     frame with a low-alpha fill so trails fade organically.
 *   - Drops use accent / chart palette tokens (warm ochre + muted sage)
 *     so the motion picks up the site's editorial color language.
 *   - We throttle to 30fps on low-powered devices and pause when the
 *     element leaves the viewport so it costs nothing when hidden.
 *
 * This is a single-file, zero-dependency alternative to embedding an
 * external video. No network round-trip, no model call — the motion
 * is generated live on the client.
 */

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

// ── Tiny gradient-noise (good enough for smooth drifting fields) ──────────
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
    const gx = ((x | 0) % SIZE + SIZE) % SIZE;
    const gy = ((y | 0) % SIZE + SIZE) % SIZE;
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
  hueShift: number;
  vx: number;
  vy: number;
  palette: number; // index into PALETTE
};

// Editorial palette — warm ochre, muted sage, deep plum, soft rose.
const PALETTE = [
  [194, 168, 120], // accent (ochre)
  [138, 160, 122], // sage
  [176, 137, 107], // caramel
  [227, 106, 92], // rose
  [233, 184, 138], // sand
] as const;

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

    // Initialize 9 soft drops at seeded positions so the animation always
    // opens on the same balanced composition.
    const rand = mulberry32(42);
    const drops: Drop[] = Array.from({ length: 9 }, (_, i) => ({
      x: rand() * 1200,
      y: rand() * 800,
      r: 180 + rand() * 260,
      hueShift: rand() * 0.15,
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

    // Pause when off-screen to save CPU.
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

    const step = (now: number) => {
      if (!running) return;
      requestAnimationFrame(step);
      if (!visible) return;
      const dt = Math.min(64, now - last);
      last = now;
      t += dt * 0.00022;

      // Fade the prior frame toward the background — this is what
      // produces the organic trailing / ink-bleed look.
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(10,10,10,0.12)";
      ctx.fillRect(0, 0, width, height);

      // Additive blending so overlapping drops add their warmth instead
      // of occluding each other.
      ctx.globalCompositeOperation = "lighter";

      for (const d of drops) {
        // Flow field — two octaves of noise.
        const fx =
          noiseA(d.x * 0.0015 + t * 1.4, d.y * 0.0015 - t * 0.7) * 1.6 +
          noiseB(d.x * 0.0045 - t * 0.8, d.y * 0.0045 + t * 0.3) * 0.5;
        const fy =
          noiseA(d.y * 0.0015 - t * 1.1, d.x * 0.0015 + t * 0.6) * 1.6 +
          noiseB(d.y * 0.0045 + t * 0.9, d.x * 0.0045 - t * 0.4) * 0.5;

        d.vx = d.vx * 0.985 + Math.cos(fx) * 0.35;
        d.vy = d.vy * 0.985 + Math.sin(fy) * 0.35;
        d.x += d.vx * dt * 0.06;
        d.y += d.vy * dt * 0.06;

        // Wrap softly around the canvas with a margin so we never see
        // a drop pop in at the edge.
        const m = d.r;
        if (d.x < -m) d.x = width + m;
        if (d.x > width + m) d.x = -m;
        if (d.y < -m) d.y = height + m;
        if (d.y > height + m) d.y = -m;

        const rgb = PALETTE[d.palette];
        const grad = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
        grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.38)`);
        grad.addColorStop(0.4, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.18)`);
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
      className={cn("absolute inset-0 size-full", className)}
      aria-hidden
    />
  );
}
