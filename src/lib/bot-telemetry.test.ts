import test from "node:test";
import assert from "node:assert/strict";

import { botTelemetry } from "./bot-telemetry";

// ── Test harness: capture console.log lines emitted by the logger ──

type Captured = { line: string; payload: Record<string, unknown> };

function captureLogs<T>(fn: () => T): { result: T; logs: Captured[] } {
  const logs: Captured[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
    // Logger format: "[bot] {json...}". Peel off the prefix + parse.
    const body = line.replace(/^\[bot\]\s*/, "");
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(body) as Record<string, unknown>;
    } catch {
      // Leave as empty if not JSON.
    }
    logs.push({ line, payload });
  };
  try {
    const result = fn();
    return { result, logs };
  } finally {
    console.log = original;
  }
}

// ── event() ─────────────────────────────────────────────────────────

test("event(): writes a single '[bot] {...}' line to stdout", () => {
  const { logs } = captureLogs(() => botTelemetry.event("test.smoke"));
  assert.equal(logs.length, 1);
  assert.ok(logs[0].line.startsWith("[bot] "));
});

test("event(): payload includes evt name and a numeric timestamp", () => {
  const { logs } = captureLogs(() => botTelemetry.event("test.smoke"));
  assert.equal(logs[0].payload.evt, "test.smoke");
  assert.equal(typeof logs[0].payload.ts, "number");
  // Timestamp should be within 5s of now — detects frozen-clock regressions.
  const delta = Math.abs((logs[0].payload.ts as number) - Date.now());
  assert.ok(delta < 5_000, `ts is ${delta}ms off Date.now()`);
});

test("event(): merges extra details into the payload", () => {
  const { logs } = captureLogs(() =>
    botTelemetry.event("po.approve", {
      purchaseOrderId: "po_123",
      status: "SENT",
      total: 4200,
    }),
  );
  assert.equal(logs[0].payload.purchaseOrderId, "po_123");
  assert.equal(logs[0].payload.status, "SENT");
  assert.equal(logs[0].payload.total, 4200);
});

test("event(): no details argument → just {evt, ts}", () => {
  const { logs } = captureLogs(() => botTelemetry.event("test.bare"));
  // Keys: evt, ts. Nothing else leaks in.
  const keys = Object.keys(logs[0].payload).sort();
  assert.deepEqual(keys, ["evt", "ts"]);
});

test("event(): nested objects are stringified as JSON (not [object Object])", () => {
  const { logs } = captureLogs(() =>
    botTelemetry.event("test.nested", {
      supplier: { id: "s_1", name: "Sysco" },
      counts: [1, 2, 3],
    }),
  );
  const parsed = logs[0].payload;
  assert.deepEqual(parsed.supplier, { id: "s_1", name: "Sysco" });
  assert.deepEqual(parsed.counts, [1, 2, 3]);
});

// ── start() / stop() timer ──────────────────────────────────────────

test("start(): returns a stop function that emits an event with ms on call", async () => {
  const { logs } = captureLogs(() => {
    const stop = botTelemetry.start("po.approve");
    // Nothing logged yet — start is lazy.
    stop();
    return undefined;
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].payload.evt, "po.approve");
  assert.equal(typeof logs[0].payload.ms, "number");
  assert.ok((logs[0].payload.ms as number) >= 0);
});

test("start(): does NOT log until the stop function is called", () => {
  const { logs } = captureLogs(() => {
    botTelemetry.start("po.approve"); // never invoked
  });
  assert.equal(logs.length, 0);
});

test("start(): elapsed ms reflects real wall time between start and stop", async () => {
  // Async capture — captureLogs helper is sync-only, so we inline the
  // console.log intercept here.
  const logs: Captured[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map((a) => String(a)).join(" ");
    const body = line.replace(/^\[bot\]\s*/, "");
    try {
      logs.push({ line, payload: JSON.parse(body) });
    } catch {
      logs.push({ line, payload: {} });
    }
  };
  try {
    const stop = botTelemetry.start("slow.op");
    await new Promise((r) => setTimeout(r, 25));
    stop();
  } finally {
    console.log = original;
  }
  assert.equal(logs.length, 1);
  const ms = logs[0].payload.ms as number;
  // 25ms sleep, allow wide window for CI noise.
  assert.ok(ms >= 20 && ms < 500, `expected ~25ms, got ${ms}ms`);
});

test("start(): extra details at start time are merged into the stop event", () => {
  const { logs } = captureLogs(() => {
    const stop = botTelemetry.start("po.approve", { purchaseOrderId: "po_1" });
    stop();
  });
  assert.equal(logs[0].payload.purchaseOrderId, "po_1");
});

test("start(): extra details at stop time override the start details on key collision", () => {
  // status starts as "pending", stop updates it to "SENT" — the
  // latest truth should win.
  const { logs } = captureLogs(() => {
    const stop = botTelemetry.start("po.approve", { status: "pending" });
    stop({ status: "SENT" });
  });
  assert.equal(logs[0].payload.status, "SENT");
});

test("start(): stop merges both start and stop details (union on disjoint keys)", () => {
  const { logs } = captureLogs(() => {
    const stop = botTelemetry.start("po.approve", { purchaseOrderId: "po_1" });
    stop({ status: "SENT", total: 4200 });
  });
  assert.equal(logs[0].payload.purchaseOrderId, "po_1");
  assert.equal(logs[0].payload.status, "SENT");
  assert.equal(logs[0].payload.total, 4200);
});

test("start(): calling stop twice logs twice (no debounce) — caller bug surfaces loudly", () => {
  // If a caller accidentally invokes stop twice (e.g. in try + finally),
  // we want two events in the log rather than silent swallowing.
  const { logs } = captureLogs(() => {
    const stop = botTelemetry.start("test.double");
    stop();
    stop();
  });
  assert.equal(logs.length, 2);
});

// ── error() ─────────────────────────────────────────────────────────

test("error(): emits event name with '.error' suffix", () => {
  const { logs } = captureLogs(() =>
    botTelemetry.error("po.approve", new Error("boom")),
  );
  assert.equal(logs[0].payload.evt, "po.approve.error");
});

test("error(): extracts Error.message into the 'err' field", () => {
  const { logs } = captureLogs(() =>
    botTelemetry.error("po.approve", new Error("gmail 503")),
  );
  assert.equal(logs[0].payload.err, "gmail 503");
});

test("error(): stringifies non-Error throwables (string, number, object)", () => {
  const cases: Array<[unknown, string]> = [
    ["string thrown", "string thrown"],
    [42, "42"],
    [null, "null"],
    [undefined, "undefined"],
  ];
  for (const [thrown, expected] of cases) {
    const { logs } = captureLogs(() =>
      botTelemetry.error("test.weird-throw", thrown),
    );
    assert.equal(
      logs[0].payload.err,
      expected,
      `expected ${JSON.stringify(thrown)} → ${expected}`,
    );
  }
});

test("error(): merges extra details into the payload alongside err", () => {
  const { logs } = captureLogs(() =>
    botTelemetry.error("po.approve", new Error("x"), {
      purchaseOrderId: "po_1",
    }),
  );
  assert.equal(logs[0].payload.err, "x");
  assert.equal(logs[0].payload.purchaseOrderId, "po_1");
});

// ── Structured-logging contract ─────────────────────────────────────

test("log format is exactly '[bot] <single-line JSON>' (no trailing newline in content)", () => {
  // Downstream log aggregators regex on the [bot] prefix. Any
  // deviation (e.g. switching to "[stockpilot]" or adding a colon)
  // is a backwards-incompatible change.
  const { logs } = captureLogs(() => botTelemetry.event("contract.check"));
  assert.match(logs[0].line, /^\[bot\] \{".+\}$/);
});
