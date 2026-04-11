"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type WidgetState = "loading" | "ready" | "unavailable" | "error";

function hasRenderedWidget(container: HTMLDivElement) {
  return Array.from(container.children).some((node) => {
    if (node.tagName.toLowerCase() === "script") {
      return false;
    }

    const element = node as HTMLElement;
    return element.offsetHeight > 0 || element.textContent?.trim();
  });
}

export function TelegramLoginWidget({
  botUsername,
  authUrl,
}: {
  botUsername: string;
  authUrl: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [widgetState, setWidgetState] = useState<WidgetState>("loading");

  const fallbackMessage = useMemo(() => {
    switch (widgetState) {
      case "error":
        return "Telegram web approval could not load on this page.";
      case "unavailable":
        return "Telegram web approval is not available on this domain yet.";
      case "ready":
        return "Telegram web approval is ready below.";
      case "loading":
      default:
        return "Loading Telegram web approval…";
    }
  }, [widgetState]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    container.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername.replace(/^@/, ""));
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "999");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-auth-url", authUrl);

    const markReadyIfRendered = () => {
      if (!containerRef.current) {
        return;
      }

      setWidgetState(hasRenderedWidget(containerRef.current) ? "ready" : "unavailable");
    };

    script.onload = () => {
      window.setTimeout(markReadyIfRendered, 1200);
    };

    script.onerror = () => {
      setWidgetState("error");
    };

    const observer = new MutationObserver(() => {
      if (!containerRef.current) {
        return;
      }

      if (hasRenderedWidget(containerRef.current)) {
        setWidgetState("ready");
      }
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
    });

    container.appendChild(script);

    const timeout = window.setTimeout(() => {
      markReadyIfRendered();
    }, 3500);

    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
      container.innerHTML = "";
    };
  }, [authUrl, botUsername]);

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="flex min-h-14 items-center justify-center rounded-[20px] border border-dashed border-border/70 bg-background/70 px-3"
      />
      <p className="text-xs text-muted-foreground">
        {fallbackMessage} If it stays blank, use the Telegram app button below. StockPilot supports
        both the web approval widget and the direct bot-start flow.
      </p>
    </div>
  );
}
