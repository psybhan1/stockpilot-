import { cn } from "@/lib/utils";

type StockPilotMarkProps = {
  className?: string;
  labelClassName?: string;
  showWordmark?: boolean;
};

export function StockPilotMark({
  className,
  labelClassName,
  showWordmark = true,
}: StockPilotMarkProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative flex size-11 items-center justify-center overflow-hidden rounded-2xl bg-[linear-gradient(140deg,rgba(120,53,15,1),rgba(217,119,6,0.92))] shadow-lg shadow-amber-950/15">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_20%,rgba(255,255,255,0.38),transparent_36%),radial-gradient(circle_at_74%_78%,rgba(255,255,255,0.22),transparent_24%)]" />
        <div className="relative flex size-7 items-center justify-center rounded-full border border-white/30 bg-white/18 backdrop-blur">
          <div className="absolute h-0.5 w-5 rounded-full bg-white/92" />
          <div className="absolute h-5 w-0.5 rounded-full bg-white/65" />
          <div className="size-3 rounded-full bg-white" />
        </div>
      </div>
      {showWordmark ? (
        <div className={cn("min-w-0", labelClassName)}>
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-amber-600 dark:text-amber-300">
            Inventory operating system
          </p>
          <p className="truncate text-lg font-semibold tracking-tight">StockPilot</p>
        </div>
      ) : null}
    </div>
  );
}
