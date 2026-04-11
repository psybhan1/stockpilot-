"use client";

import { startTransition, useEffect, useEffectEvent } from "react";
import { useRouter } from "next/navigation";

type AppLiveRefreshProps = {
  intervalMs: number;
};

export function AppLiveRefresh({ intervalMs }: AppLiveRefreshProps) {
  const router = useRouter();

  const refresh = useEffectEvent(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  });

  useEffect(() => {
    if (intervalMs <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      refresh();
    }, intervalMs);

    const handleVisibility = () => {
      refresh();
    };

    window.addEventListener("focus", handleVisibility);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", handleVisibility);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [intervalMs]);

  return null;
}
