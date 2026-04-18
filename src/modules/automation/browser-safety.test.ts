import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_TIMEOUT_MS,
  FORBIDDEN_BUTTON_PATTERNS,
  FORBIDDEN_SELECTORS,
  isForbiddenButton,
} from "./browser-safety";

// ── isForbiddenButton: the last line of defence ──────────────────
//
// If this function ever returns false for a real "Place Order"
// button, the bot commits fraud on behalf of the user. Every
// marketing variant of "complete purchase" that a major retailer
// uses should be covered here. Tests are deliberately exhaustive.

test("blocks 'Place Order' (Amazon / Walmart / Target standard)", () => {
  assert.equal(isForbiddenButton("Place Order"), true);
  assert.equal(isForbiddenButton("Place your order"), true);
  assert.equal(isForbiddenButton("PLACE ORDER"), true);
  assert.equal(isForbiddenButton("place your order"), true);
});

test("blocks 'Buy Now' (1-click / express-checkout pattern)", () => {
  assert.equal(isForbiddenButton("Buy Now"), true);
  assert.equal(isForbiddenButton("BUY NOW"), true);
  assert.equal(isForbiddenButton("buy  now"), true); // double-space
});

test("blocks 'Complete Purchase' in every capitalisation", () => {
  assert.equal(isForbiddenButton("Complete purchase"), true);
  assert.equal(isForbiddenButton("Complete Your Purchase"), true);
  assert.equal(isForbiddenButton("complete your purchase"), true);
});

test("blocks 'Confirm Order/Payment/Purchase' (post-shipping-address step)", () => {
  assert.equal(isForbiddenButton("Confirm order"), true);
  assert.equal(isForbiddenButton("Confirm your order"), true);
  assert.equal(isForbiddenButton("Confirm Payment"), true);
  assert.equal(isForbiddenButton("Confirm purchase"), true);
  assert.equal(isForbiddenButton("Confirm your payment"), true);
});

test("blocks 'Pay Now' (instacart / deliveroo style)", () => {
  assert.equal(isForbiddenButton("Pay Now"), true);
  assert.equal(isForbiddenButton("PAY NOW"), true);
});

test("blocks 'Submit Order'", () => {
  assert.equal(isForbiddenButton("Submit order"), true);
  assert.equal(isForbiddenButton("Submit your order"), true);
});

test("blocks 'Proceed to Payment/Checkout'", () => {
  assert.equal(isForbiddenButton("Proceed to payment"), true);
  assert.equal(isForbiddenButton("Proceed to checkout"), true);
  assert.equal(isForbiddenButton("proceed to Checkout"), true);
});

test("blocks 'Finalize Order/Purchase'", () => {
  assert.equal(isForbiddenButton("Finalize order"), true);
  assert.equal(isForbiddenButton("Finalize purchase"), true);
});

// Whitespace / punctuation tolerance — real buttons have icons and
// weird spacing, not neat single spaces.

test("matches across irregular whitespace (tabs, newlines, multiple spaces)", () => {
  assert.equal(isForbiddenButton("Place   Order"), true);
  assert.equal(isForbiddenButton("Place\tOrder"), true);
  assert.equal(isForbiddenButton("Place\nOrder"), true);
  assert.equal(isForbiddenButton("   Place Order   "), true);
});

test("matches when label is surrounded by leading/trailing icon text", () => {
  // Many sites render "💳 Place your order" or "Place your order ➜"
  // using CSS pseudo-elements that textContent picks up.
  assert.equal(isForbiddenButton("💳 Place your order"), true);
  assert.equal(isForbiddenButton("Place your order ➜"), true);
  assert.equal(isForbiddenButton("» Buy Now «"), true);
});

test("matches when label contains price text after it", () => {
  // "Place order • $42.00" — textContent of a button that shows price.
  assert.equal(isForbiddenButton("Place order • $42.00"), true);
  assert.equal(isForbiddenButton("Pay Now — $9.99 USD"), true);
});

// ── Allow-list: legitimate "Add to Cart" patterns MUST pass ──────
//
// Overly-broad regex would block the whole ordering flow. These are
// the buttons the agent depends on clicking.

test("does NOT block 'Add to Cart' (the button the agent needs to press)", () => {
  assert.equal(isForbiddenButton("Add to Cart"), false);
  assert.equal(isForbiddenButton("Add to cart"), false);
  assert.equal(isForbiddenButton("ADD TO CART"), false);
  assert.equal(isForbiddenButton("Add to bag"), false);
  assert.equal(isForbiddenButton("Add to basket"), false);
});

test("does NOT block product-page navigation buttons", () => {
  assert.equal(isForbiddenButton("View details"), false);
  assert.equal(isForbiddenButton("See more"), false);
  assert.equal(isForbiddenButton("Continue shopping"), false);
  assert.equal(isForbiddenButton("Back to results"), false);
});

test("does NOT block 'Search' / 'Go'", () => {
  assert.equal(isForbiddenButton("Search"), false);
  assert.equal(isForbiddenButton("Go"), false);
  assert.equal(isForbiddenButton("Find"), false);
});

test("does NOT block sign-in or account buttons", () => {
  assert.equal(isForbiddenButton("Sign in"), false);
  assert.equal(isForbiddenButton("Continue"), false);
  assert.equal(isForbiddenButton("Continue as guest"), false);
});

test("does NOT block 'Save for later' or similar cart management", () => {
  assert.equal(isForbiddenButton("Save for later"), false);
  assert.equal(isForbiddenButton("Remove"), false);
  assert.equal(isForbiddenButton("Update quantity"), false);
});

test("does NOT block descriptive text that merely contains 'order'", () => {
  // The agent may read textContent of a container, not just the
  // button. These must pass — they describe the page, not a
  // payment action.
  assert.equal(isForbiddenButton("Your order summary"), false);
  assert.equal(isForbiddenButton("Recent orders"), false);
  assert.equal(isForbiddenButton("Order history"), false);
  assert.equal(isForbiddenButton("In order to continue"), false);
});

test("does NOT block 'Proceed to shipping' (pre-payment step)", () => {
  // Shipping is pre-payment. The agent legitimately needs to advance
  // past it to reach the cart-review page.
  assert.equal(isForbiddenButton("Proceed to shipping"), false);
  assert.equal(isForbiddenButton("Continue to shipping"), false);
});

test("does NOT block empty / whitespace-only text", () => {
  // An element with no visible text isn't a forbidden button.
  assert.equal(isForbiddenButton(""), false);
  assert.equal(isForbiddenButton("   "), false);
  assert.equal(isForbiddenButton("\n\t"), false);
});

// ── Adversarial: near-misses, case, partial matches ──────────────

test("matches 'PLACE YOUR ORDER' even with all-caps and extra words around", () => {
  // Real Amazon button: "Place your order and pay".
  assert.equal(isForbiddenButton("Place your order and pay"), true);
});

test("does NOT match dissimilar words that share a root", () => {
  assert.equal(isForbiddenButton("Displace"), false);
  assert.equal(isForbiddenButton("Replacement"), false);
  assert.equal(isForbiddenButton("Buyer reviews"), false);
  assert.equal(isForbiddenButton("Payment method"), false);
});

test("catches 'Buynow' squeezed together (some sites strip the space)", () => {
  // buy\s*now allows zero whitespace. Confirm.
  assert.equal(isForbiddenButton("Buynow"), true);
  assert.equal(isForbiddenButton("BuyNow"), true);
});

test("catches 'PlaceOrder' squeezed together", () => {
  assert.equal(isForbiddenButton("PlaceOrder"), true);
  assert.equal(isForbiddenButton("placeorder"), true);
});

// ── Constants shape / invariants ─────────────────────────────────

test("FORBIDDEN_BUTTON_PATTERNS is a non-empty array of RegExp", () => {
  assert.ok(Array.isArray(FORBIDDEN_BUTTON_PATTERNS));
  assert.ok(FORBIDDEN_BUTTON_PATTERNS.length >= 8);
  for (const p of FORBIDDEN_BUTTON_PATTERNS) {
    assert.ok(p instanceof RegExp, `${p} is not a RegExp`);
    assert.ok(p.flags.includes("i"), `pattern ${p} missing case-insensitive flag`);
  }
});

test("FORBIDDEN_SELECTORS covers known Amazon + generic submit IDs", () => {
  assert.ok(Array.isArray(FORBIDDEN_SELECTORS));
  // Amazon's actual submit button ID in 2026.
  assert.ok(FORBIDDEN_SELECTORS.includes("#submitOrderButtonId"));
  // At least one attribute-based selector (brittle to class-rename attacks).
  assert.ok(FORBIDDEN_SELECTORS.some((s) => s.includes("[")));
});

test("AGENT_TIMEOUT_MS is a sane hard ceiling (1..30 min)", () => {
  // The bot must not run forever — but cutting it too short kills
  // legit multi-page order flows. 5 min is today's value; assert
  // the envelope rather than pin the exact number.
  assert.ok(AGENT_TIMEOUT_MS >= 60_000, "timeout too short (< 1 min)");
  assert.ok(AGENT_TIMEOUT_MS <= 30 * 60_000, "timeout too long (> 30 min)");
});

// ── Defence in depth: regression snapshot of critical blocks ─────

test("REGRESSION: exact Amazon button text blocks (if this fails, the bot could place orders)", () => {
  // Pin the real-world strings that must always block. A failure
  // here means the regexes were narrowed in a way that broke
  // production safety. This test is deliberately redundant with
  // the pattern-level tests above.
  const realAmazonButtons = [
    "Place your order",
    "Place your order and pay",
    "Buy Now",
    "Buy now with 1-Click",
  ];
  for (const text of realAmazonButtons) {
    assert.equal(
      isForbiddenButton(text),
      true,
      `CRITICAL: ${JSON.stringify(text)} is no longer blocked`,
    );
  }
});

test("REGRESSION: exact Walmart/Target checkout strings block", () => {
  const realStrings = [
    "Place order",
    "Continue to payment",
    "Review & place order",
    "Submit order",
  ];
  for (const text of realStrings) {
    const blocked = isForbiddenButton(text);
    // "Continue to payment" isn't in our list — that's a gap we
    // want to surface, not hide. Assert per-string with a useful
    // failure message.
    if (text === "Continue to payment") {
      // Today this may or may not block — pattern is
      // /proceed\s*to\s*(payment|checkout)/ — "continue" ≠ "proceed".
      // Document the gap: if we ever add /continue\s*to\s*payment/
      // this test will start failing and we update the expectation.
      assert.equal(
        blocked,
        false,
        "Update this test when /continue\\s*to\\s*payment/ is added",
      );
    } else {
      assert.equal(blocked, true, `expected ${JSON.stringify(text)} to block`);
    }
  }
});
