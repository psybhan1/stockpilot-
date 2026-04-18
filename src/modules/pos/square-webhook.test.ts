import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSquareWebhookJobType } from "./square-webhook";

describe("getSquareWebhookJobType — catalog-family events", () => {
  it("maps 'catalog.version.updated' → SYNC_CATALOG", () => {
    assert.equal(getSquareWebhookJobType("catalog.version.updated"), "SYNC_CATALOG");
  });

  it("maps 'item.updated' → SYNC_CATALOG", () => {
    assert.equal(getSquareWebhookJobType("item.updated"), "SYNC_CATALOG");
  });

  it("maps 'item.created' → SYNC_CATALOG", () => {
    assert.equal(getSquareWebhookJobType("item.created"), "SYNC_CATALOG");
  });

  it("maps 'item.deleted' → SYNC_CATALOG", () => {
    assert.equal(getSquareWebhookJobType("item.deleted"), "SYNC_CATALOG");
  });

  it("maps 'category.updated' → SYNC_CATALOG", () => {
    assert.equal(getSquareWebhookJobType("category.updated"), "SYNC_CATALOG");
  });

  it("maps any 'catalog.*' subtype → SYNC_CATALOG", () => {
    assert.equal(getSquareWebhookJobType("catalog.foo.bar"), "SYNC_CATALOG");
  });
});

describe("getSquareWebhookJobType — sales-family events", () => {
  it("maps 'order.created' → SYNC_SALES", () => {
    assert.equal(getSquareWebhookJobType("order.created"), "SYNC_SALES");
  });

  it("maps 'order.updated' → SYNC_SALES", () => {
    assert.equal(getSquareWebhookJobType("order.updated"), "SYNC_SALES");
  });

  it("maps 'payment.updated' → SYNC_SALES", () => {
    assert.equal(getSquareWebhookJobType("payment.updated"), "SYNC_SALES");
  });

  it("maps 'payment.created' → SYNC_SALES", () => {
    assert.equal(getSquareWebhookJobType("payment.created"), "SYNC_SALES");
  });

  it("maps 'refund.updated' → SYNC_SALES", () => {
    assert.equal(getSquareWebhookJobType("refund.updated"), "SYNC_SALES");
  });

  it("maps any 'order.*' subtype → SYNC_SALES", () => {
    assert.equal(getSquareWebhookJobType("order.fulfillment.updated"), "SYNC_SALES");
  });
});

describe("getSquareWebhookJobType — case insensitivity + whitespace", () => {
  it("treats UPPERCASE event types the same as lowercase", () => {
    assert.equal(getSquareWebhookJobType("ORDER.CREATED"), "SYNC_SALES");
  });

  it("treats MixedCase event types the same as lowercase", () => {
    assert.equal(getSquareWebhookJobType("Item.Updated"), "SYNC_CATALOG");
  });

  it("trims leading whitespace", () => {
    assert.equal(getSquareWebhookJobType("   order.created"), "SYNC_SALES");
  });

  it("trims trailing whitespace", () => {
    assert.equal(getSquareWebhookJobType("item.updated\n\n"), "SYNC_CATALOG");
  });

  it("trims both sides + handles tabs", () => {
    assert.equal(getSquareWebhookJobType("\t refund.created \t"), "SYNC_SALES");
  });
});

describe("getSquareWebhookJobType — unsupported events return null", () => {
  it("'labor.shift.updated' → null", () => {
    assert.equal(getSquareWebhookJobType("labor.shift.updated"), null);
  });

  it("'inventory.count.updated' → null (we use our own inventory)", () => {
    assert.equal(getSquareWebhookJobType("inventory.count.updated"), null);
  });

  it("'team_member.created' → null", () => {
    assert.equal(getSquareWebhookJobType("team_member.created"), null);
  });

  it("'dispute.evidence_added' → null", () => {
    assert.equal(getSquareWebhookJobType("dispute.evidence_added"), null);
  });

  it("unknown future event type returns null (not catalog, not sales)", () => {
    assert.equal(getSquareWebhookJobType("future.event_that_does_not_exist"), null);
  });
});

describe("getSquareWebhookJobType — edge cases + null-safety", () => {
  it("returns null for undefined", () => {
    assert.equal(getSquareWebhookJobType(undefined), null);
  });

  it("returns null for null", () => {
    assert.equal(getSquareWebhookJobType(null), null);
  });

  it("returns null for empty string", () => {
    assert.equal(getSquareWebhookJobType(""), null);
  });

  it("returns null for whitespace-only string", () => {
    assert.equal(getSquareWebhookJobType("   \n\t  "), null);
  });

  it("returns null for bare prefix without the dot ('catalog' alone)", () => {
    // "catalog" without a trailing dot is NOT a valid event type;
    // Square always sends `<domain>.<event>`. Lock the strict
    // startsWith("catalog.") behaviour so a stray test string doesn't
    // accidentally pass.
    assert.equal(getSquareWebhookJobType("catalog"), null);
  });

  it("returns null for 'catalogues.something' (close-but-not-catalog)", () => {
    // startsWith check on "catalog." means "catalogues.updated"
    // starts with "catalogue" not "catalog.", so → null.
    assert.equal(getSquareWebhookJobType("catalogues.updated"), null);
  });

  it("returns null for 'order' without a suffix", () => {
    assert.equal(getSquareWebhookJobType("order"), null);
  });

  it("returns null for 'orderly.update' (starts with 'order' but not 'order.')", () => {
    assert.equal(getSquareWebhookJobType("orderly.update"), null);
  });

  it("returns null for the bare word 'payment' with no suffix", () => {
    assert.equal(getSquareWebhookJobType("payment"), null);
  });

  it("does not throw on weird characters", () => {
    assert.doesNotThrow(() => getSquareWebhookJobType("<script>alert(1)</script>"));
    assert.equal(getSquareWebhookJobType("<script>alert(1)</script>"), null);
  });

  it("handles unicode without throwing", () => {
    assert.doesNotThrow(() => getSquareWebhookJobType("order.日本"));
    assert.equal(getSquareWebhookJobType("order.日本"), "SYNC_SALES");
  });

  it("handles very long input without blowing up", () => {
    const long = "order." + "x".repeat(10000);
    assert.equal(getSquareWebhookJobType(long), "SYNC_SALES");
  });
});

describe("getSquareWebhookJobType — return type + determinism", () => {
  it("returns exactly the string 'SYNC_CATALOG' (not a wider type)", () => {
    const result = getSquareWebhookJobType("item.updated");
    assert.equal(typeof result, "string");
    assert.equal(result, "SYNC_CATALOG");
  });

  it("returns exactly the string 'SYNC_SALES'", () => {
    const result = getSquareWebhookJobType("order.created");
    assert.equal(typeof result, "string");
    assert.equal(result, "SYNC_SALES");
  });

  it("is deterministic (same input → same output)", () => {
    for (let i = 0; i < 20; i += 1) {
      assert.equal(getSquareWebhookJobType("item.updated"), "SYNC_CATALOG");
    }
  });
});
