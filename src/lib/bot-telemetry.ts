/**
 * Tiny structured logger for bot + PO actions.
 *
 * Emits one JSON line per event so downstream log aggregators (Railway
 * logs, Datadog, etc.) can filter/search without regex gymnastics.
 *
 * Usage:
 *   const stopTimer = botTelemetry.start("po.approve");
 *   ...
 *   stopTimer({ purchaseOrderId, status: "SENT" });
 *
 * Produces: {"evt":"po.approve","ms":142,"purchaseOrderId":"...","status":"SENT"}
 *
 * Kept deliberately simple — no transport, no persistence, just
 * structured stdout. Use in any server-side module.
 */

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue | undefined };

export type TelemetryStop = (extra?: JsonObject) => void;

export const botTelemetry = {
  event(name: string, details: JsonObject = {}) {
    const payload: JsonObject = { evt: name, ts: Date.now(), ...details };
    // Single line JSON, safe for most log aggregators.
    // eslint-disable-next-line no-console
    console.log(`[bot] ${JSON.stringify(payload)}`);
  },

  start(name: string, details: JsonObject = {}): TelemetryStop {
    const t0 = performance.now();
    return (extra?: JsonObject) => {
      const elapsed = Math.round(performance.now() - t0);
      botTelemetry.event(name, { ms: elapsed, ...details, ...(extra ?? {}) });
    };
  },

  error(name: string, err: unknown, details: JsonObject = {}) {
    const msg = err instanceof Error ? err.message : String(err);
    botTelemetry.event(`${name}.error`, { err: msg, ...details });
  },
};
