import { StockPilotMark } from "@/components/app/stockpilot-mark";
import { Skeleton } from "@/components/ui/skeleton";

type AppLoadingStateProps = {
  mode?: "launch" | "auth" | "workspace";
};

export function AppLoadingState({ mode = "workspace" }: AppLoadingStateProps) {
  if (mode === "workspace") {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.12),transparent_24%),linear-gradient(180deg,_rgba(255,252,248,1),rgba(250,250,249,1))] px-4 py-4 dark:bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.08),transparent_18%),linear-gradient(180deg,_rgba(12,10,9,1),rgba(24,24,27,1))]">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-6">
          <div className="flex items-center justify-between rounded-[28px] border border-border/60 bg-background/88 px-4 py-3 backdrop-blur-xl">
            <StockPilotMark />
            <div className="flex items-center gap-2">
              <Skeleton className="h-10 w-10 rounded-full" />
              <Skeleton className="h-10 w-10 rounded-full" />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)_320px]">
            <div className="hidden lg:flex lg:flex-col lg:gap-4">
              <Skeleton className="h-28 rounded-[28px]" />
              <Skeleton className="h-72 rounded-[28px]" />
              <Skeleton className="h-28 rounded-[28px]" />
            </div>

            <div className="flex min-w-0 flex-col gap-6">
              <Skeleton className="h-72 rounded-[30px]" />
              <div className="grid gap-4 md:grid-cols-3">
                <Skeleton className="h-36 rounded-[28px]" />
                <Skeleton className="h-36 rounded-[28px]" />
                <Skeleton className="h-36 rounded-[28px]" />
              </div>
              <div className="grid gap-6 xl:grid-cols-[1.1fr_1.1fr_0.9fr]">
                <Skeleton className="h-96 rounded-[28px]" />
                <Skeleton className="h-96 rounded-[28px]" />
                <div className="flex flex-col gap-6">
                  <Skeleton className="h-44 rounded-[28px]" />
                  <Skeleton className="h-44 rounded-[28px]" />
                </div>
              </div>
            </div>

            <div className="hidden lg:block">
              <Skeleton className="h-[32rem] rounded-[28px]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const description =
    mode === "auth"
      ? "Loading the workspace and your demo access so you can get straight into counting, reordering, and review."
      : "Preparing inventory, alerts, recipes, and approvals so the team lands on a calm, ready-to-use workspace.";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.16),transparent_24%),linear-gradient(180deg,_rgba(255,252,248,1),rgba(250,250,249,1))] px-4 py-10 dark:bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.1),transparent_18%),linear-gradient(180deg,_rgba(12,10,9,1),rgba(24,24,27,1))]">
      <div className="mx-auto flex min-h-[80vh] max-w-6xl items-center">
        <div className="grid w-full gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="flex flex-col gap-5">
            <StockPilotMark />
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-amber-600 dark:text-amber-300">
                Launching workspace
              </p>
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                Inventory that feels calm before the rush gets loud.
              </h1>
              <p className="max-w-2xl text-lg text-muted-foreground">{description}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-[28px] border border-border/60 bg-card/86 p-5 shadow-lg shadow-black/5">
                <Skeleton className="h-4 w-20 rounded-full" />
                <Skeleton className="mt-5 h-9 w-16 rounded-2xl" />
                <Skeleton className="mt-5 h-4 w-full rounded-full" />
              </div>
              <div className="rounded-[28px] border border-border/60 bg-card/86 p-5 shadow-lg shadow-black/5">
                <Skeleton className="h-4 w-24 rounded-full" />
                <Skeleton className="mt-5 h-9 w-12 rounded-2xl" />
                <Skeleton className="mt-5 h-4 w-4/5 rounded-full" />
              </div>
              <div className="rounded-[28px] border border-border/60 bg-card/86 p-5 shadow-lg shadow-black/5">
                <Skeleton className="h-4 w-28 rounded-full" />
                <Skeleton className="mt-5 h-9 w-14 rounded-2xl" />
                <Skeleton className="mt-5 h-4 w-3/4 rounded-full" />
              </div>
            </div>
          </div>

          <div className="rounded-[32px] border border-border/60 bg-card/90 p-5 shadow-2xl shadow-black/10 backdrop-blur">
            <div className="flex flex-col gap-4">
              <Skeleton className="h-6 w-40 rounded-full" />
              <Skeleton className="h-4 w-64 rounded-full" />
            </div>
            <div className="mt-6 flex flex-col gap-4">
              <Skeleton className="h-14 rounded-2xl" />
              <Skeleton className="h-14 rounded-2xl" />
              <Skeleton className="h-12 rounded-2xl" />
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-16 rounded-2xl" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
