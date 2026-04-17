"use client";

/**
 * Global keyboard shortcuts + a `?` cheat-sheet overlay.
 *
 * Supported shortcuts:
 *   Cmd/Ctrl+K  — command palette (handled in CommandPalette)
 *   /           — focus the command palette (handled there)
 *   g d         — Dashboard
 *   g i         — Inventory
 *   g o         — Orders
 *   g m         — Margins
 *   g v         — Variance
 *   g a         — Analytics
 *   g s         — Suppliers
 *   g r         — Recipes (Menu)
 *   g c         — Stock count
 *   ?           — Show this help
 *
 * Sequence shortcuts (`g <letter>`) use a 1.2s grace window after
 * `g` is pressed. Any non-matching key cancels the pending
 * sequence, so accidentally hitting `g` then typing something else
 * doesn't leave you stuck.
 *
 * All shortcuts are disabled when focus is in an input / textarea
 * / contenteditable surface, so typing "g" into a search box
 * doesn't navigate you away.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Keyboard, X } from "lucide-react";

type Shortcut = {
  combo: string;
  label: string;
  href?: string;
  /** Optional custom handler that runs instead of navigation. */
  action?: () => void;
};

const NAV_SHORTCUTS: Shortcut[] = [
  { combo: "g d", label: "Go to dashboard", href: "/dashboard" },
  { combo: "g i", label: "Go to inventory", href: "/inventory" },
  { combo: "g o", label: "Go to orders", href: "/purchase-orders" },
  { combo: "g m", label: "Go to margins", href: "/margins" },
  { combo: "g v", label: "Go to variance", href: "/variance" },
  { combo: "g p", label: "Go to pricing", href: "/pricing" },
  { combo: "g a", label: "Go to analytics", href: "/analytics" },
  { combo: "g s", label: "Go to suppliers", href: "/suppliers" },
  { combo: "g r", label: "Go to menu (recipes)", href: "/recipes" },
  { combo: "g c", label: "Go to stock count", href: "/stock-count" },
];

const ACTION_SHORTCUTS: Array<{ combo: string; label: string }> = [
  { combo: "⌘ K / Ctrl K", label: "Open command palette" },
  { combo: "/", label: "Focus command palette" },
  { combo: "?", label: "Show this shortcut list" },
  { combo: "esc", label: "Close overlay / palette" },
];

export function KeyboardShortcuts() {
  const [helpOpen, setHelpOpen] = useState(false);
  const router = useRouter();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Auto-focus the close button when the help overlay opens so a
  // keyboard user can dismiss with Enter / space without hunting.
  // Also captures Tab inside the modal — since the only interactive
  // elements are the close button and outside links (none), tab
  // just loops back.
  useEffect(() => {
    if (helpOpen) {
      setTimeout(() => closeButtonRef.current?.focus(), 10);
    }
  }, [helpOpen]);

  useEffect(() => {
    let gPending = false;
    let gTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelGPending = () => {
      gPending = false;
      if (gTimer) {
        clearTimeout(gTimer);
        gTimer = null;
      }
    };

    const isTypingElsewhere = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return false;
      const tag = target.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
      );
    };

    const handler = (e: KeyboardEvent) => {
      // Close the help overlay on Escape.
      if (e.key === "Escape" && helpOpen) {
        setHelpOpen(false);
        return;
      }

      if (isTypingElsewhere(e)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // `?` opens the help overlay. Many keyboards produce "?" with
      // Shift, so we check the key directly rather than testing
      // Shift state.
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }

      // Sequence: `g` then a letter.
      if (gPending) {
        const match = NAV_SHORTCUTS.find(
          (s) => s.combo === `g ${e.key.toLowerCase()}`
        );
        cancelGPending();
        if (match) {
          e.preventDefault();
          if (match.href) router.push(match.href);
          if (match.action) match.action();
        }
        return;
      }

      if (e.key === "g" || e.key === "G") {
        gPending = true;
        gTimer = setTimeout(cancelGPending, 1200);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      cancelGPending();
    };
  }, [router, helpOpen]);

  if (!helpOpen) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="kbd-shortcuts-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={() => setHelpOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
          <div className="inline-flex items-center gap-2">
            <Keyboard className="size-4 text-muted-foreground" aria-hidden />
            <h2 id="kbd-shortcuts-title" className="text-sm font-semibold">
              Keyboard shortcuts
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setHelpOpen(false)}
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Close keyboard shortcuts"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="grid gap-6 p-5 sm:grid-cols-2">
          <section>
            <h3 className="mb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Actions
            </h3>
            <ul className="space-y-1.5">
              {ACTION_SHORTCUTS.map((s) => (
                <ShortcutRow key={s.combo} combo={s.combo} label={s.label} />
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Jump to page
            </h3>
            <ul className="space-y-1.5">
              {NAV_SHORTCUTS.map((s) => (
                <ShortcutRow key={s.combo} combo={s.combo} label={s.label} />
              ))}
            </ul>
          </section>
        </div>

        <div className="border-t border-border/60 px-5 py-3 text-[11px] text-muted-foreground">
          Tap <kbd className="rounded border border-border px-1 font-mono">?</kbd>{" "}
          on any page to reopen this list. Shortcuts are disabled while
          typing in a form field.
        </div>
      </div>
    </div>
  );
}

function ShortcutRow({ combo, label }: { combo: string; label: string }) {
  const parts = combo.split(/\s+/);
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="text-foreground/90">{label}</span>
      <span className="inline-flex items-center gap-1">
        {parts.map((p, i) => (
          <kbd
            key={i}
            className="inline-flex min-w-[22px] items-center justify-center rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
          >
            {p}
          </kbd>
        ))}
      </span>
    </li>
  );
}
