import test from "node:test";
import assert from "node:assert/strict";

import { humaniseStepName } from "./step-labels";

// ── Empty + unknown fallbacks ───────────────────────────────────────

test("empty string → 'Step' (never returns empty label or throws)", () => {
  assert.equal(humaniseStepName(""), "Step");
});

test("unknown single-word prefix → title-case fallback", () => {
  assert.equal(humaniseStepName("mystery"), "Mystery");
});

test("unknown kebab prefix → title-case per word", () => {
  assert.equal(humaniseStepName("some-weird-event"), "Some Weird Event");
});

test("unknown snake_case → title-case per word", () => {
  assert.equal(humaniseStepName("weird_thing"), "Weird Thing");
});

test("mixed snake + kebab treated as word separators", () => {
  assert.equal(humaniseStepName("weird_thing-here"), "Weird Thing Here");
});

// ── Zero-suffix known prefixes ──────────────────────────────────────

test("'launched' → 'Launched Chrome' (no suffix)", () => {
  assert.equal(humaniseStepName("launched"), "Launched Chrome");
});

test("'landing' → 'Loaded supplier homepage'", () => {
  assert.equal(humaniseStepName("landing"), "Loaded supplier homepage");
});

test("'cart' → 'Viewing cart'", () => {
  assert.equal(humaniseStepName("cart"), "Viewing cart");
});

test("'cart-final' → 'Viewing cart' (longer prefix wins, not 'cart' + suffix 'final')", () => {
  // Regression test: without longest-prefix matching, this would
  // match "cart" first and render "Viewing cart" with a stray
  // suffix, or confusingly match `cart` and ignore `final`.
  assert.equal(humaniseStepName("cart-final"), "Viewing cart");
});

test("'cart-final-fallback' → 'Cart page didn't load cleanly' (beats 'cart-final' + 'cart')", () => {
  assert.equal(
    humaniseStepName("cart-final-fallback"),
    "Cart page didn't load cleanly",
  );
});

test("'cart-final-with-login' → 'Viewing cart (signed in)'", () => {
  assert.equal(
    humaniseStepName("cart-final-with-login"),
    "Viewing cart (signed in)",
  );
});

test("'final' → 'Done'", () => {
  assert.equal(humaniseStepName("final"), "Done");
});

// ── Search + search fallback ────────────────────────────────────────

test("'search' with no suffix → 'Searching' (don't leak trailing ': ')", () => {
  assert.equal(humaniseStepName("search"), "Searching");
});

test("'search-espresso' → 'Searching: espresso'", () => {
  assert.equal(humaniseStepName("search-espresso"), "Searching: espresso");
});

test("'search-oat milk cartons' → 'Searching: oat milk cartons' (multi-word suffix preserved)", () => {
  // Agent passes the raw search query; spaces inside the query
  // must not be treated as separators.
  assert.equal(
    humaniseStepName("search-oat milk cartons"),
    "Searching: oat milk cartons",
  );
});

test("'search-fallback' → 'Retrying via search: item' (empty suffix → fallback 'item')", () => {
  assert.equal(humaniseStepName("search-fallback"), "Retrying via search: item");
});

test("'search-fallback-urnex cafiza' → includes the item name", () => {
  assert.equal(
    humaniseStepName("search-fallback-urnex cafiza"),
    "Retrying via search: urnex cafiza",
  );
});

// ── Product family (4 prefixes, greedy order matters) ───────────────

test("'product' alone → 'Viewing product page'", () => {
  assert.equal(humaniseStepName("product"), "Viewing product page");
});

test("'product-urnex' → 'Viewing product: urnex' (single-word suffix)", () => {
  assert.equal(humaniseStepName("product-urnex"), "Viewing product: urnex");
});

test("'product-direct' alone → 'Loading product page' (prefix wins, no suffix)", () => {
  assert.equal(humaniseStepName("product-direct"), "Loading product page");
});

test("'product-direct-urnex cafiza' → 'Loading product: urnex cafiza'", () => {
  // Greedy: "product-direct" prefix selected over plain "product",
  // then the remaining parts become the suffix.
  assert.equal(
    humaniseStepName("product-direct-urnex cafiza"),
    "Loading product: urnex cafiza",
  );
});

test("'product-from-search-beans' → 'Selected search result: beans'", () => {
  assert.equal(
    humaniseStepName("product-from-search-beans"),
    "Selected search result: beans",
  );
});

test("'product-from-search' alone → 'Selected search result: product'", () => {
  assert.equal(
    humaniseStepName("product-from-search"),
    "Selected search result: product",
  );
});

test("'product-not-found-urnex' → 'Product page not found: urnex'", () => {
  assert.equal(
    humaniseStepName("product-not-found-urnex"),
    "Product page not found: urnex",
  );
});

test("'product-not-found' alone → fallback 'item'", () => {
  assert.equal(
    humaniseStepName("product-not-found"),
    "Product page not found: item",
  );
});

// ── Add-to-cart family ──────────────────────────────────────────────

test("'added' alone → 'Added to cart'", () => {
  assert.equal(humaniseStepName("added"), "Added to cart");
});

test("'added-urnex cafiza' → 'Added to cart: urnex cafiza'", () => {
  assert.equal(
    humaniseStepName("added-urnex cafiza"),
    "Added to cart: urnex cafiza",
  );
});

test("'no-search-urnex' → 'No search box on this site (urnex)'", () => {
  assert.equal(
    humaniseStepName("no-search-urnex"),
    "No search box on this site (urnex)",
  );
});

test("'no-search' alone → 'No search box on this site (item)'", () => {
  assert.equal(
    humaniseStepName("no-search"),
    "No search box on this site (item)",
  );
});

test("'no-cart-btn-urnex' → 'No Add-to-Cart button (urnex)'", () => {
  assert.equal(
    humaniseStepName("no-cart-btn-urnex"),
    "No Add-to-Cart button (urnex)",
  );
});

test("'no-cart-btn' alone → 'No Add-to-Cart button (item)'", () => {
  assert.equal(
    humaniseStepName("no-cart-btn"),
    "No Add-to-Cart button (item)",
  );
});

// ── Login family (regression guard for longest-prefix matching) ─────

test("'login-page' → 'Opening supplier login page' (beats nothing, no shorter 'login' key exists)", () => {
  assert.equal(humaniseStepName("login-page"), "Opening supplier login page");
});

test("'login-no-email-field' → specific 'email field missing' label", () => {
  // Without longest-prefix, this would fall through to the
  // title-case fallback and produce "Login No Email Field".
  assert.equal(
    humaniseStepName("login-no-email-field"),
    "Login failed: email field missing",
  );
});

test("'login-no-password-field' → 'password field missing'", () => {
  assert.equal(
    humaniseStepName("login-no-password-field"),
    "Login failed: password field missing",
  );
});

test("'login-failed' → 'Login failed — falling back to guest mode'", () => {
  assert.equal(
    humaniseStepName("login-failed"),
    "Login failed — falling back to guest mode",
  );
});

test("'after-form-login' → 'Signed in via form'", () => {
  assert.equal(humaniseStepName("after-form-login"), "Signed in via form");
});

test("'after-cookie-login' → 'Signed in via saved cookies'", () => {
  assert.equal(
    humaniseStepName("after-cookie-login"),
    "Signed in via saved cookies",
  );
});

test("bare 'login' (no matching key) → falls through to title-case 'Login'", () => {
  // 'login' is not in the lookup as a standalone prefix — only
  // compound forms like 'login-page', 'login-failed'. Bare 'login'
  // should title-case fallback, not accidentally match a compound.
  assert.equal(humaniseStepName("login"), "Login");
});

test("'landing-error' → 'Couldn't load supplier homepage' (longer than 'landing')", () => {
  assert.equal(
    humaniseStepName("landing-error"),
    "Couldn't load supplier homepage",
  );
});

// ── Suffix normalisation ────────────────────────────────────────────

test("suffix with trailing whitespace gets trimmed", () => {
  assert.equal(
    humaniseStepName("search-   spaced out   "),
    "Searching: spaced out",
  );
});

test("suffix with snake_case gets de-snaked to spaces", () => {
  assert.equal(
    humaniseStepName("search-oat_milk_cartons"),
    "Searching: oat milk cartons",
  );
});

test("suffix with consecutive hyphens → the empty segment becomes an extra space", () => {
  // Pins current behaviour: split("-") on "urnex--cafiza" yields
  // ["urnex", "", "cafiza"], joined with " " → double space.
  // `.replace(/[_-]+/g, " ")` operates on the ORIGINAL chars only
  // (underscores + hyphens) so it doesn't collapse the space pair.
  // If we later decide to normalise whitespace too, update this
  // test deliberately.
  assert.equal(
    humaniseStepName("product-direct-urnex--cafiza"),
    "Loading product: urnex  cafiza",
  );
});

test("empty-after-trim suffix behaves as no suffix (fallback label)", () => {
  // "search-   " → suffix trims to empty → uses 'Searching' (no colon).
  assert.equal(humaniseStepName("search-   "), "Searching");
});

// ── Stability + non-throw guarantees ────────────────────────────────

test("all prefixes are idempotent (same input → same output)", () => {
  const samples = [
    "launched",
    "landing",
    "search-beans",
    "product-direct-latte",
    "added-milk",
    "cart-final-with-login",
    "final",
    "unknown_weird_thing",
  ];
  for (const s of samples) {
    assert.equal(humaniseStepName(s), humaniseStepName(s));
  }
});

test("does not throw on odd inputs", () => {
  for (const s of ["-", "---", "_", "a", "A", "\n", " "]) {
    assert.doesNotThrow(() => humaniseStepName(s));
    // Result is always a non-empty string.
    assert.ok(humaniseStepName(s).length > 0);
  }
});

test("very long suffix (10KB) is returned without truncation or crash", () => {
  // Agent theoretically could emit a runaway suffix. We don't
  // truncate — just make sure it doesn't throw. Downstream DB
  // has its own column cap.
  const huge = "search-" + "x".repeat(10_000);
  const out = humaniseStepName(huge);
  assert.ok(out.startsWith("Searching: "));
  assert.equal(out.length, "Searching: ".length + 10_000);
});
