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

export { humaniseStepName } from "./step-labels";

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

// humaniseStepName lives in ./step-labels for isolated unit testing —
// re-exported at the top of this file.
