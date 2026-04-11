import Link from "next/link";
import { ArrowRight, Compass, PackageSearch } from "lucide-react";

import { StockPilotMark } from "@/components/app/stockpilot-mark";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.16),transparent_24%),linear-gradient(180deg,_rgba(255,252,248,1),rgba(250,250,249,1))] px-4 py-10 dark:bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.1),transparent_18%),linear-gradient(180deg,_rgba(12,10,9,1),rgba(24,24,27,1))]">
      <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center">
        <div className="grid w-full gap-10 rounded-[36px] border border-border/60 bg-card/88 p-6 shadow-2xl shadow-black/10 backdrop-blur lg:grid-cols-[1.05fr_0.95fr] lg:p-8">
          <div className="flex flex-col gap-5">
            <StockPilotMark />
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-amber-600 dark:text-amber-300">
                Page not found
              </p>
              <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                This page drifted off the route map.
              </h1>
              <p className="max-w-2xl text-lg text-muted-foreground">
                The inventory data is still safe. We just could not find the page you were trying
                to open.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/"
                className={cn(buttonVariants({ variant: "default", size: "lg" }), "rounded-2xl px-5")}
              >
                Go to home
              </Link>
              <Link
                href="/inventory"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-2xl px-5")}
              >
                Open inventory
              </Link>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[30px] border border-border/60 bg-background/82 p-5">
              <Compass className="size-6 text-amber-600 dark:text-amber-300" />
              <h2 className="mt-4 text-xl font-semibold">Best next place to go</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Start from Home if you want the fastest path back to urgent work.
              </p>
              <Link
                href="/dashboard"
                className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-foreground"
              >
                Open dashboard
                <ArrowRight className="size-4" />
              </Link>
            </div>
            <div className="rounded-[30px] border border-border/60 bg-background/82 p-5">
              <PackageSearch className="size-6 text-amber-600 dark:text-amber-300" />
              <h2 className="mt-4 text-xl font-semibold">Looking for a stock item?</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Inventory is the quickest place to search items, suppliers, and days-left details.
              </p>
              <Link
                href="/inventory"
                className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-foreground"
              >
                Search inventory
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
