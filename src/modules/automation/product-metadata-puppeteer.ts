/**
 * Puppeteer-based product metadata fetcher. Uses the same Chrome
 * binary the ordering agent already downloads — free, unlimited, no
 * third-party dependencies, no rate limits. Slower than a plain
 * HTTP fetch (~3-5s) but reliable: Amazon and friends can't block a
 * real browser's TLS fingerprint the way they block cloud-egress
 * curl-style requests.
 *
 * Used as the PRIMARY fetcher for sites on the known-blocked list
 * (Amazon, Costco, Walmart, etc.) and as a LAST-RESORT fallback for
 * everything else when both the direct fetch and microlink failed.
 *
 * Safety: we only read metadata, no clicks or form interactions.
 * Page is closed immediately after title extraction.
 */

import type { Browser } from "puppeteer-core";

import { findOrDownloadChrome, standardLaunchArgs } from "@/modules/automation/chrome-launcher";
import type { ProductMetadata } from "@/modules/automation/product-metadata";

const DEFAULT_TIMEOUT_MS = 15000;

// Module-level browser instance shared across calls. Launching
// Chrome takes 2-3s; reusing it across back-to-back metadata
// fetches drops per-call latency to ~1s. The browser idle-closes
// after 5 minutes so we don't hold memory forever.
let sharedBrowser: Browser | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const IDLE_CLOSE_MS = 5 * 60 * 1000;

function armIdleClose() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (sharedBrowser) {
      const b = sharedBrowser;
      sharedBrowser = null;
      await b.close().catch(() => null);
      console.log("[product-metadata-puppeteer] idle-closed shared browser");
    }
  }, IDLE_CLOSE_MS);
}

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.connected) return sharedBrowser;
  const puppeteer = (await import("puppeteer-core")).default;
  const execPath = await findOrDownloadChrome("[product-metadata-puppeteer]");
  sharedBrowser = await puppeteer.launch({
    args: standardLaunchArgs(),
    executablePath: execPath,
    headless: true,
  });
  return sharedBrowser;
}

export async function fetchViaPuppeteer(
  url: string,
  options?: { timeoutMs?: number }
): Promise<ProductMetadata | null> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let browser: Browser | null = null;
  try {
    browser = await getBrowser();
  } catch (err) {
    console.log(
      "[product-metadata-puppeteer] couldn't launch Chrome:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }

  const page = await browser.newPage().catch(() => null);
  if (!page) return null;

  try {
    // Realistic UA + headers so we look like a normal browser.
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    // Block heavy resources — we only need the HTML <head> metadata.
    // Roughly halves load time for image-heavy product pages.
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (type === "image" || type === "media" || type === "font" || type === "stylesheet") {
        req.abort().catch(() => null);
      } else {
        req.continue().catch(() => null);
      }
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    const metadata = await page.evaluate(() => {
      const getMeta = (names: string[]) => {
        for (const name of names) {
          const el =
            document.querySelector(`meta[property="${name}"]`) ||
            document.querySelector(`meta[name="${name}"]`);
          const content = el?.getAttribute("content");
          if (content && content.trim().length > 0) return content.trim();
        }
        return null;
      };

      // Title preference: og:title → Amazon productTitle → h1 → <title>
      const ogTitle = getMeta(["og:title", "twitter:title"]);
      const amazonTitle =
        document.querySelector("#productTitle")?.textContent?.trim() ?? null;
      const h1 = document.querySelector("h1")?.textContent?.trim() ?? null;
      const docTitle = document.title?.trim() ?? null;

      const title =
        (ogTitle && ogTitle.length >= 3 ? ogTitle : null) ||
        (amazonTitle && amazonTitle.length >= 3 ? amazonTitle : null) ||
        (h1 && h1.length >= 3 && h1.length < 200 ? h1 : null) ||
        (docTitle && docTitle.length >= 3 ? docTitle : null);

      const description = getMeta(["og:description", "twitter:description", "description"]);
      const imageUrl = getMeta(["og:image", "twitter:image"]);

      return { title, description, imageUrl };
    });

    // Strip common "- Amazon.ca"-style noise off the title.
    const cleanedTitle = metadata.title
      ? metadata.title
          .replace(/\s[-|·:]\s+(?:Amazon(?:\.[a-z.]+)?|Walmart|Costco|Target|eBay).*$/i, "")
          .replace(/^Amazon(?:\.[a-z.]+)?\s*:\s*/i, "")
          .trim() || metadata.title
      : null;

    return {
      title: cleanedTitle,
      description: metadata.description,
      imageUrl: metadata.imageUrl,
    };
  } catch (err) {
    console.log(
      "[product-metadata-puppeteer] fetch failed:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  } finally {
    await page.close().catch(() => null);
    armIdleClose();
  }
}
