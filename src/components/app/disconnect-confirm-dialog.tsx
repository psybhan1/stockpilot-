"use client";

import { useEffect, useState } from "react";
import { AlertTriangleIcon, CheckCircle2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Branded disconnect confirmation — replaces the native window.confirm()
 * trash dialog. Handles the whole lifecycle (idle → pending → ok/error)
 * inline so the button's parent component just provides the onConfirm
 * handler and lets this dialog drive the UX.
 *
 * On success, auto-closes after 900ms so the merchant sees the
 * "Disconnected." checkmark before the card flips back to the
 * Connect state.
 */
export function DisconnectConfirmDialog({
  open,
  onOpenChange,
  providerLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerLabel: string;
  onConfirm: () => Promise<{ ok: true } | { ok: false; reason: string }>;
}) {
  const [phase, setPhase] = useState<"idle" | "pending" | "success" | "error">(
    "idle"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      // Reset back to idle a frame after close so the user doesn't see
      // the state flicker during the exit animation.
      const t = setTimeout(() => {
        setPhase("idle");
        setErrorMessage(null);
      }, 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  async function handleClick() {
    setPhase("pending");
    setErrorMessage(null);
    const result = await onConfirm();
    if (result.ok) {
      setPhase("success");
      setTimeout(() => {
        onOpenChange(false);
      }, 900);
    } else {
      setPhase("error");
      setErrorMessage(result.reason);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/15">
              {phase === "success" ? (
                <CheckCircle2Icon className="h-5 w-5 text-emerald-400" />
              ) : (
                <AlertTriangleIcon className="h-5 w-5 text-red-400" />
              )}
            </div>
            <div className="flex-1">
              <DialogTitle>
                {phase === "success"
                  ? `${providerLabel} disconnected`
                  : `Disconnect ${providerLabel}?`}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {phase === "success" ? (
                  <>Sales will stop syncing until you reconnect.</>
                ) : (
                  <>
                    Sales will stop syncing until you reconnect. Your
                    inventory and sale history are kept.
                  </>
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {errorMessage ? (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {errorMessage}
          </div>
        ) : null}

        {phase !== "success" ? (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={phase === "pending"}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleClick}
              disabled={phase === "pending"}
              className="bg-red-500 text-white hover:bg-red-500/90 focus:ring-red-500"
            >
              {phase === "pending" ? "Disconnecting…" : "Disconnect"}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
