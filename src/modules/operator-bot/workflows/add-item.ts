import { BaseUnit, InventoryCategory, MeasurementUnit } from "@/lib/prisma";
import { db } from "@/lib/db";

import type { AddItemData, WorkflowAdvanceResult, WorkflowContext } from "./types";
import {
  baseUnitLabel,
  categoryLabel,
  fuzzyMatchSupplier,
  generateSku,
  isSkip,
  measurementUnitFromBaseUnit,
  parseBaseUnit,
  parseCategory,
  parseNumber,
  parsePackSize,
} from "./parse-helpers";

// ── Step names ────────────────────────────────────────────────────────────────
const STEPS = ["init", "base_unit", "par_level", "pack_size", "supplier"] as const;
type AddItemStep = (typeof STEPS)[number];

// ── First question (called when intent ADD_INVENTORY_ITEM is detected) ────────
export function startAddItem(itemName: string): { reply: string; initialData: AddItemData } {
  // Auto-detect category from the item name — skip the question if we can
  const autoCategory = parseCategory(itemName);

  if (autoCategory) {
    return {
      reply: [
        `Got it, adding *${itemName}* to your inventory! 🛒`,
        ``,
        `How do you measure *${itemName}* in your kitchen?`,
        `• grams`,
        `• ml / liters`,
        `• count / units (each)`,
      ].join("\n"),
      initialData: { name: itemName, category: autoCategory, _categoryResolved: true },
    };
  }

  return {
    reply: [
      `Got it, adding *${itemName}* to your inventory! 🛒`,
      ``,
      `What category is it?`,
      `• coffee`,
      `• dairy`,
      `• alt dairy / plant-based`,
      `• syrup / sauce`,
      `• bakery / ingredient`,
      `• produce / fresh`,
      `• packaging`,
      `• cleaning`,
      `• other`,
    ].join("\n"),
    initialData: { name: itemName },
  };
}

// ── Advance the workflow one step ─────────────────────────────────────────────
export async function advanceAddItem(
  step: AddItemStep,
  data: AddItemData,
  userMessage: string,
  context: WorkflowContext
): Promise<WorkflowAdvanceResult> {
  switch (step) {
    case "init": {
      // If category was already auto-resolved from the item name, the user's
      // reply here is actually their base_unit answer — forward it directly.
      if (data._categoryResolved) {
        const baseUnit = parseBaseUnit(userMessage);
        if (!baseUnit) {
          return {
            reply: `How is *${data.name}* measured? Reply with *grams*, *ml*, or *count*.`,
            done: false,
            nextStep: "init",
            updatedData: data,
          };
        }
        return {
          reply: `What's your par level for *${data.name}*?\nThat's how many ${baseUnitLabel(baseUnit)} you always want in stock.`,
          done: false,
          nextStep: "par_level",
          updatedData: { ...data, baseUnit },
        };
      }

      // If the user is giving up / asking the bot to decide, auto-pick a
      // reasonable default category instead of looping on the same question.
      const wantsAutoPick = /\b(figure (it )?out|you (pick|decide|choose|guess)|your choice|whatever|any|auto|dunno|i don'?t know|idk|up to you)\b/i.test(
        userMessage
      );

      let category = parseCategory(userMessage);
      if (!category && wantsAutoPick) {
        // Use the item name itself as a fallback guess; if that still fails,
        // default to SUPPLY so the flow can continue.
        category = parseCategory(data.name ?? "") ?? InventoryCategory.SUPPLY;
      }

      if (!category) {
        return {
          reply: `I didn't catch that. What category is *${data.name}*? Reply with the category (dairy, coffee, syrup, produce, packaging, cleaning, other) — or say *figure it out* and I'll pick for you.`,
          done: false,
          nextStep: "init",
          updatedData: data,
        };
      }
      return {
        reply: `How do you measure *${data.name}* in your kitchen?\n\n• grams\n• ml / liters\n• count / units (each)`,
        done: false,
        nextStep: "base_unit",
        updatedData: { ...data, category },
      };
    }

    case "base_unit": {
      const baseUnit = parseBaseUnit(userMessage);
      if (!baseUnit) {
        return {
          reply: `How is *${data.name}* measured? Reply with *grams*, *ml*, or *count*.`,
          done: false,
          nextStep: "base_unit",
          updatedData: data,
        };
      }
      return {
        reply: `What's your par level for *${data.name}*?\nThat's how many ${baseUnitLabel(baseUnit)} you always want in stock.`,
        done: false,
        nextStep: "par_level",
        updatedData: { ...data, baseUnit },
      };
    }

    case "par_level": {
      const par = parseNumber(userMessage);
      if (!par || par <= 0) {
        return {
          reply: `Please give me a number for the par level of *${data.name}*. (e.g. 50)`,
          done: false,
          nextStep: "par_level",
          updatedData: data,
        };
      }
      return {
        reply: [
          `How do you order *${data.name}* from your supplier?`,
          ``,
          `Give me the pack size, e.g.:`,
          `• "1L bottles"`,
          `• "500g bags"`,
          `• "individual units"`,
          `• "cases of 12"`,
        ].join("\n"),
        done: false,
        nextStep: "pack_size",
        updatedData: { ...data, parLevelBase: par },
      };
    }

    case "pack_size": {
      const baseUnit = (data.baseUnit as BaseUnit) ?? BaseUnit.COUNT;
      const { packSizeBase, purchaseUnit } = parsePackSize(userMessage, baseUnit);
      const supplierList =
        context.suppliers.length > 0
          ? `\n\nYour current suppliers:\n${context.suppliers.map((s) => `• ${s.name}`).join("\n")}`
          : "";
      return {
        reply: `Who's the supplier for *${data.name}*?${supplierList}\n\n(Type the supplier name, or *none* to skip)`,
        done: false,
        nextStep: "supplier",
        updatedData: { ...data, packSizeBase, purchaseUnit },
      };
    }

    case "supplier": {
      let primarySupplierId: string | null = null;
      if (!isSkip(userMessage)) {
        const match = fuzzyMatchSupplier(userMessage, context.suppliers);
        if (!match) {
          return {
            reply: `I don't have *${userMessage.trim()}* in your suppliers yet.\nType *none* to save *${data.name}* without a supplier, or say *add supplier ${userMessage.trim()}* after this to set them up.`,
            done: false,
            nextStep: "supplier",
            updatedData: data,
          };
        }
        primarySupplierId = match.id;
      }

      // Create the item
      const created = await executeAddItem({ ...data, primarySupplierId }, context);
      return {
        reply: created.reply,
        done: true,
        updatedData: { ...data, primarySupplierId },
      };
    }
  }
}

// ── DB write ──────────────────────────────────────────────────────────────────
export async function executeAddItem(
  data: AddItemData,
  context: WorkflowContext
): Promise<{ reply: string }> {
  const name = String(data.name ?? "Unknown item");
  const category = (data.category as InventoryCategory) ?? InventoryCategory.SUPPLY;
  const baseUnit = (data.baseUnit as BaseUnit) ?? BaseUnit.COUNT;
  const parLevelBase = Number(data.parLevelBase ?? 10);
  const packSizeBase = Number(data.packSizeBase ?? 1);
  const purchaseUnit =
    (data.purchaseUnit as MeasurementUnit) ?? measurementUnitFromBaseUnit(baseUnit);
  const lowStockThresholdBase = Math.max(1, Math.floor(parLevelBase * 0.3));
  const safetyStockBase = Math.max(1, Math.floor(parLevelBase * 0.15));
  const derivedUnit = measurementUnitFromBaseUnit(baseUnit);

  const sku = generateSku(name);

  const item = await db.inventoryItem.create({
    data: {
      locationId: context.locationId,
      name,
      sku,
      category,
      baseUnit,
      countUnit: derivedUnit,
      displayUnit: derivedUnit,
      purchaseUnit,
      parLevelBase,
      lowStockThresholdBase,
      safetyStockBase,
      stockOnHandBase: 0,
      packSizeBase,
      minimumOrderQuantity: 1,
      leadTimeDays: 0,
      primarySupplierId: data.primarySupplierId ?? null,
      confidenceScore: 0.9,
    },
    select: { id: true, name: true },
  });

  // Link to supplier if provided
  if (data.primarySupplierId) {
    await db.supplierItem.upsert({
      where: {
        supplierId_inventoryItemId: {
          supplierId: data.primarySupplierId,
          inventoryItemId: item.id,
        },
      },
      create: {
        supplierId: data.primarySupplierId,
        inventoryItemId: item.id,
        packSizeBase,
        minimumOrderQuantity: 1,
        preferred: true,
      },
      update: {},
    });
  }

  const catLabel = categoryLabel(category);
  const unitLabel = baseUnitLabel(baseUnit);
  const supplierLine = data.primarySupplierId
    ? `\n• Supplier linked ✓`
    : "";

  return {
    reply: [
      `✅ *${name}* added to your inventory!`,
      ``,
      `• Category: ${catLabel}`,
      `• Unit: ${unitLabel}`,
      `• Par level: ${parLevelBase} ${unitLabel}`,
      `• Pack size: ${packSizeBase} ${purchaseUnit.toLowerCase()}`,
      `• Low stock alert at: ${lowStockThresholdBase} ${unitLabel}${supplierLine}`,
      ``,
      `Want to link *${name}* to a recipe? Say something like: "*banana smoothie uses 2 bananas*"`,
    ].join("\n"),
  };
}
