import { cn } from "@/lib/utils";

/**
 * Unified status badge. Reads the surrounding context (glass card vs
 * brutal/orange-glass card) via CSS — the same component works on both
 * surfaces. Typography is mono uppercase tracked-wide to match the
 * rest of the editorial language.
 *
 * Tones:
 *   neutral  default muted chip
 *   info     soft blue-grey
 *   success  calm green
 *   warning  amber
 *   critical accent red (uses the theme --destructive)
 */

const toneClasses = {
  neutral: "status-badge-neutral",
  info: "status-badge-info",
  warning: "status-badge-warning",
  critical: "status-badge-critical",
  success: "status-badge-success",
} as const;

export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: keyof typeof toneClasses;
}) {
  return (
    <span className={cn("status-badge", toneClasses[tone])}>
      <span className="status-badge-dot" aria-hidden />
      {label}
    </span>
  );
}
