"use client";

/**
 * Global pointer-tracker that writes two CSS custom properties on any
 * .notif-card the cursor is over:
 *
 *   --gloss-x   ←   horizontal cursor % inside the card
 *   --gloss-y   ←   vertical cursor % inside the card
 *
 * The card's ::after uses these to position a radial specular
 * highlight, so the shine actually follows the pointer — same trick
 * macOS buttons and iOS glass controls use. One rAF-throttled listener
 * for the whole page; no React re-renders.
 */

import { useEffect } from "react";

export function PointerGloss() {
  useEffect(() => {
    let pending: number | null = null;
    let lastEvent: MouseEvent | null = null;
    let lastTarget: HTMLElement | null = null;

    const apply = () => {
      pending = null;
      const e = lastEvent;
      if (!e) return;

      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        ".notif-card, .brutal-card"
      );

      // Clear the previous card's gloss when the cursor leaves it.
      if (lastTarget && lastTarget !== target) {
        lastTarget.style.removeProperty("--gloss-on");
      }

      if (!target) {
        lastTarget = null;
        return;
      }

      const rect = target.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      target.style.setProperty("--gloss-x", `${x}%`);
      target.style.setProperty("--gloss-y", `${y}%`);
      target.style.setProperty("--gloss-on", "1");
      lastTarget = target;
    };

    const onMove = (e: MouseEvent) => {
      lastEvent = e;
      if (pending == null) pending = requestAnimationFrame(apply);
    };

    const onLeaveWindow = () => {
      if (lastTarget) {
        lastTarget.style.removeProperty("--gloss-on");
        lastTarget = null;
      }
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseleave", onLeaveWindow);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeaveWindow);
      if (pending != null) cancelAnimationFrame(pending);
    };
  }, []);

  return null;
}
