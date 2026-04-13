import { cn } from "@/lib/utils";

const toneConfig = {
  neutral: {
    dot: "bg-zinc-500",
    text: "text-zinc-400",
    bg: "bg-zinc-500/10",
  },
  info: {
    dot: "bg-blue-500",
    text: "text-blue-400",
    bg: "bg-blue-500/10",
  },
  warning: {
    dot: "bg-amber-400",
    text: "text-amber-400",
    bg: "bg-amber-400/10",
  },
  critical: {
    dot: "bg-red-500",
    text: "text-red-400",
    bg: "bg-red-500/10",
  },
  success: {
    dot: "bg-emerald-500",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
} as const;

export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: keyof typeof toneConfig;
}) {
  const c = toneConfig[tone];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium",
        c.bg
      )}
    >
      <span className={cn("size-1.5 rounded-full", c.dot)} />
      <span className={c.text}>{label}</span>
    </span>
  );
}
