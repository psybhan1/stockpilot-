/**
 * GET /api/agent-tasks/[taskId]/steps/[stepId]/screenshot
 *
 * Serves the raw JPEG bytes stored on AgentTaskStep.screenshot. The
 * live-view page embeds these as <img src> so the browser can lazy-
 * load them without re-rendering the full page.
 *
 * Authorization: the step must belong to an AgentTask at the caller's
 * active location. We enforce this so a shared task URL (which includes
 * the taskId in the path) can't be used to scrape other tenants'
 * browser-agent screenshots — they could contain supplier auth cookies
 * or pricing data.
 */

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string; stepId: string }> }
) {
  const { taskId, stepId } = await params;
  const session = await requireSession(Role.STAFF);

  const step = await db.agentTaskStep.findFirst({
    where: {
      id: stepId,
      agentTaskId: taskId,
      agentTask: { locationId: session.locationId },
    },
    select: { screenshot: true },
  });

  if (!step?.screenshot) {
    return NextResponse.json(
      { message: "Screenshot not found" },
      { status: 404 }
    );
  }

  // step.screenshot is Uint8Array from Prisma; Next supports Buffer
  // bodies directly, but Uint8Array works too and avoids a copy.
  return new Response(Buffer.from(step.screenshot), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
