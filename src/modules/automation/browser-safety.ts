/**
 * Safety constants + helpers for the browser ordering agent.
 *
 * The single most critical rule: NEVER click a payment / checkout
 * submit button. This file defines the patterns we block and the
 * screenshot helper that captures evidence at each step.
 */

import type { Page } from "puppeteer-core";

/**
 * Text patterns that indicate a "finalise purchase" button. If the
 * agent encounters an element whose visible text matches any of
 * these, it MUST NOT click it.
 */
export const FORBIDDEN_BUTTON_PATTERNS = [
  /place\s*(your)?\s*order/i,
  /buy\s*now/i,
  /complete\s*(your)?\s*purchase/i,
  /confirm\s*(your)?\s*(order|payment|purchase)/i,
  /pay\s*now/i,
  /submit\s*(your)?\s*order/i,
  /proceed\s*to\s*(payment|checkout)/i,
  /place\s*order/i,
  /finalize\s*(order|purchase)/i,
];

/**
 * CSS selectors for common checkout-submit buttons that should
 * never be clicked even if the agent's heuristic mis-identifies
 * them as "add to cart".
 */
export const FORBIDDEN_SELECTORS = [
  "#submitOrderButtonId",
  "#placeYourOrder",
  '[name="placeYourOrder"]',
  ".place-your-order-button",
  "#buy-now-button",
  '[data-action="buy-now"]',
  "#checkout-pay-button",
];

/**
 * Returns true if a button's text matches a forbidden payment
 * pattern. Used as a last-resort guard before any click.
 */
export function isForbiddenButton(text: string): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
  return FORBIDDEN_BUTTON_PATTERNS.some((p) => p.test(clean));
}

/**
 * Safe-click: clicks an element ONLY if its text doesn't match a
 * forbidden pattern. Throws instead of clicking if blocked.
 */
export async function safeClick(
  page: Page,
  selector: string,
  label: string
): Promise<void> {
  const el = await page.$(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  const text = (await el.evaluate((e) => e.textContent ?? "")) ?? "";
  if (isForbiddenButton(text)) {
    throw new Error(
      `SAFETY BLOCK: Refused to click "${label}" because its text "${text.slice(0, 80)}" matches a payment pattern.`
    );
  }
  for (const forbidden of FORBIDDEN_SELECTORS) {
    const matches = await el.evaluate(
      (e, sel) => e.matches(sel),
      forbidden
    );
    if (matches) {
      throw new Error(
        `SAFETY BLOCK: Refused to click "${label}" because it matches forbidden selector "${forbidden}".`
      );
    }
  }
  await el.click();
}

/**
 * Takes a full-page screenshot and returns it as a Buffer.
 * Used at each step to build the evidence chain sent to the
 * manager on Telegram.
 */
export async function takeStepScreenshot(
  page: Page,
  stepName: string
): Promise<{ stepName: string; screenshot: Buffer }> {
  const screenshot = (await page.screenshot({
    fullPage: true,
    type: "jpeg",
    quality: 70,
  })) as Buffer;
  return { stepName, screenshot };
}

/**
 * Hard timeout wrapper. Aborts the browser task if it exceeds
 * the safety window.
 */
export const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
