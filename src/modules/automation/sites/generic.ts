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
import type { SupplierWebsiteCredentials } from "@/modules/suppliers/website-credentials";

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
  items: Array<{ query: string; quantity: number; directUrl?: string | null }>,
  options?: { credentials?: SupplierWebsiteCredentials | null }
): Promise<{
  results: GenericSearchResult[];
  screenshots: Array<{ stepName: string; screenshot: Buffer }>;
}> {
  const screenshots: Array<{ stepName: string; screenshot: Buffer }> = [];
  const results: GenericSearchResult[] = [];

  // Cookie injection (preferred): set the manager's session cookies
  // before any nav so the supplier site sees them as authenticated
  // immediately. Form-login on a generic site is too brittle (every
  // site has different selectors) — we only support the cookie path
  // here. If creds.kind === "password" we ignore them with a logged
  // warning and fall back to anonymous mode.
  if (options?.credentials) {
    if (options.credentials.kind === "cookies") {
      try {
        const fallbackDomain = new URL(siteUrl).hostname.replace(/^www\./, "");
        const cookies = options.credentials.cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain ?? `.${fallbackDomain}`,
          path: c.path ?? "/",
          ...(c.expires ? { expires: c.expires } : {}),
          ...(typeof c.httpOnly === "boolean" ? { httpOnly: c.httpOnly } : {}),
          ...(typeof c.secure === "boolean" ? { secure: c.secure } : { secure: true }),
          ...(c.sameSite ? { sameSite: c.sameSite } : {}),
        }));
        await page.setCookie(...cookies);
      } catch (err) {
        console.warn(
          "[generic] cookie injection failed:",
          err instanceof Error ? err.message : err
        );
      }
    } else {
      console.warn(
        "[generic] password-mode credentials aren't supported on the generic adapter — site-specific selectors needed. Using cookie mode instead is recommended."
      );
    }
  }

  // If every item has a direct URL we can skip the landing page and
  // jump straight to each product. Otherwise load the landing once
  // so we can re-use the search box for items that lack URLs.
  const allDirect = items.length > 0 && items.every((i) => Boolean(i.directUrl));
  if (!allDirect) {
    try {
      await page.goto(siteUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      screenshots.push(await takeStepScreenshot(page, "landing"));
      // Age gate on LCBO / BevMo / Total Wine / etc. blocks search
      // until acknowledged. Try to click through common patterns.
      await dismissAgeGate(page);
    } catch (err) {
      screenshots.push(await takeStepScreenshot(page, "landing-error"));
      results.push({
        query: "(site load)",
        added: false,
        reason: `Couldn't load ${siteUrl}: ${err instanceof Error ? err.message.slice(0, 100) : "unknown"}`,
      });
      return { results, screenshots };
    }
  }

  for (const item of items) {
    try {
      // Direct-URL fast path: navigate to the user's exact product
      // URL and try to add to cart from there. If the site doesn't
      // expose a recognisable Add-to-Cart button we still log a
      // partial-success so the manager has the right page screenshot
      // to finish manually.
      if (item.directUrl) {
        await page.goto(item.directUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        // Direct-URL path might hit an age-gate redirect too.
        await dismissAgeGate(page);
        screenshots.push(await takeStepScreenshot(page, `product-direct-${item.query}`));
        // Fall through to the Add-to-Cart-button-finder below.
      } else {
        // Search-by-name path: try to find a search input on the
        // landing page.
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
      }

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

// ── Age gate handling ────────────────────────────────────────────
// LCBO, SAQ, BevMo, Total Wine, and many alcohol / adult-content
// sites block access behind an age-verification modal. The modal
// is usually a simple "Yes, I'm 21+" / "I am 19 or older" button
// that sets a cookie then lets you browse. Missing it means the
// search box isn't reachable and the agent fails cryptically.
//
// We look for a bunch of common variants and click whichever one
// hits first. Pure best-effort — it's fine to call on pages without
// a gate (finds nothing, returns silently).

const AGE_GATE_TEXT_PATTERNS = [
  /\byes[,!]?\s+i['’]?m\s+(?:\d{2}|of\s+age|old(?:er|enough))/i,
  /\bi\s+am\s+(?:\d{2}|of\s+legal\s+age|old\s+enough)/i,
  /\b(?:i['’]?m|yes,?\s+i['’]?m)\s+(?:of\s+(?:drinking|legal)\s+age)/i,
  /\benter\s+(?:site|store|shop)\b/i,
  /\bconfirm(?:\s+age)?\b/i,
  /\bover\s+\d{2}\b/i,
  /\b(?:19|20|21)\+/,
];

const AGE_GATE_DIRECT_SELECTORS = [
  'button[id*="age"]',
  'button[class*="age"]',
  'button[data-testid*="age"]',
  'button[aria-label*="age" i]',
  'a[id*="age-gate"]',
  'button[id*="over"]',
  'button[class*="enter-site" i]',
];

export async function dismissAgeGate(page: import("puppeteer-core").Page): Promise<boolean> {
  try {
    // Try direct selectors first — fastest.
    for (const sel of AGE_GATE_DIRECT_SELECTORS) {
      const btn = await page.$(sel);
      if (!btn) continue;
      const text = (await btn.evaluate((el) => el.textContent ?? "")) ?? "";
      // Skip "No" / "deny" variants.
      if (/no,?\s+i['’]?m\s+(?:under|not)/i.test(text) || /\bexit\b/i.test(text)) continue;
      await btn.click().catch(() => null);
      await page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 5000 })
        .catch(() => null);
      return true;
    }

    // Fallback: scan all buttons for matching text.
    const clicked = await page.evaluate(
      (patternsSrc: string[]) => {
        const patterns = patternsSrc.map((p) => new RegExp(p.replace(/^\/(.+)\/([gimsuy]*)$/, "$1"), "i"));
        const candidates = Array.from(
          document.querySelectorAll(
            'button, input[type="button"], input[type="submit"], a[role="button"]'
          )
        );
        for (const el of candidates) {
          const text = (el.textContent ?? "").trim();
          const value = (el as HTMLInputElement).value ?? "";
          const combined = `${text} ${value}`;
          if (!combined) continue;
          if (/no,?\s+i['’]?m\s+(?:under|not)/i.test(combined)) continue;
          if (/\bexit\b/i.test(combined)) continue;
          if (patterns.some((p) => p.test(combined))) {
            (el as HTMLElement).click();
            return true;
          }
        }
        return false;
      },
      AGE_GATE_TEXT_PATTERNS.map((p) => p.toString())
    );
    if (clicked) {
      await page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 5000 })
        .catch(() => null);
      return true;
    }
  } catch {
    // Age-gate dismissal is best-effort — never throws.
  }
  return false;
}

/**
 * Exported pure helper for the test suite: does this visible button
 * text look like an age-gate confirmation (not a denial)?
 */
export function isAgeGateConfirmText(text: string): boolean {
  const normalised = text.trim();
  if (!normalised) return false;
  // Deny first: "No, I'm under 21" / "Exit"
  if (/no,?\s+i['’]?m\s+(?:under|not)/i.test(normalised)) return false;
  if (/\bexit\b/i.test(normalised)) return false;
  return AGE_GATE_TEXT_PATTERNS.some((p) => p.test(normalised));
}
