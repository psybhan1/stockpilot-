import { BaseUnit, InventoryCategory } from "@/lib/prisma";
import { db } from "@/lib/db";

import type { UpdateItemData, WorkflowAdvanceResult, WorkflowContext } from "./types";
import {
  baseUnitLabel,
  fuzzyMatchSupplier,
  isSkip,
  parseBaseUnit,
  parseCategory,
  categoryLabel,
  parseNumber,
} from "./parse-helpers";

type UpdateItemStep = "init" | "value";

const UPDATABLE_FIELDS = ["par level", "low stock threshold", "category", "supplier", "notes", "safety stock"] as const;
type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

function parseField(text: string): UpdatableField | null {
  const lower = text.toLowerCase();
  if (/par\s*level|par/i.test(lower)) return "par level";
  if (/low\s*stock|threshold|alert/i.test(lower)) return "low stock threshold";
  if (/safety\s*stock|safety/i.test(lower)) return "safety stock";
  if (/categor/i.test(lower)) return "category";
  if (/supplier/i.test(lower)) return "supplier";
  if (/note|comment/i.test(lower)) return "notes";
  return null;
}

// ── First question ────────────────────────────────────────────────────────────
export function startUpdateItem(
  inventoryItemId: string,
  inventoryItemName: string
): { reply: string; initialData: UpdateItemData } {
  return {
    reply: [
      `What do you want to change about *${inventoryItemName}*?`,
      ``,
      `• par level`,
      `• low stock threshold`,
      `• category`,
      `• supplier`,
      `• notes`,
    ].join("\n"),
    initialData: { inventoryItemId, inventoryItemName },
  };
}

// ── Advance one step ──────────────────────────────────────────────────────────
export async function advanceUpdateItem(
  step: UpdateItemStep,
  data: UpdateItemData,
  userMessage: string,
  context: WorkflowContext
): Promise<WorkflowAdvanceResult> {
  switch (step) {
    case "init": {
      const field = parseField(userMessage);
      if (!field) {
        return {
          reply: `What do you want to change about *${data.inventoryItemName}*? (par level / category / supplier / notes)`,
          done: false,
          nextStep: "init",
          updatedData: data,
        };
      }

      const prompts: Record<UpdatableField, string> = {
        "par level": `What's the new par level for *${data.inventoryItemName}*? (number)`,
        "low stock threshold": `What's the new low stock threshold for *${data.inventoryItemName}*? (number)`,
        "safety stock": `What's the new safety stock for *${data.inventoryItemName}*? (number)`,
        "category": `What category should *${data.inventoryItemName}* be in? (coffee / dairy / produce / syrup / packaging / cleaning / other)`,
        "supplier": [
          `Which supplier should be linked to *${data.inventoryItemName}*?`,
          context.suppliers.length > 0
            ? `\nYour suppliers:\n${context.suppliers.map((s) => `• ${s.name}`).join("\n")}`
            : "",
          `\n(or *none* to remove supplier)`,
        ]
          .filter(Boolean)
          .join(""),
        "notes": `What notes do you want to set for *${data.inventoryItemName}*?`,
      };

      return {
        reply: prompts[field],
        done: false,
        nextStep: "value",
        updatedData: { ...data, field },
      };
    }

    case "value": {
      const field = data.field as UpdatableField;
      const result = await applyUpdate(field, data, userMessage, context);
      return {
        reply: result.reply,
        done: true,
        updatedData: data,
      };
    }
  }
}

async function applyUpdate(
  field: UpdatableField,
  data: UpdateItemData,
  userMessage: string,
  context: WorkflowContext
): Promise<{ reply: string }> {
  const itemId = data.inventoryItemId!;
  const itemName = data.inventoryItemName!;

  switch (field) {
    case "par level": {
      const val = parseNumber(userMessage);
      if (!val || val <= 0) return { reply: `That doesn't look like a valid number. Par level unchanged.` };
      const newLow = Math.max(1, Math.floor(val * 0.3));
      await db.inventoryItem.update({
        where: { id: itemId },
        data: { parLevelBase: val, lowStockThresholdBase: newLow },
      });
      return { reply: `✅ *${itemName}* par level updated to ${val}. Low stock threshold auto-set to ${newLow}.` };
    }

    case "low stock threshold": {
      const val = parseNumber(userMessage);
      if (!val || val <= 0) return { reply: `That doesn't look like a valid number. Threshold unchanged.` };
      await db.inventoryItem.update({ where: { id: itemId }, data: { lowStockThresholdBase: val } });
      return { reply: `✅ *${itemName}* low stock threshold updated to ${val}.` };
    }

    case "safety stock": {
      const val = parseNumber(userMessage);
      if (!val || val <= 0) return { reply: `That doesn't look like a valid number. Safety stock unchanged.` };
      await db.inventoryItem.update({ where: { id: itemId }, data: { safetyStockBase: val } });
      return { reply: `✅ *${itemName}* safety stock updated to ${val}.` };
    }

    case "category": {
      const cat = parseCategory(userMessage);
      if (!cat) return { reply: `Couldn't match that category. Try: coffee, dairy, produce, syrup, packaging, cleaning.` };
      await db.inventoryItem.update({ where: { id: itemId }, data: { category: cat } });
      return { reply: `✅ *${itemName}* category updated to ${categoryLabel(cat)}.` };
    }

    case "supplier": {
      if (isSkip(userMessage) || /none|remove/i.test(userMessage)) {
        await db.inventoryItem.update({ where: { id: itemId }, data: { primarySupplierId: null } });
        return { reply: `✅ Supplier removed from *${itemName}*.` };
      }
      const match = fuzzyMatchSupplier(userMessage, context.suppliers);
      if (!match) {
        return {
          reply: `Couldn't find *${userMessage.trim()}* in your suppliers. Add them first with "add supplier ${userMessage.trim()}".`,
        };
      }
      await db.inventoryItem.update({ where: { id: itemId }, data: { primarySupplierId: match.id } });
      // Also create SupplierItem link if not present
      const item = await db.inventoryItem.findUnique({ where: { id: itemId }, select: { packSizeBase: true } });
      await db.supplierItem.upsert({
        where: { supplierId_inventoryItemId: { supplierId: match.id, inventoryItemId: itemId } },
        create: { supplierId: match.id, inventoryItemId: itemId, packSizeBase: item?.packSizeBase ?? 1, minimumOrderQuantity: 1, preferred: true },
        update: {},
      });
      return { reply: `✅ *${itemName}* supplier updated to *${match.name}*.` };
    }

    case "notes": {
      const notes = userMessage.trim();
      await db.inventoryItem.update({ where: { id: itemId }, data: { notes } });
      return { reply: `✅ Notes updated for *${itemName}*.` };
    }
  }
}
