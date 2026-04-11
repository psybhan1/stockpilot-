"use client";

import { useActionState, useState } from "react";
import { ArrowRight, KeyRound } from "lucide-react";

import { loginAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const initialState = { error: "" };
const sharedPassword = "demo1234";
const demoAccounts = [
  { label: "Manager", email: "manager@stockpilot.dev", description: "Full access" },
  {
    label: "Supervisor",
    email: "supervisor@stockpilot.dev",
    description: "Inventory + review flows",
  },
  { label: "Staff", email: "staff@stockpilot.dev", description: "Count + corrections" },
] as const;

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialState);
  const [email, setEmail] = useState<string>(demoAccounts[0].email);
  const [password, setPassword] = useState<string>(sharedPassword);

  return (
    <Card className="rounded-[30px] border-border/60 bg-card/92 shadow-2xl shadow-black/8 backdrop-blur">
      <CardHeader>
        <CardTitle>Sign in to StockPilot</CardTitle>
        <CardDescription>
          Pick a demo role below or type your own login details.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {demoAccounts.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => {
                setEmail(account.email);
                setPassword(sharedPassword);
              }}
              className="rounded-2xl border border-border/60 bg-background/70 p-3 text-left transition-colors hover:border-primary/25 hover:bg-background"
            >
              <p className="font-medium">{account.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{account.description}</p>
              <p className="mt-3 text-xs text-foreground">{account.email}</p>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-2xl border border-amber-200/70 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-300/15 dark:bg-amber-400/10 dark:text-amber-100">
          <KeyRound className="size-4 shrink-0" />
          All demo accounts use the same password: <span className="font-semibold">{sharedPassword}</span>
        </div>

        <form action={action} className="flex flex-col gap-4">
          <Input
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="manager@stockpilot.dev"
            required
            className="h-11 rounded-2xl"
          />
          <Input
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={sharedPassword}
            required
            className="h-11 rounded-2xl"
          />
          {state.error ? (
            <p className="text-sm text-rose-600 dark:text-rose-300">{state.error}</p>
          ) : null}
          <Button type="submit" disabled={pending} className="h-11 rounded-2xl">
            {pending ? "Signing in..." : "Sign in"}
            {!pending ? <ArrowRight data-icon="inline-end" /> : null}
          </Button>
        </form>

        <div className="rounded-[24px] border border-border/60 bg-background/70 p-4">
          <p className="text-sm font-medium">What you can try after sign-in</p>
          <div className="mt-3 space-y-2 text-sm text-muted-foreground">
            <p>1. Check the home screen for low-stock items and pending orders.</p>
            <p>2. Open Count to confirm anything uncertain.</p>
            <p>3. Review purchase orders before anything gets sent out.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
