import { SupplierOrderingMode } from "@/lib/prisma";
import { db } from "@/lib/db";

import type { AddSupplierData, WorkflowAdvanceResult, WorkflowContext } from "./types";
import { isSkip, parseNumber, parseOrderingMode } from "./parse-helpers";

type AddSupplierStep = "init" | "email" | "contact" | "lead_time";

// ── First question ────────────────────────────────────────────────────────────
export function startAddSupplier(supplierName: string): { reply: string; initialData: AddSupplierData } {
  return {
    reply: [
      `Got it, adding *${supplierName}* as a supplier! 🏪`,
      ``,
      `How do you place orders with them?`,
      `• *email* — I'll send orders via email`,
      `• *website* — you order on their website`,
      `• *manual* — you handle it yourself (phone/WhatsApp/etc.)`,
    ].join("\n"),
    initialData: { name: supplierName },
  };
}

// ── Advance one step ──────────────────────────────────────────────────────────
export async function advanceAddSupplier(
  step: AddSupplierStep,
  data: AddSupplierData,
  userMessage: string,
  context: WorkflowContext
): Promise<WorkflowAdvanceResult> {
  switch (step) {
    case "init": {
      const mode = parseOrderingMode(userMessage);
      if (!mode) {
        return {
          reply: `How do you order from *${data.name}*? Reply *email*, *website*, or *manual*.`,
          done: false,
          nextStep: "init",
          updatedData: data,
        };
      }

      if (mode === SupplierOrderingMode.EMAIL) {
        return {
          reply: `What's their email address for orders?`,
          done: false,
          nextStep: "email",
          updatedData: { ...data, orderingMode: mode },
        };
      }

      // website or manual — skip email
      return {
        reply: `Who's the contact person at *${data.name}*? (or *skip*)`,
        done: false,
        nextStep: "contact",
        updatedData: { ...data, orderingMode: mode, email: null },
      };
    }

    case "email": {
      const emailInput = userMessage.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailInput)) {
        return {
          reply: `That doesn't look like a valid email. What's *${data.name}*'s order email?`,
          done: false,
          nextStep: "email",
          updatedData: data,
        };
      }
      return {
        reply: `Who's the contact person at *${data.name}*? (or *skip*)`,
        done: false,
        nextStep: "contact",
        updatedData: { ...data, email: emailInput },
      };
    }

    case "contact": {
      const contact = isSkip(userMessage) ? null : userMessage.trim();
      return {
        reply: `How many days from order to delivery? (or *skip*)`,
        done: false,
        nextStep: "lead_time",
        updatedData: { ...data, contactName: contact },
      };
    }

    case "lead_time": {
      const days = isSkip(userMessage) ? 0 : parseNumber(userMessage) ?? 0;
      const created = await executeAddSupplier({ ...data, leadTimeDays: days }, context);
      return {
        reply: created.reply,
        done: true,
        updatedData: { ...data, leadTimeDays: days },
      };
    }
  }
}

// ── DB write ──────────────────────────────────────────────────────────────────
export async function executeAddSupplier(
  data: AddSupplierData,
  context: WorkflowContext
): Promise<{ reply: string }> {
  const name = String(data.name ?? "Supplier");
  const orderingMode = data.orderingMode ?? SupplierOrderingMode.MANUAL;
  const leadTimeDays = Number(data.leadTimeDays ?? 0);

  await db.supplier.create({
    data: {
      locationId: context.locationId,
      name,
      email: data.email ?? null,
      contactName: data.contactName ?? null,
      orderingMode,
      leadTimeDays,
      minimumOrderQuantity: 1,
    },
  });

  const modeLabel =
    orderingMode === SupplierOrderingMode.EMAIL
      ? "email orders"
      : orderingMode === SupplierOrderingMode.WEBSITE
        ? "website orders"
        : "manual orders";

  return {
    reply: [
      `✅ *${name}* added as a supplier!`,
      ``,
      `• Ordering: ${modeLabel}`,
      data.email ? `• Email: ${data.email}` : null,
      data.contactName ? `• Contact: ${data.contactName}` : null,
      leadTimeDays > 0 ? `• Lead time: ${leadTimeDays} day${leadTimeDays !== 1 ? "s" : ""}` : null,
      ``,
      `Now you can link items to *${name}* when adding inventory.`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
