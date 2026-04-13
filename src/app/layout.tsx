import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AppProviders } from "@/components/providers/app-providers";
import { env } from "@/lib/env";

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
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
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
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#090c14" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-full flex flex-col overflow-x-hidden">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
