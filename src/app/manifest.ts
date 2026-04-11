import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StockPilot",
    short_name: "StockPilot",
    description: "AI-assisted inventory operations for cafes, bakeries, and small restaurants.",
    start_url: "/",
    display: "standalone",
    background_color: "#f9f7f2",
    theme_color: "#5a3b2a",
    orientation: "portrait",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
