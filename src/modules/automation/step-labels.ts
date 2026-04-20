/**
 * Pure label-rendering for agent steps. Separated from agent-steps.ts
 * (which imports Prisma) so it can be unit-tested in isolation.
 *
 * Pretty a step name for human display. The recorder accepts internal
 * identifiers like "search-espresso machine cleaner" or
 * "product-direct-urnex-cafiza" — UI wants "Searching: Espresso
 * machine cleaner" or "Loading product: urnex cafiza".
 *
 * Matching is greedy-longest-prefix: we try multi-word keys like
 * "product-direct" and "login-no-email-field" before single-word ones
 * like "product" or "login". Whatever prefix matches, the remaining
 * text is passed as `suffix` to the label-builder.
 */
export function humaniseStepName(internal: string): string {
  if (!internal) return "Step";

  // Label builders keyed by dash-joined prefix. Listed in no
  // particular order; we pick the LONGEST matching prefix.
  const lookup: Record<string, (s: string) => string> = {
    launched: () => "Launched Chrome",
    "login-page": () => "Opening supplier login page",
    "login-no-email-field": () => "Login failed: email field missing",
    "login-no-password-field": () => "Login failed: password field missing",
    "after-form-login": () => "Signed in via form",
    "after-cookie-login": () => "Signed in via saved cookies",
    "login-failed": () => "Login failed — falling back to guest mode",
    landing: () => "Loaded supplier homepage",
    "landing-error": () => "Couldn't load supplier homepage",
    search: (s) => (s ? `Searching: ${s}` : "Searching"),
    "search-fallback": (s) => `Retrying via search: ${s || "item"}`,
    product: (s) => (s ? `Viewing product: ${s}` : "Viewing product page"),
    "product-direct": (s) => (s ? `Loading product: ${s}` : "Loading product page"),
    "product-from-search": (s) => `Selected search result: ${s || "product"}`,
    "product-not-found": (s) => `Product page not found: ${s || "item"}`,
    added: (s) => (s ? `Added to cart: ${s}` : "Added to cart"),
    "no-search": (s) => `No search box on this site (${s || "item"})`,
    "no-cart-btn": (s) => `No Add-to-Cart button (${s || "item"})`,
    cart: () => "Viewing cart",
    "cart-final": () => "Viewing cart",
    "cart-final-fallback": () => "Cart page didn't load cleanly",
    "cart-final-with-login": () => "Viewing cart (signed in)",
    final: () => "Done",
  };

  const parts = internal.split("-");
  // Try longest prefix first (e.g. "login-no-email-field" > "login").
  for (let len = parts.length; len > 0; len -= 1) {
    const prefix = parts.slice(0, len).join("-");
    const fn = lookup[prefix];
    if (!fn) continue;
    const suffix = parts.slice(len).join(" ").replace(/[_-]+/g, " ").trim();
    return fn(suffix);
  }

  // Unknown prefix: title-case the whole thing.
  return internal
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
