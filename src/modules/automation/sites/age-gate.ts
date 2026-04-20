/**
 * Pure age-gate helpers. Extracted from sites/generic.ts (which
 * imports puppeteer-core) so this tiny piece of the pipeline can be
 * unit-tested without a browser runtime.
 *
 * Age gates on LCBO, SAQ, BevMo, Total Wine, and many adult-content
 * sites block access behind an age-verification modal. The modal is
 * usually a simple "Yes, I'm 21+" / "I am 19 or older" button that
 * sets a cookie then lets you browse. Missing it means the search
 * box isn't reachable and the agent fails cryptically.
 */

/**
 * Patterns we treat as age-gate *confirmation* copy. Used both in the
 * page-side evaluate() scan and the pure-helper check below.
 */
export const AGE_GATE_TEXT_PATTERNS: RegExp[] = [
  /\byes[,!]?\s+i['’]?m\s+(?:\d{2}|of\s+age|old(?:er|enough))/i,
  /\bi\s+am\s+(?:\d{2}|of\s+legal\s+age|old\s+enough)/i,
  /\b(?:i['’]?m|yes,?\s+i['’]?m)\s+(?:of\s+(?:drinking|legal)\s+age)/i,
  /\benter\s+(?:site|store|shop)\b/i,
  /\bconfirm(?:\s+age)?\b/i,
  /\bover\s+\d{2}\b/i,
  /\b(?:19|20|21)\+/,
];

/**
 * CSS selectors for the actual DOM button. Direct path is always
 * preferred over scanning button text — faster, less noise.
 */
export const AGE_GATE_DIRECT_SELECTORS: string[] = [
  'button[id*="age"]',
  'button[class*="age"]',
  'button[data-testid*="age"]',
  'button[aria-label*="age" i]',
  'a[id*="age-gate"]',
  'button[id*="over"]',
  'button[class*="enter-site" i]',
];

/**
 * Pure helper: does this visible button text look like an age-gate
 * confirmation (not a denial)? Returns false for empty text, "No, I'm
 * under 21"-style deny buttons, and explicit "Exit" buttons.
 */
export function isAgeGateConfirmText(text: string): boolean {
  const normalised = text.trim();
  if (!normalised) return false;
  // Deny first: "No, I'm under 21" / "Exit"
  if (/no,?\s+i['’]?m\s+(?:under|not)/i.test(normalised)) return false;
  if (/\bexit\b/i.test(normalised)) return false;
  return AGE_GATE_TEXT_PATTERNS.some((p) => p.test(normalised));
}
