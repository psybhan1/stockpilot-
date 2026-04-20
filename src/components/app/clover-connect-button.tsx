"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  disconnectPosIntegrationAction,
  startCloverConnectAction,
} from "@/app/actions/operations";
import { Button } from "@/components/ui/button";
import { DisconnectConfirmDialog } from "@/components/app/disconnect-confirm-dialog";

type Outcome = "connected" | "error";

type OAuthMessage = {
  type: "stockpilot:clover-oauth";
  outcome: Outcome;
  reason?: string;
};

/**
 * One-click "Connect Clover" button. Same contract as SquareConnectButton
 * — popup window, postMessage from callback, graceful fallbacks — just
 * wired to the Clover-specific server action and message namespace so
 * the two buttons don't step on each other's postMessage listeners.
 */
export function CloverConnectButton({
  label,
  className,
  connected = false,
}: {
  label: string;
  className?: string;
  connected?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [phase, setPhase] = useState<"idle" | "opening" | "waiting">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as OAuthMessage | undefined;
      if (!data || data.type !== "stockpilot:clover-oauth") return;

      clearPoll();
      try {
        popupRef.current?.close();
      } catch {
        // Popup may already be closed.
      }
      popupRef.current = null;

      if (data.outcome === "connected") {
        setPhase("idle");
        setErrorMessage(null);
        router.refresh();
      } else {
        setPhase("idle");
        setErrorMessage(
          data.reason ? `Clover sign-in failed: ${data.reason}` : "Clover sign-in failed."
        );
      }
    }

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      clearPoll();
    };
  }, [clearPoll, router]);

  const handleClick = useCallback(() => {
    setErrorMessage(null);
    setPhase("opening");

    startTransition(async () => {
      const result = await startCloverConnectAction();

      if (!result.ok) {
        setPhase("idle");
        setErrorMessage(result.reason);
        return;
      }

      if (result.status === "connected") {
        setPhase("idle");
        router.refresh();
        return;
      }

      const popup = window.open(
        result.authUrl,
        "stockpilot-clover-oauth",
        "width=620,height=820,menubar=no,toolbar=no,location=yes"
      );

      if (!popup) {
        window.location.assign(result.authUrl);
        return;
      }

      popupRef.current = popup;
      setPhase("waiting");

      pollRef.current = setInterval(() => {
        if (popup.closed) {
          clearPoll();
          popupRef.current = null;
          setPhase("idle");
          router.refresh();
        }
      }, 500);
    });
  }, [clearPoll, router]);

  const handleDisconnectConfirm = useCallback(async () => {
    const result = await disconnectPosIntegrationAction("CLOVER");
    if (result.ok) {
      router.refresh();
    }
    return result;
  }, [router]);

  const disabled = isPending || phase !== "idle";
  const buttonLabel =
    phase === "opening"
      ? "Opening Clover…"
      : phase === "waiting"
        ? "Waiting for Clover…"
        : label;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {connected ? (
          <Button
            type="button"
            onClick={() => setDisconnectOpen(true)}
            disabled={disabled}
            className="h-9 gap-2 bg-transparent border border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/70 text-xs"
          >
            Disconnect
          </Button>
        ) : null}
        <Button
          type="button"
          onClick={handleClick}
          disabled={disabled}
          className={className}
        >
          {buttonLabel}
        </Button>
      </div>
      {errorMessage ? (
        <p className="max-w-xs text-right text-xs text-red-400">
          {errorMessage}
        </p>
      ) : null}
      <DisconnectConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        providerLabel="Clover"
        onConfirm={handleDisconnectConfirm}
      />
    </div>
  );
}
