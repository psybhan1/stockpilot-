"use client";

/**
 * Submit button that ties into its enclosing <form action>'s pending
 * state via React's useFormStatus. While the server action is in-
 * flight, the button is disabled and shows a spinner next to its
 * label — immediate feedback for the user, no extra state wiring.
 *
 * Drop-in replacement for shadcn Button when you want server-action
 * feedback. Keeps all Button variants/sizes + arbitrary className.
 */

import { useFormStatus } from "react-dom";
import { type ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PendingButtonProps = ComponentProps<typeof Button> & {
  pendingLabel?: string;
};

export function PendingButton({
  children,
  pendingLabel,
  className,
  disabled,
  ...rest
}: PendingButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      className={cn(className, pending && "cursor-wait")}
      {...rest}
    >
      {pending && <span className="pending-spinner" aria-hidden />}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
