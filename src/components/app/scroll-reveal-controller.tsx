"use client";

/**
 * Scroll-triggered reveal controller. Watches the DOM for every card-
 * like element (`.notif-card`, `.brutal-card`, `[data-reveal]`) and
 * adds `.in-view` when it crosses the viewport. CSS in globals.css
 * owns the hidden → visible transition; this component is only the
 * observer plumbing.
 *
 * Uses one IntersectionObserver for the whole page and a
 * MutationObserver so that newly-mounted cards (after client-side
 * navigation, filter changes, etc.) are auto-observed. Each element
 * is observed once; once it reveals it stays revealed so users never
 * see it re-hide when scrolling up and back.
 */

import { useEffect } from "react";

const REVEAL_SELECTOR = [
  ".notif-card",
  ".brutal-card",
  "[data-reveal]",
].join(", ");

export function ScrollRevealController() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    // For users who prefer reduced motion: mark everything visible
    // immediately, no animation.
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            observer.unobserve(entry.target);
          }
        }
      },
      {
        threshold: 0.08,
        // Start the animation slightly before the element is fully in view
        // so by the time the user registers the card, it's already resolving.
        rootMargin: "0px 0px -8% 0px",
      }
    );

    const seen = new WeakSet<Element>();
    const attach = (el: Element) => {
      if (seen.has(el)) return;
      seen.add(el);
      if (prefersReduced) {
        el.classList.add("in-view");
        return;
      }
      // If already visible on page load, reveal with a small staggered
      // delay based on DOM order so the first screen cascades instead
      // of popping as a block.
      observer.observe(el);
    };

    const scanAndAttach = (root: ParentNode) => {
      root.querySelectorAll(REVEAL_SELECTOR).forEach(attach);
    };

    scanAndAttach(document);

    // Watch for cards added later (filter changes, client-side route
    // transitions, lazy lists, etc.).
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          const el = node as Element;
          if (el.matches?.(REVEAL_SELECTOR)) attach(el);
          scanAndAttach(el);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mo.disconnect();
    };
  }, []);

  return null;
}
