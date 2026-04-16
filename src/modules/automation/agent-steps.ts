/**
 * Progress-recorder helpers for the browser ordering agent.
 *
 * The browser agent runs as a long-ish task (launch Chrome, log in,
 * search, add to cart, screenshot cart — 20-60 seconds). The
 * /agent-tasks/[id] live view polls the AgentTaskStep table so
 * managers can watch each milestone land in real time instead of
 * waiting for the final Telegram summary.
 *
 * Two primitives:
 *   - recordAgentStep(): synchronous atomic row — "launched Chrome",
 *     "dismissed age gate", "added cart item N". No screenshot.
 *   - startAgentStep() / finishAgentStep(): bracket pattern for steps
 *     that take time. startedAt is written up front so the UI shows
 *     "running..." while the work happens; finishAgentStep flips the
 *     status + endedAt and optionally attaches the screenshot taken
 *     during the step.
 *
 * All writes are fire-and-forget — if the DB is slow we never want
 * to block the browser agent's actual work. Errors are logged but
 * swallowed.
 */

import { db } from "@/lib/db";

export type AgentStepStatus = "running" | "ok" | "failed";

type StepRef = {
  id: string;
  agentTaskId: string;
  sequence: number;
};

/**
 * Get the next sequence number for this task's steps. Monotonic per
 * task, gapless enough for UI purposes. Not atomic — but the agent
 * is single-writer per task so races aren't possible.
 */
async function nextSequence(agentTaskId: string): Promise<number> {
  const last = await db.agentTaskStep.findFirst({
    where: { agentTaskId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  return (last?.sequence ?? 0) + 1;
}

/**
 * Record a completed milestone (no screenshot). Use for quick
 * instantaneous events like "Chrome launched", "cookie injected",
 * "age gate dismissed".
 */
/**
 * Prisma's Bytes field types as Uint8Array<ArrayBuffer>, not Node's
 * Buffer (whose `buffer` is ArrayBufferLike — could be SharedArrayBuffer).
 * Copy into a fresh ArrayBuffer-backed Uint8Array so the types line
 * up at the Prisma boundary. One allocation per screenshot
 * (~200KB), negligible.
 */
function toPrismaBytes(
  buf: Buffer | Uint8Array | null | undefined
): Uint8Array<ArrayBuffer> | null {
  if (!buf) return null;
  const copy = new Uint8Array(new ArrayBuffer(buf.byteLength));
  copy.set(buf);
  return copy as Uint8Array<ArrayBuffer>;
}

export async function recordAgentStep(
  agentTaskId: string,
  input: {
    name: string;
    status: AgentStepStatus;
    notes?: string;
    screenshot?: Buffer | null;
  }
): Promise<void> {
  try {
    const sequence = await nextSequence(agentTaskId);
    const now = new Date();
    await db.agentTaskStep.create({
      data: {
        agentTaskId,
        sequence,
        name: input.name,
        status: input.status,
        notes: input.notes ?? null,
        screenshot: toPrismaBytes(input.screenshot),
        startedAt: now,
        endedAt: now,
      },
    });
  } catch (err) {
    console.warn(
      "[agent-steps] recordAgentStep failed:",
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Bracket pattern: start a step, do the work, then finish it. Shows
 * up as "running..." in the live view between the two calls.
 */
export async function startAgentStep(
  agentTaskId: string,
  name: string,
  notes?: string
): Promise<StepRef | null> {
  try {
    const sequence = await nextSequence(agentTaskId);
    const row = await db.agentTaskStep.create({
      data: {
        agentTaskId,
        sequence,
        name,
        status: "running",
        notes: notes ?? null,
        startedAt: new Date(),
      },
      select: { id: true, agentTaskId: true, sequence: true },
    });
    return row;
  } catch (err) {
    console.warn(
      "[agent-steps] startAgentStep failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function finishAgentStep(
  ref: StepRef | null,
  input: {
    status: Exclude<AgentStepStatus, "running">;
    notes?: string;
    screenshot?: Buffer | null;
  }
): Promise<void> {
  if (!ref) return;
  try {
    await db.agentTaskStep.update({
      where: { id: ref.id },
      data: {
        status: input.status,
        endedAt: new Date(),
        ...(input.notes ? { notes: input.notes } : {}),
        ...(input.screenshot ? { screenshot: toPrismaBytes(input.screenshot) } : {}),
      },
    });
  } catch (err) {
    console.warn(
      "[agent-steps] finishAgentStep failed:",
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Read-side query used by the live view page. Returns lean metadata
 * only — screenshot bytes are NOT included in this response (they
 * load separately via the screenshot-serving API route), keeping
 * the poll response small and fast.
 */
export async function listAgentSteps(agentTaskId: string) {
  return db.agentTaskStep.findMany({
    where: { agentTaskId },
    select: {
      id: true,
      sequence: true,
      name: true,
      status: true,
      notes: true,
      startedAt: true,
      endedAt: true,
      // `screenshot` omitted — hits the separate streaming endpoint.
    },
    orderBy: { sequence: "asc" },
  });
}

/**
 * Pretty a step name for human display. The recorder accepts
 * internal identifiers like "search-espresso machine cleaner"
 * or "product-direct-urnex-cafiza" — UI wants "Searching:
 * Espresso machine cleaner" or "Loading product: urnex cafiza".
 *
 * Matching is greedy-longest-prefix: we try multi-word keys like
 * "product-direct" and "login-no-email-field" before single-word
 * ones like "product" or "login". Whatever prefix matches, the
 * remaining text is passed as `suffix` to the label-builder.
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
