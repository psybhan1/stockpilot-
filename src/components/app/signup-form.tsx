"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { signupAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const initialState = { error: "" };

export function SignupForm() {
  const [state, action, pending] = useActionState(signupAction, initialState);
  const tzRef = useRef<HTMLInputElement>(null);

  // Best-guess timezone from the browser, poked into the hidden
  // input after mount. Server action has a fallback baked in, so
  // this is pure accuracy-when-available. Mutating the input directly
  // (instead of via state) avoids a redundant re-render on mount.
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && tzRef.current) tzRef.current.value = tz;
    } catch {
      /* use the fallback */
    }
  }, []);

  return (
    <Card className="notif-card border-none bg-transparent shadow-none p-2">
      <CardHeader>
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Create account
        </p>
        <CardTitle className="mt-2 text-2xl font-bold uppercase tracking-[-0.02em]">
          Start free
        </CardTitle>
        <CardDescription>
          One account per café. You can rename your location anytime.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form action={action} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="signup-business"
              className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground"
            >
              Café / business name
            </label>
            <Input
              id="signup-business"
              name="businessName"
              type="text"
              placeholder="Northside Coffee"
              autoComplete="organization"
              required
              className="h-11"
              maxLength={80}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="signup-name"
              className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground"
            >
              Your name
            </label>
            <Input
              id="signup-name"
              name="ownerName"
              type="text"
              placeholder="Sam Rivera"
              autoComplete="name"
              required
              className="h-11"
              maxLength={80}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="signup-email"
              className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground"
            >
              Email
            </label>
            <Input
              id="signup-email"
              name="email"
              type="email"
              placeholder="you@northside.coffee"
              autoComplete="email"
              required
              className="h-11"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="signup-password"
              className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground"
            >
              Password (8+ chars)
            </label>
            <Input
              id="signup-password"
              name="password"
              type="password"
              placeholder="•••••••••"
              autoComplete="new-password"
              required
              minLength={8}
              className="h-11"
            />
          </div>

          <input
            ref={tzRef}
            type="hidden"
            name="timezone"
            defaultValue="America/Toronto"
          />

          {state.error ? (
            <p className="text-sm text-[var(--destructive)]">{state.error}</p>
          ) : null}

          <Button type="submit" disabled={pending} className="h-11">
            {pending ? (
              <>
                <span className="pending-spinner" aria-hidden />
                Creating account…
              </>
            ) : (
              <>
                Create account
                <ArrowRight data-icon="inline-end" />
              </>
            )}
          </Button>
        </form>

        <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/30 p-3 text-xs text-muted-foreground">
          <span>Already have an account?</span>
          <Link
            href="/login"
            className="font-semibold text-foreground hover:underline"
          >
            Sign in →
          </Link>
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          By signing up you agree to use StockPilot for its intended
          purpose — restaurant inventory and supplier ordering — and to
          not abuse the free founder-preview tier.
        </p>
      </CardContent>
    </Card>
  );
}
