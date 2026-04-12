import { BotChannel, Prisma } from "@/lib/prisma";
import { db } from "@/lib/db";

import type { ActiveWorkflowState, WorkflowAdvanceResult, WorkflowContext, WorkflowType } from "./types";
import { advanceAddItem } from "./add-item";
import { advanceAddSupplier } from "./add-supplier";
import { advanceAddRecipe } from "./add-recipe";
import { advanceUpdateItem } from "./update-item";

// Workflows expire after 30 minutes of inactivity
const WORKFLOW_TTL_MS = 30 * 60 * 1000;

// ── Load active workflow ───────────────────────────────────────────────────────
export async function getActiveWorkflow(
  locationId: string,
  senderId: string,
  channel: BotChannel
): Promise<ActiveWorkflowState | null> {
  const state = await db.botConversationState.findUnique({
    where: {
      locationId_senderId_channel: { locationId, senderId, channel },
    },
  });

  if (!state) return null;

  // Check if expired
  if (state.expiresAt < new Date()) {
    await db.botConversationState.delete({
      where: { id: state.id },
    }).catch(() => null);
    return null;
  }

  return {
    id: state.id,
    workflow: state.workflow as WorkflowType,
    step: state.step,
    data: (state.data as Record<string, unknown>) ?? {},
    locationId: state.locationId,
    userId: state.userId,
    senderId: state.senderId,
    channel: state.channel,
  };
}

// ── Save / update workflow state ───────────────────────────────────────────────
export async function saveWorkflowState(input: {
  locationId: string;
  userId: string;
  senderId: string;
  channel: BotChannel;
  workflow: WorkflowType;
  step: string;
  data: Record<string, unknown>;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + WORKFLOW_TTL_MS);

  await db.botConversationState.upsert({
    where: {
      locationId_senderId_channel: {
        locationId: input.locationId,
        senderId: input.senderId,
        channel: input.channel,
      },
    },
    create: {
      locationId: input.locationId,
      userId: input.userId,
      senderId: input.senderId,
      channel: input.channel,
      workflow: input.workflow,
      step: input.step,
      data: input.data as Prisma.InputJsonValue,
      expiresAt,
    },
    update: {
      workflow: input.workflow,
      step: input.step,
      data: input.data as Prisma.InputJsonValue,
      expiresAt,
    },
  });
}

// ── Clear workflow state ───────────────────────────────────────────────────────
export async function clearWorkflowState(
  locationId: string,
  senderId: string,
  channel: BotChannel
): Promise<void> {
  await db.botConversationState.deleteMany({
    where: { locationId, senderId, channel },
  });
}

// ── Advance the active workflow ────────────────────────────────────────────────
export async function advanceActiveWorkflow(
  state: ActiveWorkflowState,
  userMessage: string,
  context: WorkflowContext
): Promise<WorkflowAdvanceResult> {
  const msg = userMessage.trim();

  // Allow user to cancel any workflow
  if (/^(cancel|stop|quit|nevermind|never mind|abort)$/i.test(msg)) {
    await clearWorkflowState(state.locationId, state.senderId, state.channel);
    return {
      reply: "Got it, cancelled! What else can I help with?",
      done: true,
    };
  }

  let result: WorkflowAdvanceResult;

  switch (state.workflow) {
    case "ADD_ITEM":
      result = await advanceAddItem(
        state.step as Parameters<typeof advanceAddItem>[0],
        state.data,
        msg,
        context
      );
      break;

    case "ADD_SUPPLIER":
      result = await advanceAddSupplier(
        state.step as Parameters<typeof advanceAddSupplier>[0],
        state.data,
        msg,
        context
      );
      break;

    case "ADD_RECIPE":
      result = await advanceAddRecipe(
        state.step as Parameters<typeof advanceAddRecipe>[0],
        state.data,
        msg,
        context
      );
      break;

    case "UPDATE_ITEM":
      result = await advanceUpdateItem(
        state.step as Parameters<typeof advanceUpdateItem>[0],
        state.data,
        msg,
        context
      );
      break;

    default:
      await clearWorkflowState(state.locationId, state.senderId, state.channel);
      return {
        reply: "Something went wrong with this workflow. Starting fresh — what do you need?",
        done: true,
      };
  }

  if (result.done) {
    await clearWorkflowState(state.locationId, state.senderId, state.channel);
  } else if (result.nextStep) {
    await saveWorkflowState({
      locationId: state.locationId,
      userId: state.userId,
      senderId: state.senderId,
      channel: state.channel,
      workflow: state.workflow,
      step: result.nextStep,
      data: result.updatedData ?? state.data,
    });
  }

  return result;
}
