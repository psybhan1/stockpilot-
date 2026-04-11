import { NextResponse } from "next/server";

import { getAiProvider } from "@/providers/ai-provider";
import { getAssistantSummary } from "@/modules/dashboard/queries";
import { requireSession } from "@/modules/auth/session";

export async function POST(request: Request) {
  const session = await requireSession();
  const body = (await request.json()) as { question?: string };

  const summary = await getAssistantSummary(session.locationId);
  const ai = getAiProvider();
  const answer = await ai.answerOpsQuery({
    question: body.question ?? "",
    summary,
  });

  return NextResponse.json(answer);
}
