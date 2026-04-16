/**
 * Generic supplier website adapter. Attempts common patterns for
 * searching + adding items to a cart on an arbitrary e-commerce
 * site. If it can't figure out the site structure, it gracefully
 * falls back to just navigating to the URL and screenshotting —
 * even partial help is better than nothing.
 */

import type { Page } from "puppeteer-core";
import {
  isForbiddenButton,
  takeStepScreenshot,
} from "@/modules/automation/browser-safety";

export type GenericSearchResult = {
  query: string;
  added: boolean;
  reason?: string;
};

const SEARCH_INPUT_SELECTORS = [
  'input[name="q"]',
  'input[name="search"]',
  'input[type="search"]',
  'input[placeholder*="Search" i]',
  'input[placeholder*="search" i]',
  'input[aria-label*="Search" i]',
  "#search-input",
  "#searchInput",
  ".search-input",
  "#search",
];

const ADD_TO_CART_SELECTORS = [
  'button:has-text("Add to Cart")',
  'button:has-text("Add to cart")',
  'button:has-text("Add to basket")',
  '[data-action="add-to-cart"]',
  "#add-to-cart",
  ".add-to-cart",
  'button[name="add"]',
  'input[value*="Add to Cart" i]',
];

export async function addItemsToGenericSite(
  page: Page,
  siteUrl: string,
  items: Array<{ query: string; quantity: number }>,
): Promise<{
  results: GenericSearchResult[];
  screenshots: Array<{ stepName: string; screenshot: Buffer }>;
}> {
  const screenshots: Array<{ stepName: string; screenshot: Buffer }> = [];
  const results: GenericSearchResult[] = [];

  // Navigate to the supplier site.
  try {
    await page.goto(siteUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    screenshots.push(await takeStepScreenshot(page, "landing"));
  } catch (err) {
    screenshots.push(await takeStepScreenshot(page, "landing-error"));
    results.push({
      query: "(site load)",
      added: false,
      reason: `Couldn't load ${siteUrl}: ${err instanceof Error ? err.message.slice(0, 100) : "unknown"}`,
    });
    return { results, screenshots };
  }

  for (const item of items) {
    try {
      // Try to find a search input.
      let searchInput = null;
      for (const sel of SEARCH_INPUT_SELECTORS) {
        searchInput = await page.$(sel);
        if (searchInput) break;
      }
      if (!searchInput) {
        results.push({
          query: item.query,
          added: false,
          reason: "No search box found on this site. Try adding the item manually.",
        });
        screenshots.push(await takeStepScreenshot(page, `no-search-${item.query}`));
        continue;
      }

      // Clear + type.
      await searchInput.click({ clickCount: 3 });
      await page.keyboard.type(item.query, { delay: 30 });
      await page.keyboard.press("Enter");
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => null);

      screenshots.push(await takeStepScreenshot(page, `search-${item.query}`));

      // Try to find + click an "Add to Cart" button. This is highly
      // site-specific so we try many common patterns.
      let addedThisItem = false;
      for (const sel of ADD_TO_CART_SELECTORS) {
        // puppeteer-core doesn't support :has-text, so handle
        // text-based selectors via evaluate.
        if (sel.includes("has-text")) {
          const textMatch = sel.match(/:has-text\("(.+?)"\)/)?.[1] ?? "";
          const clicked = await page.evaluate((text) => {
            const btns = Array.from(document.querySelectorAll("button, input[type=submit]"));
            const match = btns.find((b) => (b.textContent ?? "").includes(text));
            if (match && match instanceof HTMLElement) {
              match.click();
              return true;
            }
            return false;
          }, textMatch);
          if (clicked) {
            addedThisItem = true;
            break;
          }
        } else {
          const btn = await page.$(sel);
          if (btn) {
            const btnText = (await btn.evaluate((e) => e.textContent ?? "")) ?? "";
            if (isForbiddenButton(btnText)) continue;
            await btn.click();
            addedThisItem = true;
            break;
          }
        }
      }

      if (addedThisItem) {
        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => null);
        screenshots.push(await takeStepScreenshot(page, `added-${item.query}`));
        results.push({ query: item.query, added: true });
      } else {
        results.push({
          query: item.query,
          added: false,
          reason: "Couldn't find an Add to Cart button. This site may need a custom adapter.",
        });
        screenshots.push(await takeStepScreenshot(page, `no-cart-btn-${item.query}`));
      }
    } catch (err) {
      results.push({
        query: item.query,
        added: false,
        reason: err instanceof Error ? err.message.slice(0, 200) : "Unknown error",
      });
    }
  }

  // Final screenshot of whatever the current page is.
  screenshots.push(await takeStepScreenshot(page, "final"));
  return { results, screenshots };
}
