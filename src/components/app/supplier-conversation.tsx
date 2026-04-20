/**
 * Renders the full back-and-forth between us and the supplier for
 * one purchase order. Each entry shows direction (we sent / they
 * replied), timestamp, intent badge (CONFIRMED / DELAYED / etc.
 * for inbound), and either the rendered HTML or plain-text body.
 *
 * HTML is rendered inside a sandboxed iframe so a hostile supplier
 * (or a future LLM-classified message) can't inject scripts into
 * our app. We use an explicit srcDoc + sandbox="" — no scripts,
 * forms, or top-navigation allowed.
 */

"use client";

import { useState } from "react";

type CommunicationDirection = "OUTBOUND" | "INBOUND";

export type ConversationEntry = {
  id: string;
  direction: CommunicationDirection;
  subject: string | null;
  body: string;
  status: string;
  createdAt: string; // ISO
  sentAt: string | null; // ISO
  metadata: Record<string, unknown> | null;
};

export type SupplierConversationProps = {
  entries: ConversationEntry[];
  ourEmail?: string | null;
  supplierEmail?: string | null;
};

export function SupplierConversation({
  entries,
  ourEmail,
  supplierEmail,
}: SupplierConversationProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-[24px] border border-dashed border-border px-4 py-8 text-center">
        <p className="font-medium">No supplier messages yet</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Once we send the order, the email and any replies from the supplier
          will appear here as a thread.
        </p>
      </div>
    );
  }

  // Oldest first reads as a conversation.
  const ordered = [...entries].sort((a, b) => {
    const aTs = (a.sentAt ?? a.createdAt) ?? "";
    const bTs = (b.sentAt ?? b.createdAt) ?? "";
    return aTs.localeCompare(bTs);
  });

  return (
    <div className="space-y-3">
      {ordered.map((entry) => (
        <ConversationItem
          key={entry.id}
          entry={entry}
          ourEmail={ourEmail}
          supplierEmail={supplierEmail}
        />
      ))}
    </div>
  );
}

function ConversationItem({
  entry,
  ourEmail,
  supplierEmail,
}: {
  entry: ConversationEntry;
  ourEmail?: string | null;
  supplierEmail?: string | null;
}) {
  const [showHtml, setShowHtml] = useState(true);
  const meta = entry.metadata ?? {};
  const html = typeof meta.html === "string" ? meta.html : null;
  const fromHeader =
    typeof meta.fromHeader === "string" ? meta.fromHeader : null;
  const intent = typeof meta.intent === "string" ? meta.intent : null;

  const isOutbound = entry.direction === "OUTBOUND";
  const fromLabel = isOutbound
    ? ourEmail ?? "you"
    : fromHeader ?? supplierEmail ?? entry.metadata?.recipient ?? "supplier";
  const toLabel = isOutbound
    ? (typeof meta.recipient === "string" ? meta.recipient : supplierEmail) ??
      "supplier"
    : ourEmail ?? "you";

  const ts = entry.sentAt ?? entry.createdAt;
  const tsLabel = ts ? new Date(ts).toLocaleString() : "—";

  return (
    <div
      className={
        "notif-card overflow-hidden p-0 " +
        (isOutbound
          ? "border-l-4 border-l-stone-400/70"
          : intentBorderColor(intent))
      }
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="flex items-start gap-3">
          <div
            className={
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base " +
              (isOutbound ? "bg-stone-200 text-stone-700" : intentBubble(intent))
            }
            aria-hidden
          >
            {isOutbound ? "📤" : intentEmoji(intent)}
          </div>
          <div>
            <p className="text-sm font-medium">
              {isOutbound ? "We sent" : "Supplier replied"}{" "}
              <span className="text-muted-foreground font-normal">
                · {tsLabel}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              From <span className="font-medium text-foreground">{String(fromLabel)}</span>
              {" "}→ {String(toLabel)}
            </p>
            {entry.subject ? (
              <p className="mt-1 text-sm font-medium">{entry.subject}</p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!isOutbound && intent ? (
            <span
              className={
                "rounded-full px-2.5 py-0.5 text-xs font-medium " +
                intentBadgeClass(intent)
              }
            >
              {intentLabel(intent)}
            </span>
          ) : (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {entry.status}
            </span>
          )}
        </div>
      </div>

      <div className="px-4 pb-4">
        {html ? (
          <>
            <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => setShowHtml(true)}
                className={
                  "rounded-full px-2.5 py-1 " +
                  (showHtml
                    ? "bg-foreground text-background"
                    : "hover:bg-muted")
                }
              >
                Email view
              </button>
              <button
                type="button"
                onClick={() => setShowHtml(false)}
                className={
                  "rounded-full px-2.5 py-1 " +
                  (!showHtml
                    ? "bg-foreground text-background"
                    : "hover:bg-muted")
                }
              >
                Plain text
              </button>
            </div>
            {showHtml ? (
              <iframe
                title={entry.subject ?? "Email body"}
                sandbox=""
                srcDoc={html}
                className="mt-2 h-[460px] w-full rounded-2xl border border-border bg-white"
              />
            ) : (
              <pre className="mt-2 max-h-[460px] overflow-auto whitespace-pre-wrap rounded-2xl bg-muted p-3 text-sm leading-relaxed text-foreground">
                {entry.body}
              </pre>
            )}
          </>
        ) : (
          <pre className="mt-3 max-h-[460px] overflow-auto whitespace-pre-wrap rounded-2xl bg-muted p-3 text-sm leading-relaxed text-foreground">
            {entry.body}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Intent visuals ───────────────────────────────────────────────────
function intentEmoji(intent: string | null): string {
  switch (intent) {
    case "CONFIRMED":
      return "✅";
    case "OUT_OF_STOCK":
      return "⚠️";
    case "DELAYED":
      return "⏰";
    case "QUESTION":
      return "❓";
    default:
      return "📨";
  }
}

function intentLabel(intent: string): string {
  switch (intent) {
    case "CONFIRMED":
      return "Confirmed";
    case "OUT_OF_STOCK":
      return "Out of stock";
    case "DELAYED":
      return "Delayed";
    case "QUESTION":
      return "Question";
    default:
      return intent.toLowerCase();
  }
}

function intentBadgeClass(intent: string): string {
  switch (intent) {
    case "CONFIRMED":
      return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200";
    case "OUT_OF_STOCK":
      return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
    case "DELAYED":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
    case "QUESTION":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function intentBubble(intent: string | null): string {
  switch (intent) {
    case "CONFIRMED":
      return "bg-green-100 text-green-700";
    case "OUT_OF_STOCK":
      return "bg-red-100 text-red-700";
    case "DELAYED":
      return "bg-amber-100 text-amber-700";
    case "QUESTION":
      return "bg-blue-100 text-blue-700";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function intentBorderColor(intent: string | null): string {
  switch (intent) {
    case "CONFIRMED":
      return "border-l-4 border-l-green-500";
    case "OUT_OF_STOCK":
      return "border-l-4 border-l-red-500";
    case "DELAYED":
      return "border-l-4 border-l-amber-500";
    case "QUESTION":
      return "border-l-4 border-l-blue-500";
    default:
      return "border-l-4 border-l-stone-300";
  }
}
