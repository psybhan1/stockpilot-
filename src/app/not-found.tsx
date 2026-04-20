import Link from "next/link";
import { ArrowRight, Compass, PackageSearch } from "lucide-react";

import { GlassFilter } from "@/components/app/glass-filter";
import { InkCanvas } from "@/components/app/ink-canvas";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
        <InkCanvas />
      </div>
      <GlassFilter />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1200px] items-center px-4 py-12 sm:px-6 lg:px-10">
        <div className="w-full">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.28em] text-muted-foreground">
            <span className="mr-2 inline-block h-px w-6 align-middle bg-current opacity-60" />
            404 · Page not found
          </p>

          <h1 className="mt-6 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(3rem,10vw,8rem)]">
            Off
            <br />
            the map.
          </h1>

          <p className="mt-6 max-w-xl text-sm text-muted-foreground sm:text-base">
            Nothing broken — the inventory data is safe. We just couldn't find
            the page you tried to open.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className={cn(
                buttonVariants({ variant: "default" }),
                "h-11 px-5 rounded-xl"
              )}
            >
              Go to dashboard
              <ArrowRight data-icon="inline-end" />
            </Link>
            <Link
              href="/inventory"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-11 px-5 rounded-xl"
              )}
            >
              Open inventory
            </Link>
          </div>

          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:max-w-3xl">
            <Link href="/dashboard" className="notif-card group p-5">
              <Compass className="size-5" />
              <h2 className="mt-3 text-sm font-semibold">Best next place</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Home for the fastest path back to urgent work.
              </p>
              <span className="mt-3 inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground group-hover:text-foreground">
                Open dashboard
                <ArrowRight className="size-3" />
              </span>
            </Link>
            <Link href="/inventory" className="notif-card group p-5">
              <PackageSearch className="size-5" />
              <h2 className="mt-3 text-sm font-semibold">Looking for an item?</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Inventory is the quickest place to search items + suppliers.
              </p>
              <span className="mt-3 inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground group-hover:text-foreground">
                Search inventory
                <ArrowRight className="size-3" />
              </span>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
