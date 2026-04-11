"use client";

import type { ReactNode } from "react";

import { PwaProvider } from "@/components/providers/pwa-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/providers/theme-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <PwaProvider />
      <TooltipProvider>{children}</TooltipProvider>
    </ThemeProvider>
  );
}
