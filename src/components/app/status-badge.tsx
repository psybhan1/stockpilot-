import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "info" | "warning" | "critical" | "success";
}) {
  const tones = {
    neutral: "bg-muted text-foreground",
    info: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    critical: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
    success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  } as const;

  return (
    <Badge className={cn("rounded-full border-transparent px-2.5 py-1", tones[tone])}>
      {label}
    </Badge>
  );
}
