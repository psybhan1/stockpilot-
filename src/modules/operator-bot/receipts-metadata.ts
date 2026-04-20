/**
 * Pure helpers for the BotMessageReceipt metadata column.
 *
 * failBotMessageReceipt merges caller-provided metadata with an
 * error field it always adds itself. The merge has two invariants
 * worth locking:
 *   1. If `extra` isn't a plain object (undefined, array, primitive)
 *      we drop it silently — better than throwing on bad input from
 *      a bot handler deep in the stack.
 *   2. `base` wins on key collisions. The caller cannot suppress
 *      the `error` field we add.
 *
 * `toReceiptMetadata` is the serialize-back-through-JSON deep clone
 * that strips non-JSON values (undefined, functions, symbols,
 * Dates — they become strings). Prisma's InputJsonValue requires a
 * plain-JSON shape and throws at runtime on non-serializable
 * values, so the clone is the backstop.
 *
 * Extracted from receipts.ts so it can be tested without loading
 * Prisma (receipts.ts imports the full PrismaClient at runtime).
 */

export function mergeReceiptMetadata(
  base: Record<string, unknown>,
  extra: unknown
): Record<string, unknown> {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) {
    return base;
  }

  return {
    ...(extra as Record<string, unknown>),
    ...base,
  };
}

export function toReceiptMetadata(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
