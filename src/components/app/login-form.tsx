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
    <Card className="notif-card border-none bg-transparent shadow-none p-2">
      <CardHeader>
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Sign in
        </p>
        <CardTitle className="mt-2 text-2xl font-bold uppercase tracking-[-0.02em]">
          Welcome back
        </CardTitle>
        <CardDescription>
          Pick a demo role or type your own details.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {demoAccounts.map((account) => {
            const active = email === account.email;
            return (
              <button
                key={account.email}
                type="button"
                onClick={() => {
                  setEmail(account.email);
                  setPassword(sharedPassword);
                }}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  active
                    ? "border-foreground bg-foreground/[0.04]"
                    : "border-border/60 bg-background/30 hover:border-foreground/30 hover:bg-background/60"
                }`}
              >
                <p className="font-mono text-[9px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  {account.label}
                </p>
                <p className="mt-2 text-sm font-semibold">{account.email.split("@")[0]}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{account.description}</p>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
          <KeyRound className="size-3.5 shrink-0" />
          All demo accounts share password
          <span className="ml-1 rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground">
            {sharedPassword}
          </span>
        </div>

        <form action={action} className="flex flex-col gap-3">
          <Input
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="manager@stockpilot.dev"
            required
            className="h-11"
          />
          <Input
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={sharedPassword}
            required
            className="h-11"
          />
          {state.error ? (
            <p className="text-sm text-[var(--destructive)]">{state.error}</p>
          ) : null}
          <Button type="submit" disabled={pending} className="h-11">
            {pending ? (
              <>
                <span className="pending-spinner" aria-hidden />
                Signing in…
              </>
            ) : (
              <>
                Sign in
                <ArrowRight data-icon="inline-end" />
              </>
            )}
          </Button>
        </form>

        <div className="rounded-xl border border-border/60 bg-background/30 p-4">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            After sign-in
          </p>
          <ol className="mt-2 space-y-1 text-xs text-muted-foreground list-inside list-decimal">
            <li>Check the home screen for low-stock items and pending orders.</li>
            <li>Open Count to confirm anything uncertain.</li>
            <li>Review purchase orders before anything gets sent out.</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
