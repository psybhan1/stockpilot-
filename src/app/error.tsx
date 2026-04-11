"use client";

import Link from "next/link";
import { RefreshCcw, ShieldCheck } from "lucide-react";

import { StockPilotMark } from "@/components/app/stockpilot-mark";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html lang="en">
      <body className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.16),transparent_24%),linear-gradient(180deg,_rgba(255,252,248,1),rgba(250,250,249,1))] px-4 py-10 text-foreground dark:bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.1),transparent_18%),linear-gradient(180deg,_rgba(12,10,9,1),rgba(24,24,27,1))]">
        <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center">
          <div className="grid w-full gap-10 rounded-[36px] border border-border/60 bg-card/88 p-6 shadow-2xl shadow-black/10 backdrop-blur lg:grid-cols-[1.05fr_0.95fr] lg:p-8">
            <div className="flex flex-col gap-5">
              <StockPilotMark />
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium uppercase tracking-[0.24em] text-amber-600 dark:text-amber-300">
                  Something went wrong
                </p>
                <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                  The app hit a problem, but your inventory data is still protected.
                </h1>
                <p className="max-w-2xl text-lg text-muted-foreground">
                  Try refreshing this view first. If the issue keeps showing up, head back home and
                  retry the workflow from there.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => reset()}
                  variant="default"
                  size="lg"
                  className="rounded-2xl px-5"
                >
                  <RefreshCcw data-icon="inline-start" />
                  Try again
                </Button>
                <Link
                  href="/"
                  className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-2xl px-5")}
                >
                  Go to home
                </Link>
              </div>
            </div>

            <div className="rounded-[30px] border border-border/60 bg-background/82 p-5">
              <ShieldCheck className="size-6 text-amber-600 dark:text-amber-300" />
              <h2 className="mt-4 text-xl font-semibold">Helpful context</h2>
              <div className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground">
                <p>
                  StockPilot keeps ledger truth, counts, and approvals stored separately from the
                  screen state.
                </p>
                <p>
                  Refreshing the page will not delete counts, supplier drafts, or synced sales
                  events.
                </p>
                {error.digest ? <p>Error reference: {error.digest}</p> : null}
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
