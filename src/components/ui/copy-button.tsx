"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Minimal copy-to-clipboard button for secrets / webhook URLs. Shows
 * a transient check icon on success. Not a toast — secrets shouldn't
 * leak into app-wide notification logs, and the inline check is
 * faster feedback anyway.
 */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {
            // clipboard API can fail on insecure contexts or if the
            // user has explicitly disabled it. Silently no-op — the
            // admin can still highlight-drag the code block next to
            // the button.
          });
      }}
      className={
        "inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/60 px-2 py-1 text-[10px] font-medium transition hover:bg-muted " +
        (className ?? "")
      }
      aria-label={copied ? "Copied" : `Copy ${label ?? "value"}`}
    >
      {copied ? (
        <>
          <Check className="size-3" />
          Copied
        </>
      ) : (
        <>
          <Copy className="size-3" />
          {label ?? "Copy"}
        </>
      )}
    </button>
  );
}
