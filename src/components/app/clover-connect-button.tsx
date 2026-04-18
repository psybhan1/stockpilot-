"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  disconnectPosIntegrationAction,
  startCloverConnectAction,
} from "@/app/actions/operations";
import { Button } from "@/components/ui/button";

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
  const [phase, setPhase] = useState<"idle" | "opening" | "waiting" | "disconnecting">(
    "idle"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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

  const handleDisconnect = useCallback(() => {
    if (
      !window.confirm(
        "Disconnect Clover? Sales will stop syncing until you reconnect. Your inventory and sale history are kept."
      )
    ) {
      return;
    }
    setErrorMessage(null);
    setPhase("disconnecting");
    startTransition(async () => {
      const result = await disconnectPosIntegrationAction("CLOVER");
      setPhase("idle");
      if (!result.ok) {
        setErrorMessage(result.reason);
        return;
      }
      router.refresh();
    });
  }, [router]);

  const disabled = isPending || phase !== "idle";
  const buttonLabel =
    phase === "opening"
      ? "Opening Clover…"
      : phase === "waiting"
        ? "Waiting for Clover…"
        : phase === "disconnecting"
          ? "Disconnecting…"
          : label;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={className}
      >
        {buttonLabel}
      </Button>
      {connected ? (
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={disabled}
          className="text-[11px] text-muted-foreground hover:text-red-400 transition disabled:opacity-50"
        >
          Disconnect
        </button>
      ) : null}
      {errorMessage ? (
        <p className="max-w-xs text-right text-xs text-red-400">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
