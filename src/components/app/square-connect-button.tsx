"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { startSquareConnectAction } from "@/app/actions/operations";
import { Button } from "@/components/ui/button";

type Outcome = "connected" | "error";

type OAuthMessage = {
  type: "stockpilot:square-oauth";
  outcome: Outcome;
  reason?: string;
};

/**
 * One-click "Connect Square" button.
 *
 * Flow:
 *   1. Click → server action returns authUrl
 *   2. Open authUrl in popup (600×800) so merchant never leaves /settings
 *   3. Popup completes OAuth on Square → hits our callback → callback
 *      page posts message back to opener and closes itself
 *   4. We refresh /settings — Square row flips to ● LIVE
 *
 * Falls back to full-page redirect if:
 *   - The popup is blocked by the browser
 *   - The popup closes without a success message (user cancelled)
 *
 * The server action already advances the integration to CONNECTING
 * and records the state nonce. The popup is purely a UX shell — all
 * auth correctness is server-side.
 */
export function SquareConnectButton({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [phase, setPhase] = useState<"idle" | "opening" | "waiting">("idle");
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
      if (!data || data.type !== "stockpilot:square-oauth") return;

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
          data.reason ? `Square sign-in failed: ${data.reason}` : "Square sign-in failed."
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
      const result = await startSquareConnectAction();

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

      // status === "redirect" — open Square in a popup.
      const popup = window.open(
        result.authUrl,
        "stockpilot-square-oauth",
        "width=620,height=820,menubar=no,toolbar=no,location=yes"
      );

      if (!popup) {
        // Popup blocker or mobile — fall back to full-page redirect.
        window.location.assign(result.authUrl);
        return;
      }

      popupRef.current = popup;
      setPhase("waiting");

      // If the user closes the popup without completing, reset state
      // so the button is clickable again. We avoid polling integration
      // status from here — the server message is the source of truth.
      pollRef.current = setInterval(() => {
        if (popup.closed) {
          clearPoll();
          popupRef.current = null;
          setPhase("idle");
          // Silent refresh in case the callback did run (race condition
          // where the popup closes itself before our message listener
          // fires on some browsers).
          router.refresh();
        }
      }, 500);
    });
  }, [clearPoll, router]);

  const disabled = isPending || phase !== "idle";
  const buttonLabel =
    phase === "opening"
      ? "Opening Square…"
      : phase === "waiting"
        ? "Waiting for Square…"
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
      {errorMessage ? (
        <p className="max-w-xs text-right text-xs text-red-400">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
