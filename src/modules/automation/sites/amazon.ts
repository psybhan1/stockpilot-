/**
 * Amazon-specific browser adapter. Knows how to:
 *   1. Search for an item on amazon.com
 *   2. Click the best result
 *   3. Set quantity
 *   4. Add to cart
 *   5. Navigate to the cart page and screenshot
 *
 * Does NOT handle login (Amazon's login flow has aggressive bot
 * detection with CAPTCHA + SMS 2FA). Instead, the agent should be
 * used with a fresh session where the user pre-authenticates once
 * via a stored browser profile or cookie injection. For v1 we run
 * anonymously (many Amazon items can be added to cart without login)
 * and the manager logs in on their own device to pay.
 */

import type { Page } from "puppeteer-core";
import {
  isForbiddenButton,
  takeStepScreenshot,
} from "@/modules/automation/browser-safety";

export type AmazonSearchResult = {
  query: string;
  added: boolean;
  reason?: string;
};

export async function addItemsToAmazonCart(
  page: Page,
  items: Array<{ query: string; quantity: number }>,
  options?: { domain?: string }
): Promise<{
  results: AmazonSearchResult[];
  screenshots: Array<{ stepName: string; screenshot: Buffer }>;
}> {
  const domain = options?.domain ?? "https://www.amazon.com";
  const screenshots: Array<{ stepName: string; screenshot: Buffer }> = [];
  const results: AmazonSearchResult[] = [];

  for (const item of items) {
    try {
      // Go to Amazon and search.
      await page.goto(`${domain}/s?k=${encodeURIComponent(item.query)}`, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      await page.waitForSelector('[data-component-type="s-search-result"]', {
        timeout: 10000,
      }).catch(() => null);

      screenshots.push(await takeStepScreenshot(page, `search-${item.query}`));

      // Click the first organic result's title link.
      const firstResult = await page.$(
        '[data-component-type="s-search-result"] h2 a'
      );
      if (!firstResult) {
        results.push({
          query: item.query,
          added: false,
          reason: "No search results found",
        });
        continue;
      }

      // Safety check: make sure we're clicking a product link, not a
      // sponsored "Buy now" button.
      const linkText =
        (await firstResult.evaluate((el) => el.textContent ?? "")) ?? "";
      if (isForbiddenButton(linkText)) {
        results.push({
          query: item.query,
          added: false,
          reason: `Safety-blocked: link text "${linkText.slice(0, 60)}" looks like a payment button`,
        });
        continue;
      }

      await firstResult.click();
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);

      screenshots.push(await takeStepScreenshot(page, `product-${item.query}`));

      // Set quantity if > 1.
      if (item.quantity > 1) {
        const qtySelect = await page.$("#quantity");
        if (qtySelect) {
          await page.select("#quantity", String(Math.min(item.quantity, 30)));
        }
      }

      // Click "Add to Cart" — NEVER "Buy Now".
      const addToCartBtn = await page.$("#add-to-cart-button");
      if (!addToCartBtn) {
        results.push({
          query: item.query,
          added: false,
          reason: "Add-to-Cart button not found on product page",
        });
        continue;
      }

      // Final safety gate before clicking.
      const btnText =
        (await addToCartBtn.evaluate((el) => el.textContent ?? "")) ?? "";
      if (isForbiddenButton(btnText)) {
        results.push({
          query: item.query,
          added: false,
          reason: `Safety-blocked: button text "${btnText.slice(0, 60)}"`,
        });
        continue;
      }

      await addToCartBtn.click();
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => null);

      screenshots.push(await takeStepScreenshot(page, `added-${item.query}`));
      results.push({ query: item.query, added: true });
    } catch (err) {
      results.push({
        query: item.query,
        added: false,
        reason:
          err instanceof Error
            ? err.message.slice(0, 200)
            : "Unknown error",
      });
    }
  }

  // Navigate to the full cart page and take a final screenshot.
  try {
    await page.goto(`${domain}/gp/cart/view.html`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForSelector("#sc-active-cart", { timeout: 8000 }).catch(() => null);
    screenshots.push(await takeStepScreenshot(page, "cart-final"));
  } catch {
    screenshots.push(await takeStepScreenshot(page, "cart-final-fallback"));
  }

  return { results, screenshots };
}
