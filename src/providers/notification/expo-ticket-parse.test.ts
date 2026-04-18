import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readExpoTicketError, readExpoTicketId } from "./expo-ticket-parse";

describe("readExpoTicketId — successful responses", () => {
  it("extracts the ticket id from a standard success payload", () => {
    const payload = {
      data: [{ status: "ok", id: "AAAA-BBBB-CCCC-DDDD" }],
    };
    assert.equal(readExpoTicketId(payload), "AAAA-BBBB-CCCC-DDDD");
  });

  it("extracts the id even when status is missing (some gateways omit it)", () => {
    const payload = { data: [{ id: "ticket-xyz" }] };
    assert.equal(readExpoTicketId(payload), "ticket-xyz");
  });

  it("reads only the FIRST entry when multiple are present", () => {
    const payload = {
      data: [
        { status: "ok", id: "first" },
        { status: "ok", id: "second" },
      ],
    };
    assert.equal(readExpoTicketId(payload), "first");
  });

  it("tolerates extra fields in the entry object", () => {
    const payload = {
      data: [
        {
          status: "ok",
          id: "the-id",
          extra: "ignored",
          receiptId: "r123",
        },
      ],
    };
    assert.equal(readExpoTicketId(payload), "the-id");
  });
});

describe("readExpoTicketId — malformed / missing payloads", () => {
  it("returns undefined when data is missing entirely", () => {
    assert.equal(readExpoTicketId({}), undefined);
  });

  it("returns undefined when data is an object (not array)", () => {
    // Older Expo responses sometimes returned `data: {...}` as a
    // single object. We explicitly treat that as "no ticket" rather
    // than blow up trying to index into it.
    const payload = { data: { status: "ok", id: "lonely" } };
    assert.equal(readExpoTicketId(payload), undefined);
  });

  it("returns undefined when data is an empty array", () => {
    assert.equal(readExpoTicketId({ data: [] }), undefined);
  });

  it("returns undefined when data[0] is null", () => {
    assert.equal(readExpoTicketId({ data: [null] }), undefined);
  });

  it("returns undefined when data[0] is a nested array (not object)", () => {
    assert.equal(readExpoTicketId({ data: [["weird"]] }), undefined);
  });

  it("returns undefined when data[0] is a string", () => {
    assert.equal(readExpoTicketId({ data: ["weird"] }), undefined);
  });

  it("returns undefined when data[0] has no id field", () => {
    assert.equal(readExpoTicketId({ data: [{ status: "ok" }] }), undefined);
  });

  it("returns the id raw even if it's not a string (type cast — caller's problem)", () => {
    // The cast is `as string | undefined` — we don't validate the
    // runtime type. Lock the current behaviour so a silent cast
    // change gets noticed.
    const payload = { data: [{ id: 12345 }] };
    // Runtime value is a number; the function returns it unchanged.
    assert.equal(readExpoTicketId(payload) as unknown, 12345);
  });

  it("doesn't throw on deeply weird input", () => {
    assert.doesNotThrow(() =>
      readExpoTicketId({ data: [{ id: { nested: true } }] })
    );
  });
});

describe("readExpoTicketError — error responses", () => {
  it("extracts the message from a clean error response", () => {
    const payload = {
      data: [
        {
          status: "error",
          message: "Invalid token",
          details: { error: "DeviceNotRegistered" },
        },
      ],
    };
    // Combined: "Invalid token (DeviceNotRegistered)"
    assert.equal(
      readExpoTicketError(payload),
      "Invalid token (DeviceNotRegistered)"
    );
  });

  it("returns message alone when details.error is absent", () => {
    const payload = {
      data: [{ status: "error", message: "Rate limited" }],
    };
    assert.equal(readExpoTicketError(payload), "Rate limited");
  });

  it("returns details.error when message is missing", () => {
    const payload = {
      data: [{ status: "error", details: { error: "DeviceNotRegistered" } }],
    };
    assert.equal(readExpoTicketError(payload), "DeviceNotRegistered");
  });

  it("returns details.error when message is empty string", () => {
    const payload = {
      data: [
        {
          status: "error",
          message: "",
          details: { error: "MessageTooBig" },
        },
      ],
    };
    assert.equal(readExpoTicketError(payload), "MessageTooBig");
  });

  it("returns details.error when message is whitespace-only", () => {
    const payload = {
      data: [
        {
          status: "error",
          message: "   \n  ",
          details: { error: "InvalidCredentials" },
        },
      ],
    };
    assert.equal(readExpoTicketError(payload), "InvalidCredentials");
  });

  it("returns the fallback string when neither message nor details.error exists", () => {
    const payload = {
      data: [{ status: "error" }],
    };
    assert.equal(readExpoTicketError(payload), "Expo push delivery failed.");
  });

  it("returns the fallback when details is a non-object", () => {
    const payload = {
      data: [{ status: "error", details: "oops" }],
    };
    assert.equal(readExpoTicketError(payload), "Expo push delivery failed.");
  });

  it("returns the fallback when details is an array (not object)", () => {
    const payload = {
      data: [{ status: "error", details: [{ error: "nope" }] }],
    };
    assert.equal(readExpoTicketError(payload), "Expo push delivery failed.");
  });

  it("returns the fallback when details.error is not a string", () => {
    const payload = {
      data: [{ status: "error", details: { error: 42 } }],
    };
    // message missing, details.error not a string → fallback
    assert.equal(readExpoTicketError(payload), "Expo push delivery failed.");
  });

  it("handles really long error messages without truncating", () => {
    const bigMsg = "x".repeat(5000);
    const payload = {
      data: [{ status: "error", message: bigMsg }],
    };
    assert.equal(readExpoTicketError(payload), bigMsg);
  });
});

describe("readExpoTicketError — non-error responses", () => {
  it("returns null for status: 'ok'", () => {
    const payload = { data: [{ status: "ok", id: "abc" }] };
    assert.equal(readExpoTicketError(payload), null);
  });

  it("returns null when status field is missing (treat as not-an-error)", () => {
    const payload = { data: [{ id: "abc" }] };
    assert.equal(readExpoTicketError(payload), null);
  });

  it("returns null when status is some other string", () => {
    const payload = { data: [{ status: "queued" }] };
    assert.equal(readExpoTicketError(payload), null);
  });
});

describe("readExpoTicketError — malformed / missing payloads", () => {
  it("returns null when data is missing entirely", () => {
    assert.equal(readExpoTicketError({}), null);
  });

  it("returns null when data is an object (not array)", () => {
    assert.equal(
      readExpoTicketError({ data: { status: "error" } }),
      null
    );
  });

  it("returns null when data is an empty array", () => {
    assert.equal(readExpoTicketError({ data: [] }), null);
  });

  it("returns null when data[0] is null", () => {
    assert.equal(readExpoTicketError({ data: [null] }), null);
  });

  it("returns null when data[0] is a string", () => {
    assert.equal(readExpoTicketError({ data: ["oops"] }), null);
  });

  it("returns null when data[0] is a nested array", () => {
    assert.equal(readExpoTicketError({ data: [["a", "b"]] }), null);
  });

  it("doesn't throw on deeply weird input", () => {
    assert.doesNotThrow(() =>
      readExpoTicketError({
        data: [{ status: "error", details: { error: { nested: true } } }],
      })
    );
  });
});

describe("readExpoTicketError — purity", () => {
  it("is deterministic (same input → same output)", () => {
    const payload = {
      data: [
        {
          status: "error",
          message: "Invalid token",
          details: { error: "DeviceNotRegistered" },
        },
      ],
    };
    const a = readExpoTicketError(payload);
    const b = readExpoTicketError(payload);
    assert.equal(a, b);
  });

  it("doesn't mutate the input payload", () => {
    const payload = {
      data: [
        {
          status: "error",
          message: "x",
          details: { error: "y" },
        },
      ],
    };
    const snapshot = JSON.stringify(payload);
    readExpoTicketError(payload);
    assert.equal(JSON.stringify(payload), snapshot);
  });
});

describe("readExpoTicketId — purity", () => {
  it("doesn't mutate the input payload", () => {
    const payload = { data: [{ status: "ok", id: "abc" }] };
    const snapshot = JSON.stringify(payload);
    readExpoTicketId(payload);
    assert.equal(JSON.stringify(payload), snapshot);
  });
});
