"use client";

/**
 * Minimal in-house toast system.
 *
 * Client callers:
 *   import { toast } from "@/components/app/toaster";
 *   toast.success("Saved");
 *
 * Server actions trigger toasts via redirect with search params:
 *   redirect("/purchase-orders?toast=success&msg=Approved");
 * The Toaster component auto-reads those params on mount and fires.
 *
 * Design: matches the glass card language (22px radius, backdrop
 * blur, top rim highlight), slides in from the bottom, auto-
 * dismisses after 3.5s, stackable.
 */

import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";
type ToastEntry = { id: number; kind: ToastKind; message: string };

const EVENT = "stockpilot:toast";

function fire(kind: ToastKind, message: string) {
  if (typeof window === "undefined") return;
  const id = Date.now() + Math.random();
  window.dispatchEvent(
    new CustomEvent<ToastEntry>(EVENT, { detail: { id, kind, message } })
  );
}

export const toast = {
  success: (m: string) => fire("success", m),
  error: (m: string) => fire("error", m),
  info: (m: string) => fire("info", m),
};

export function Toaster() {
  return (
    <Suspense fallback={null}>
      <ToasterInner />
    </Suspense>
  );
}

function ToasterInner() {
  const [entries, setEntries] = useState<ToastEntry[]>([]);
  const searchParams = useSearchParams();
  const router = useRouter();

  const dismiss = useCallback((id: number) => {
    setEntries((e) => e.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const ce = event as CustomEvent<ToastEntry>;
      setEntries((e) => [...e, ce.detail]);
      setTimeout(() => dismiss(ce.detail.id), 3500);
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, [dismiss]);

  // Read ?toast=success&msg=... on mount, fire once, strip the params.
  useEffect(() => {
    const kind = searchParams.get("toast") as ToastKind | null;
    const msg = searchParams.get("msg");
    if (kind && msg && (kind === "success" || kind === "error" || kind === "info")) {
      toast[kind](msg);
      const url = new URL(window.location.href);
      url.searchParams.delete("toast");
      url.searchParams.delete("msg");
      router.replace(url.pathname + (url.search || ""), { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (entries.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
      {entries.map((t) => (
        <ToastCard key={t.id} entry={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({
  entry,
  onDismiss,
}: {
  entry: ToastEntry;
  onDismiss: () => void;
}) {
  const Icon =
    entry.kind === "success"
      ? CheckCircle2
      : entry.kind === "error"
      ? CircleAlert
      : Info;

  const accent =
    entry.kind === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : entry.kind === "error"
      ? "text-[var(--destructive)]"
      : "text-muted-foreground";

  return (
    <div
      role="status"
      className={cn(
        "notif-card pointer-events-auto flex w-full max-w-sm items-start gap-3 p-3 pr-2",
        "opacity-100 !translate-y-0 !blur-0",
        "animate-[toastIn_0.35s_cubic-bezier(0.22,1,0.36,1)_both]"
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", accent)} />
      <p className="flex-1 text-sm leading-snug">{entry.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </button>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(20px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
