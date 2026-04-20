/**
 * Amazon-specific browser adapter. Knows how to:
 *   1. (Optional) Inject session cookies / form-login the manager
 *   2. Search for an item on amazon.com (or go direct to a pasted URL)
 *   3. Click the best result
 *   4. Set quantity
 *   5. Add to cart
 *   6. Navigate to the cart page and screenshot
 *
 * Login: cookie injection is the reliable path (bypasses captcha +
 * 2FA; the manager exports their cookies once via a bookmarklet on
 * the supplier settings page). Form login is best-effort — it works
 * on accounts without 2FA and when Amazon doesn't surface a captcha,
 * but anyone serious about ordering should use cookies.
 */

import type { Page } from "puppeteer-core";
import {
  isForbiddenButton,
  takeStepScreenshot,
  type AgentStepSink,
} from "@/modules/automation/browser-safety";
import { detectAmazonErrorFromState } from "@/modules/automation/sites/amazon-errors";
import type { SupplierWebsiteCredentials } from "@/modules/suppliers/website-credentials";

export { detectAmazonErrorFromState } from "@/modules/automation/sites/amazon-errors";

/**
 * Read Amazon's #productTitle span from the current page. Used as a
 * safety net to upgrade a generic item name ("Item from Amazon") to
 * the real product title when the pre-approval HTTP fetch was
 * blocked but the browser session actually reached the page.
 */
export async function readAmazonProductTitle(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => {
      const el = document.querySelector("#productTitle");
      if (!el) return null;
      const text = (el.textContent ?? "").trim();
      return text.length >= 3 ? text : null;
    });
  } catch {
    return null;
  }
}

export type AmazonSearchResult = {
  query: string;
  added: boolean;
  reason?: string;
};

export async function addItemsToAmazonCart(
  page: Page,
  items: Array<{ query: string; quantity: number; directUrl?: string | null }>,
  options?: {
    domain?: string;
    credentials?: SupplierWebsiteCredentials | null;
    /**
     * Fires on every screenshot so the live-view page can render
     * progress in real time. Optional — adapter still works without.
     */
    onStep?: AgentStepSink;
  }
): Promise<{
  results: AmazonSearchResult[];
  screenshots: Array<{ stepName: string; screenshot: Buffer }>;
}> {
  const domain = options?.domain ?? "https://www.amazon.com";
  const screenshots: Array<{ stepName: string; screenshot: Buffer }> = [];
  const results: AmazonSearchResult[] = [];

  // Helper: push to collector AND fire live-view sink in one call.
  const capture = async (
    stepName: string,
    status: "ok" | "failed" = "ok",
    notes?: string
  ) => {
    const shot = await takeStepScreenshot(page, stepName);
    screenshots.push(shot);
    if (options?.onStep) {
      try {
        await options.onStep({
          name: stepName,
          status,
          screenshot: shot.screenshot,
          notes,
        });
      } catch {
        /* fire-and-forget */
      }
    }
    return shot;
  };

  // Pre-flight: log in (or inject cookies) if the manager supplied
  // credentials. Errors here are logged but don't abort the flow —
  // anonymous mode still works for many items.
  if (options?.credentials) {
    try {
      const loginScreens = await applyAmazonCredentials(page, domain, options.credentials);
      screenshots.push(...loginScreens);
      // Forward the login screenshots to the live-view sink too so
      // the manager sees "signed in via cookies" land immediately.
      if (options.onStep) {
        for (const shot of loginScreens) {
          try {
            await options.onStep({
              name: shot.stepName,
              status: "ok",
              screenshot: shot.screenshot,
            });
          } catch {
            /* fire-and-forget */
          }
        }
      }
    } catch (err) {
      await capture("login-failed", "failed", err instanceof Error ? err.message.slice(0, 160) : undefined);
      // Don't return — fall through to anonymous mode and let the
      // manager see the screenshot of why login broke.
      console.warn("[amazon] login attempt failed:", err instanceof Error ? err.message : err);
    }
  }

  for (const item of items) {
    try {
      // If we have the exact product URL the user pasted, go straight
      // there — same SKU, no risk of search picking a similar product.
      if (item.directUrl) {
        await page.goto(item.directUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        // Read the real product title so the live view + final
        // summary show "Urnex Rinza Alkaline Formula Milk Frother
        // Cleaner, 33.6 Ounce" instead of whatever placeholder the
        // PO line had. Safety net if the pre-approval HTTP fetch was
        // blocked. Fired as a step note so the recorder persists it.
        const title = await readAmazonProductTitle(page);
        await capture(
          `product-direct-${item.query}`,
          "ok",
          title ? `Product page: ${title.slice(0, 160)}` : undefined
        );

        // Amazon's 404 dog page appears when the product was removed,
        // is region-locked, or the URL is malformed. Detect it and
        // fall back to searching for the item by name on the same
        // storefront — much more likely to find a working SKU.
        if (await isAmazonErrorPage(page)) {
          await capture(`product-not-found-${item.query}`, "failed", "Product URL returned an error page");
          await page.goto(
            `${domain}/s?k=${encodeURIComponent(item.query)}`,
            { waitUntil: "domcontentloaded", timeout: 20000 }
          );
          await page
            .waitForSelector('[data-component-type="s-search-result"]', { timeout: 10000 })
            .catch(() => null);
          screenshots.push(
            await takeStepScreenshot(page, `search-fallback-${item.query}`)
          );
          const firstResult = await page.$(
            '[data-component-type="s-search-result"] h2 a'
          );
          if (!firstResult) {
            results.push({
              query: item.query,
              added: false,
              reason:
                "Product URL returned an error page and search found no alternative.",
            });
            continue;
          }
          const linkText =
            (await firstResult.evaluate((el) => el.textContent ?? "")) ?? "";
          if (isForbiddenButton(linkText)) {
            results.push({
              query: item.query,
              added: false,
              reason: `Safety-blocked search result: "${linkText.slice(0, 60)}"`,
            });
            continue;
          }
          await firstResult.click();
          await page
            .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 })
            .catch(() => null);
          screenshots.push(
            await takeStepScreenshot(page, `product-from-search-${item.query}`)
          );
        }
      } else {
        // Search-by-name fallback for legacy POs / non-quick-add flows.
        await page.goto(`${domain}/s?k=${encodeURIComponent(item.query)}`, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await page.waitForSelector('[data-component-type="s-search-result"]', {
          timeout: 10000,
        }).catch(() => null);

        await capture(`search-${item.query}`);

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

        await capture(`product-${item.query}`);
      }

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

      await capture(`added-${item.query}`, "ok", `Added ${item.quantity}× to cart`);
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
    await capture("cart-final");
  } catch {
    await capture("cart-final-fallback", "failed", "Cart page didn't load cleanly");
  }

  return { results, screenshots };
}

export async function isAmazonErrorPage(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    const title = await page.title().catch(() => "");
    const bodyText = await page
      .evaluate(() => document.body?.innerText ?? "")
      .catch(() => "");
    return detectAmazonErrorFromState({ url, title, bodyText });
  } catch {
    return false;
  }
}

/**
 * Either inject the manager's session cookies (preferred) or attempt
 * a form-based login. Returns screenshots of the login state for the
 * cart-summary message — the manager sees whether they're actually
 * signed in before approving payment.
 */
async function applyAmazonCredentials(
  page: Page,
  domain: string,
  credentials: SupplierWebsiteCredentials
): Promise<Array<{ stepName: string; screenshot: Buffer }>> {
  const screenshots: Array<{ stepName: string; screenshot: Buffer }> = [];

  if (credentials.kind === "cookies") {
    // Default missing domain to the supplier root so cookies hop
    // across amazon.com / .ca / etc. correctly.
    const fallbackDomain = new URL(domain).hostname.replace(/^www\./, "");
    const cookies = credentials.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain ?? `.${fallbackDomain}`,
      path: c.path ?? "/",
      ...(c.expires ? { expires: c.expires } : {}),
      ...(typeof c.httpOnly === "boolean" ? { httpOnly: c.httpOnly } : {}),
      ...(typeof c.secure === "boolean" ? { secure: c.secure } : { secure: true }),
      ...(c.sameSite ? { sameSite: c.sameSite } : {}),
    }));
    // puppeteer-core's setCookie accepts a variadic list.
    await page.setCookie(...cookies);
    await page.goto(domain, { waitUntil: "domcontentloaded", timeout: 20000 });
    screenshots.push(await takeStepScreenshot(page, "after-cookie-login"));
    return screenshots;
  }

  // Form-login fallback. Will frequently fail on accounts with 2FA or
  // when Amazon serves a captcha — that's why cookies are preferred.
  const loginUrl = credentials.loginUrl ?? `${domain}/ap/signin`;
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  screenshots.push(await takeStepScreenshot(page, "login-page"));

  // Email step.
  const emailInput = await page.$("#ap_email");
  if (!emailInput) {
    screenshots.push(await takeStepScreenshot(page, "login-no-email-field"));
    throw new Error("Amazon login page didn't expose the expected email field.");
  }
  await emailInput.type(credentials.username, { delay: 30 });
  const continueBtn = await page.$("#continue");
  if (continueBtn) await continueBtn.click();
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => null);

  // Password step.
  const passwordInput = await page.$("#ap_password");
  if (!passwordInput) {
    screenshots.push(await takeStepScreenshot(page, "login-no-password-field"));
    throw new Error("Amazon login page didn't expose the expected password field (captcha?).");
  }
  await passwordInput.type(credentials.password, { delay: 30 });
  const signInBtn = await page.$("#signInSubmit");
  if (signInBtn) await signInBtn.click();
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);

  screenshots.push(await takeStepScreenshot(page, "after-form-login"));

  // Quick sniff: did we end up on a 2FA / captcha challenge?
  const currentUrl = page.url();
  if (/auth-challenge|captcha|mfa|approval/i.test(currentUrl)) {
    throw new Error(
      `Amazon presented a challenge page (${new URL(currentUrl).pathname}). Use cookie-based login instead.`
    );
  }

  return screenshots;
}
