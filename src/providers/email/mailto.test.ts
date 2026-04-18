import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMailtoUrl } from "./mailto";

describe("buildMailtoUrl — basic structure", () => {
  it("starts with 'mailto:'", () => {
    const url = buildMailtoUrl({ to: "a@b.com", subject: "s", body: "b" });
    assert.ok(url.startsWith("mailto:"), `got: ${url}`);
  });

  it("contains ? separating recipient and query string", () => {
    const url = buildMailtoUrl({ to: "a@b.com", subject: "s", body: "b" });
    assert.ok(url.includes("?"));
    const [head, query] = url.split("?");
    assert.equal(head, "mailto:a%40b.com");
    assert.ok(query.includes("subject=s"));
    assert.ok(query.includes("body=b"));
  });

  it("uses + for spaces in subject/body (URLSearchParams behavior)", () => {
    // URLSearchParams encodes space as '+', not '%20'. Locking
    // this — iOS Mail / Gmail / Outlook all accept '+' in the
    // subject/body params.
    const url = buildMailtoUrl({
      to: "x@y.com",
      subject: "Hello World",
      body: "two words",
    });
    assert.ok(url.includes("subject=Hello+World"));
    assert.ok(url.includes("body=two+words"));
  });

  it("URL-encodes the recipient (@ becomes %40)", () => {
    const url = buildMailtoUrl({ to: "a@b.com", subject: "s", body: "b" });
    assert.ok(url.startsWith("mailto:a%40b.com?"));
  });

  it("URL-encodes unusual characters in the recipient", () => {
    const url = buildMailtoUrl({
      to: "supplier+po123@reply.example.com",
      subject: "s",
      body: "b",
    });
    // '+' in email local part would become space if unencoded —
    // encodeURIComponent turns it into %2B. Locks the exact
    // round-trip behaviour inbound webhooks rely on.
    assert.ok(url.includes("supplier%2Bpo123%40reply.example.com"));
  });
});

describe("buildMailtoUrl — body length trimming", () => {
  it("leaves a 1800-char body untouched (boundary)", () => {
    const body = "x".repeat(1800);
    const url = buildMailtoUrl({ to: "a@b.com", subject: "s", body });
    // Parse back to verify the body wasn't truncated:
    const raw = new URL(url).searchParams.get("body");
    assert.equal(raw?.length, 1800);
    assert.ok(!raw?.endsWith("…"));
  });

  it("trims a 1801-char body to 1790 + '\\n…'", () => {
    const body = "x".repeat(1801);
    const url = buildMailtoUrl({ to: "a@b.com", subject: "s", body });
    const raw = new URL(url).searchParams.get("body");
    assert.equal(raw?.length, 1792); // 1790 + '\n' + '…'
    assert.ok(raw?.endsWith("\n…"));
    assert.equal(raw?.slice(0, 1790), "x".repeat(1790));
  });

  it("trims a very long body (50k chars) to the same 1792-char truncation", () => {
    const body = "x".repeat(50_000);
    const url = buildMailtoUrl({ to: "a@b.com", subject: "s", body });
    const raw = new URL(url).searchParams.get("body");
    assert.equal(raw?.length, 1792);
    assert.ok(raw?.endsWith("\n…"));
  });

  it("produces a URL well under 2k chars for a typical trimmed body", () => {
    // The 2k ceiling is what iOS / Gmail / Outlook enforce before
    // silently dropping Send. Verify the full URL (subject + body
    // + overhead) stays within the envelope we'd actually send.
    const body = "x".repeat(10_000);
    const url = buildMailtoUrl({
      to: "a@b.com",
      subject: "Prompt reply for PO-1234",
      body,
    });
    assert.ok(url.length < 2100, `URL too long: ${url.length}`);
  });

  it("does NOT trim the subject (subject length is caller's problem)", () => {
    // The trim rule applies only to body. A pathological subject
    // is still the caller's problem — they shouldn't generate one.
    // Lock this so a future refactor doesn't quietly add subject
    // trimming and break callers that rely on verbatim passthrough.
    const subject = "y".repeat(2500);
    const url = buildMailtoUrl({ to: "a@b.com", subject, body: "b" });
    const raw = new URL(url).searchParams.get("subject");
    assert.equal(raw?.length, 2500);
  });
});

describe("buildMailtoUrl — round-trippable via URL parser", () => {
  it("subject round-trips verbatim for plain ASCII", () => {
    const url = buildMailtoUrl({
      to: "a@b.com",
      subject: "Simple Subject",
      body: "Body",
    });
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("subject"), "Simple Subject");
  });

  it("subject round-trips with punctuation", () => {
    const url = buildMailtoUrl({
      to: "a@b.com",
      subject: "Re: your PO-1234 (urgent)",
      body: "b",
    });
    assert.equal(
      new URL(url).searchParams.get("subject"),
      "Re: your PO-1234 (urgent)"
    );
  });

  it("body round-trips with newlines", () => {
    const url = buildMailtoUrl({
      to: "a@b.com",
      subject: "s",
      body: "line 1\nline 2\nline 3",
    });
    assert.equal(
      new URL(url).searchParams.get("body"),
      "line 1\nline 2\nline 3"
    );
  });

  it("body round-trips unicode (emoji)", () => {
    const url = buildMailtoUrl({
      to: "a@b.com",
      subject: "s",
      body: "Thanks 🙏 for the quick delivery",
    });
    assert.equal(
      new URL(url).searchParams.get("body"),
      "Thanks 🙏 for the quick delivery"
    );
  });

  it("body round-trips non-Latin scripts", () => {
    const url = buildMailtoUrl({
      to: "a@b.com",
      subject: "s",
      body: "こんにちは — 日本語のメール",
    });
    assert.equal(
      new URL(url).searchParams.get("body"),
      "こんにちは — 日本語のメール"
    );
  });

  it("body round-trips ampersand (query-string delimiter) safely", () => {
    // '&' un-encoded would split into a third param; URLSearchParams
    // escapes it to %26. Lock this — if the encoding regresses, a
    // body with 'A & B' would silently truncate at the ampersand.
    const url = buildMailtoUrl({
      to: "a@b.com",
      subject: "s",
      body: "fries & shakes",
    });
    assert.equal(new URL(url).searchParams.get("body"), "fries & shakes");
    // Confirm it was actually percent-encoded in the raw URL:
    assert.ok(url.includes("%26"));
  });

  it("body round-trips quotes", () => {
    const url = buildMailtoUrl({
      to: "a@b.com",
      subject: "s",
      body: `She said "hi" and then 'bye'`,
    });
    assert.equal(
      new URL(url).searchParams.get("body"),
      `She said "hi" and then 'bye'`
    );
  });
});

describe("buildMailtoUrl — edge-case inputs", () => {
  it("handles empty subject", () => {
    const url = buildMailtoUrl({ to: "a@b.com", subject: "", body: "b" });
    assert.equal(new URL(url).searchParams.get("subject"), "");
  });

  it("handles empty body", () => {
    const url = buildMailtoUrl({ to: "a@b.com", subject: "s", body: "" });
    assert.equal(new URL(url).searchParams.get("body"), "");
  });

  it("handles empty recipient (produces 'mailto:?...' — still a valid URL the OS will just prompt on)", () => {
    const url = buildMailtoUrl({ to: "", subject: "s", body: "b" });
    // We don't block this — the OS email app will just show the
    // compose screen with no recipient. Callers are responsible for
    // ensuring `to` is present.
    assert.ok(url.startsWith("mailto:?"));
  });
});

describe("buildMailtoUrl — purity", () => {
  it("is deterministic", () => {
    const input = { to: "a@b.com", subject: "s", body: "b" };
    const a = buildMailtoUrl(input);
    const b = buildMailtoUrl(input);
    assert.equal(a, b);
  });

  it("does not mutate the input object", () => {
    const input = { to: "a@b.com", subject: "s", body: "x".repeat(5000) };
    const snapshot = JSON.stringify(input);
    buildMailtoUrl(input);
    assert.equal(JSON.stringify(input), snapshot);
  });
});
