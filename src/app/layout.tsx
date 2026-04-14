import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";

import { AppProviders } from "@/components/providers/app-providers";
import { env } from "@/lib/env";

const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
  display: "swap",
});

const metadataBase = (() => {
  try {
    return new URL(env.APP_URL);
  } catch {
    return new URL("http://127.0.0.1:3000");
  }
})();

export const metadata: Metadata = {
  metadataBase,
  title: {
    default: "StockPilot",
    template: "%s · StockPilot",
  },
  description: "AI-assisted inventory operations for cafes, bakeries, and small restaurants.",
  applicationName: "StockPilot",
  manifest: "/manifest.webmanifest",
  keywords: [
    "inventory management",
    "cafe operations",
    "restaurant inventory",
    "square integration",
    "purchase orders",
    "stock counts",
  ],
  category: "business",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: [{ url: "/favicon.ico" }],
    apple: [{ url: "/apple-icon", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "StockPilot",
    statusBarStyle: "default",
  },
  formatDetection: { email: false, address: false, telephone: false },
  openGraph: {
    title: "StockPilot",
    description: "Prevent stockouts before the rush turns into supplier chaos.",
    siteName: "StockPilot",
    url: "/",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "StockPilot",
    description: "Prevent stockouts before the rush turns into supplier chaos.",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F3EE" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0A0A" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${interTight.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-full flex flex-col overflow-x-hidden font-sans">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
