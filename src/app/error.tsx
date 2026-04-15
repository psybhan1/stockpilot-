"use client";

import Link from "next/link";
import { RefreshCcw, ShieldCheck } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html lang="en">
      <body className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
        <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1200px] items-center px-4 py-12 sm:px-6 lg:px-10">
          <div className="w-full">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.28em] text-[var(--destructive)]">
              <span className="mr-2 inline-block h-px w-6 align-middle bg-current opacity-60" />
              Something went wrong
            </p>

            <h1 className="mt-6 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(3rem,10vw,8rem)]">
              Hit a
              <br />
              snag.
            </h1>

            <p className="mt-6 max-w-xl text-sm text-muted-foreground sm:text-base">
              The inventory data is safe. Try again — refreshing won't erase
              counts, drafts, or synced sales events.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                onClick={() => reset()}
                className="h-11 px-5 rounded-xl"
              >
                <RefreshCcw data-icon="inline-start" />
                Try again
              </Button>
              <Link
                href="/dashboard"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "h-11 px-5 rounded-xl"
                )}
              >
                Go to dashboard
              </Link>
            </div>

            <div className="mt-12 max-w-xl rounded-[22px] border border-border/60 bg-background/40 p-5 backdrop-blur">
              <ShieldCheck className="size-5" />
              <h2 className="mt-3 text-sm font-semibold">Your data is protected</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                StockPilot stores ledger truth, counts, and approvals separately
                from the screen state.
              </p>
              {error.digest ? (
                <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Error ref · {error.digest}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
