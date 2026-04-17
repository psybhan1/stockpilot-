/**
 * Simple in-memory sliding-window rate limiter. Per-key (usually a
 * Telegram chat_id or an IP), with configurable window + max requests.
 *
 * This is enough for Railway's single-instance deploy. If/when we
 * scale horizontally, swap the store for Redis — the consumer API
 * doesn't have to change.
 *
 * Not strictly accurate under thread-pressure (two concurrent calls
 * could both read the same timestamps array), but Node's single-
 * threaded event loop means each await-free stretch is atomic, which
 * is sufficient for the "stop the flood" use case.
 */

type Window = {
  timestamps: number[];
};

const WINDOWS = new Map<string, Window>();

// Keep the Map from growing unboundedly under a sustained flood:
// every few thousand requests, drop keys whose newest entry is old.
let requestsSinceGc = 0;
function maybeGc(now: number, maxAgeMs: number) {
  requestsSinceGc += 1;
  if (requestsSinceGc < 2000) return;
  requestsSinceGc = 0;
  for (const [key, win] of WINDOWS.entries()) {
    const newest = win.timestamps[win.timestamps.length - 1] ?? 0;
    if (now - newest > maxAgeMs) WINDOWS.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the next request would be allowed. */
  retryAfterSec: number;
  /** Current count within the window. */
  count: number;
};

export function rateLimit(opts: {
  key: string;
  windowMs: number;
  max: number;
}): RateLimitResult {
  const now = Date.now();
  const { key, windowMs, max } = opts;

  const win = WINDOWS.get(key) ?? { timestamps: [] };
  // Drop entries older than the window.
  win.timestamps = win.timestamps.filter((t) => now - t < windowMs);

  if (win.timestamps.length >= max) {
    const oldest = win.timestamps[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    WINDOWS.set(key, win);
    return { allowed: false, retryAfterSec, count: win.timestamps.length };
  }

  win.timestamps.push(now);
  WINDOWS.set(key, win);
  maybeGc(now, windowMs);
  return { allowed: true, retryAfterSec: 0, count: win.timestamps.length };
}

/** Test helper — clears all state. Not exported to app code. */
export function _resetRateLimitForTests(): void {
  WINDOWS.clear();
  requestsSinceGc = 0;
}
