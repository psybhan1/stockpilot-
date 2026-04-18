"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  disconnectPosIntegrationAction,
  startShopifyConnectAction,
} from "@/app/actions/operations";
import { Button } from "@/components/ui/button";
import { DisconnectConfirmDialog } from "@/components/app/disconnect-confirm-dialog";

type Outcome = "connected" | "error";

type OAuthMessage = {
  type: "stockpilot:shopify-oauth";
  outcome: Outcome;
  reason?: string;
};

/**
 * Shopify Connect button with per-shop OAuth.
 *
 * Unlike Square/Clover (single vendor OAuth URL), Shopify OAuth is
 * per-shop. Click order:
 *
 *   1. Click "Connect Shopify" → button reveals a small shop-domain
 *      input inline (same height, clean one-liner) and the button
 *      flips to "Continue".
 *   2. User types "my-cafe" or "my-cafe.myshopify.com" → Continue.
 *   3. Server action normalises the domain + returns the per-shop
 *      authUrl. Popup opens to that shop's admin OAuth page.
 *   4. Merchant approves → callback → postMessage → popup closes →
 *      /settings flips to ● LIVE.
 *
 * Same Disconnect link + confirm dialog as Square/Clover buttons.
 */
export function ShopifyConnectButton({
  label,
  className,
  connected = false,
  currentShopDomain,
}: {
  label: string;
  className?: string;
  connected?: boolean;
  currentShopDomain?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [phase, setPhase] = useState<"idle" | "prompt" | "opening" | "waiting">(
    "idle"
  );
  const [shopInput, setShopInput] = useState(currentShopDomain ?? "");
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
      if (!data || data.type !== "stockpilot:shopify-oauth") return;

      clearPoll();
      try {
        popupRef.current?.close();
      } catch {
        // Popup already closed.
      }
      popupRef.current = null;

      if (data.outcome === "connected") {
        setPhase("idle");
        setErrorMessage(null);
        router.refresh();
      } else {
        setPhase("idle");
        setErrorMessage(
          data.reason ? `Shopify sign-in failed: ${data.reason}` : "Shopify sign-in failed."
        );
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      clearPoll();
    };
  }, [clearPoll, router]);

  const handlePrimaryClick = useCallback(() => {
    setErrorMessage(null);

    // If we're not already showing the shop-domain input, reveal it.
    if (phase === "idle" && !shopInput) {
      setPhase("prompt");
      return;
    }

    // Otherwise run OAuth with whatever's in the input.
    setPhase("opening");
    startTransition(async () => {
      const result = await startShopifyConnectAction({ shopDomain: shopInput });

      if (!result.ok) {
        setPhase("prompt");
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
        "stockpilot-shopify-oauth",
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
  }, [clearPoll, phase, router, shopInput]);

  const handleDisconnectConfirm = useCallback(async () => {
    const result = await disconnectPosIntegrationAction("SHOPIFY");
    if (result.ok) {
      router.refresh();
    }
    return result;
  }, [router]);

  const disabled =
    isPending || phase === "opening" || phase === "waiting";

  const buttonLabel =
    phase === "opening"
      ? "Opening Shopify…"
      : phase === "waiting"
        ? "Waiting for Shopify…"
        : phase === "prompt"
          ? "Continue →"
          : label;

  const showPromptInput = phase === "prompt" || (!!shopInput && !connected && phase === "idle");

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
        {showPromptInput ? (
          <input
            type="text"
            value={shopInput}
            onChange={(e) => setShopInput(e.target.value)}
            placeholder="my-cafe.myshopify.com"
            autoFocus
            className="h-9 w-56 rounded-md border border-border/60 bg-background px-3 text-xs font-mono outline-none focus:border-foreground/40"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handlePrimaryClick();
              } else if (e.key === "Escape") {
                setPhase("idle");
                setShopInput("");
              }
            }}
          />
        ) : null}
        <Button
          type="button"
          onClick={handlePrimaryClick}
          disabled={disabled || (phase === "prompt" && !shopInput.trim())}
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
        providerLabel="Shopify"
        onConfirm={handleDisconnectConfirm}
      />
    </div>
  );
}
