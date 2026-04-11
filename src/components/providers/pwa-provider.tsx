"use client";

import { useEffect } from "react";

export function PwaProvider() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    void navigator.serviceWorker.register("/stockpilot-sw.js").catch(() => {
      return undefined;
    });
  }, []);

  return null;
}
