import { BaseUnit, InventoryCategory, MeasurementUnit } from "@/lib/prisma";
import { db } from "@/lib/db";
import { buildInventoryImageUrl } from "@/modules/inventory/image-resolver";

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
  suggestItemDefaults,
} from "./parse-helpers";

// ── Step names ────────────────────────────────────────────────────────────────
// Flow: init → brand → usage → storage → base_unit (smart-skip) → par_level →
//       pack_size → supplier
const STEPS = [
  "init",
  "brand",
  "usage",
  "storage",
  "base_unit",
  "par_level",
  "pack_size",
  "supplier",
] as const;
type AddItemStep = (typeof STEPS)[number];

// ── Utility: normalise "skip" / "no" / empty replies for optional fields ─────
function optionalText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (isSkip(trimmed)) return null;
  // Keep it short — this goes in notes.
  return trimmed.slice(0, 120);
}

// ── First question (called when intent ADD_INVENTORY_ITEM is detected) ────────
export function startAddItem(itemName: string): { reply: string; initialData: AddItemData } {
  // Auto-detect category from the item name — skip the category question if we can
  const autoCategory = parseCategory(itemName);

  if (autoCategory) {
    return {
      reply: [
        `Got it — adding *${itemName}* to your inventory. 🛒`,
        ``,
        `What brand is it? (e.g. "Monin", "Oatly", or say *skip* if it doesn't matter)`,
      ].join("\n"),
      initialData: { name: itemName, category: autoCategory, _categoryResolved: true },
    };
  }

  return {
    reply: [
      `Got it — adding *${itemName}* to your inventory. 🛒`,
      ``,
      `What kind of thing is it? e.g. coffee, dairy, syrup, produce, packaging, cleaning. Or just describe it and I'll figure it out.`,
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
      // If category was auto-resolved from the item name, the user's reply here
      // is actually their *brand* answer — forward into the brand step.
      if (data._categoryResolved) {
        const brand = optionalText(userMessage);
        return {
          reply: `What do you use *${data.name}* for? (e.g. "lattes and mochas", "smoothies", "pastries")`,
          done: false,
          nextStep: "usage",
          updatedData: { ...data, brand },
        };
      }

      const wantsAutoPick = /\b(figure (it )?out|you (pick|decide|choose|guess)|your choice|whatever|any|auto|dunno|i don'?t know|idk|up to you)\b/i.test(
        userMessage
      );

      let category = parseCategory(userMessage);
      if (!category && wantsAutoPick) {
        category = parseCategory(data.name ?? "") ?? InventoryCategory.SUPPLY;
      }

      if (!category) {
        return {
          reply: `I didn't catch that. What kind of item is *${data.name}*? Any of: dairy, coffee, syrup, produce, packaging, cleaning. Or just say *figure it out* and I'll pick.`,
          done: false,
          nextStep: "init",
          updatedData: data,
        };
      }

      return {
        reply: `What brand is *${data.name}*? (e.g. "Monin", "Oatly", or say *skip* if brand doesn't matter)`,
        done: false,
        nextStep: "brand",
        updatedData: { ...data, category },
      };
    }

    case "brand": {
      const brand = optionalText(userMessage);
      return {
        reply: `What's *${data.name}* used for? (e.g. "lattes and mochas", "smoothies", "baking") — keeps things clear when linking recipes later.`,
        done: false,
        nextStep: "usage",
        updatedData: { ...data, brand },
      };
    }

    case "usage": {
      const usage = optionalText(userMessage);
      return {
        reply: [
          `Where do you store *${data.name}*?`,
          `• fridge`,
          `• freezer`,
          `• dry storage / pantry`,
          `• counter / bar`,
          `(or *skip*)`,
        ].join("\n"),
        done: false,
        nextStep: "storage",
        updatedData: { ...data, usage },
      };
    }

    case "storage": {
      const storage = optionalText(userMessage);

      // Ask Groq for smart defaults now that we have name + brand + usage +
      // category. If it returns a confident baseUnit we can skip that question.
      const defaults = await suggestItemDefaults({
        name: data.name ?? "",
        brand: data.brand,
        usage: data.usage,
        storage,
        category: (data.category as InventoryCategory) ?? null,
      });

      const updatedData: AddItemData = {
        ...data,
        storage,
        suggestedBaseUnit: defaults.baseUnit,
        suggestedParLevel: defaults.parLevel,
        suggestedPackText: defaults.packText,
      };

      // If the LLM is confident about base unit (not the fallback COUNT), use it
      // and skip straight to par level.
      const confidentBaseUnit =
        defaults.baseUnit === BaseUnit.GRAM || defaults.baseUnit === BaseUnit.MILLILITER;

      if (confidentBaseUnit) {
        return {
          reply: [
            `Good. I'll measure *${data.name}* in ${baseUnitLabel(defaults.baseUnit)}.`,
            ``,
            `What's your par level — how much do you always want in stock?`,
            `(A typical guess for this kind of item is *${defaults.parLevel} ${baseUnitLabel(defaults.baseUnit)}* — say a number, or *sounds good* to use that.)`,
          ].join("\n"),
          done: false,
          nextStep: "par_level",
          updatedData: { ...updatedData, baseUnit: defaults.baseUnit },
        };
      }

      return {
        reply: [
          `How do you measure *${data.name}* in your kitchen?`,
          `• grams`,
          `• ml / liters`,
          `• count / units (each)`,
        ].join("\n"),
        done: false,
        nextStep: "base_unit",
        updatedData,
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
      const suggested =
        typeof data.suggestedParLevel === "number" ? data.suggestedParLevel : null;
      const hint = suggested
        ? `\n(Typical for this kind of item: *${suggested} ${baseUnitLabel(baseUnit)}* — say that number, or *sounds good* to use it.)`
        : "";
      return {
        reply: `What's your par level for *${data.name}*?\nThat's how many ${baseUnitLabel(baseUnit)} you always want in stock.${hint}`,
        done: false,
        nextStep: "par_level",
        updatedData: { ...data, baseUnit },
      };
    }

    case "par_level": {
      // Accept "sounds good" / "yes" / "use that" to take the suggested default.
      const acceptDefault =
        /\b(sounds?\s*good|use\s*that|that\s*works|yes|yep|sure|ok|okay|fine)\b/i.test(userMessage);
      let par = parseNumber(userMessage);
      if (!par && acceptDefault && typeof data.suggestedParLevel === "number") {
        par = data.suggestedParLevel;
      }
      if (!par || par <= 0) {
        return {
          reply: `Give me a number for the par level of *${data.name}* — e.g. 50. Or say *sounds good* to use my suggestion.`,
          done: false,
          nextStep: "par_level",
          updatedData: data,
        };
      }

      const suggestedPack = data.suggestedPackText ?? "";
      const hint = suggestedPack
        ? `\n(Typical for this item: *${suggestedPack}* — say that, or *sounds good* to use it.)`
        : "";

      return {
        reply: [
          `How does *${data.name}* come from the supplier?`,
          ``,
          `e.g. "1L bottles", "500g bags", "individual units", "cases of 12"${hint}`,
        ].join("\n"),
        done: false,
        nextStep: "pack_size",
        updatedData: { ...data, parLevelBase: par },
      };
    }

    case "pack_size": {
      const baseUnit = (data.baseUnit as BaseUnit) ?? BaseUnit.COUNT;
      const acceptDefault =
        /\b(sounds?\s*good|use\s*that|that\s*works|yes|yep|sure|ok|okay|fine)\b/i.test(userMessage);
      const effectiveInput =
        acceptDefault && data.suggestedPackText ? data.suggestedPackText : userMessage;
      const { packSizeBase, purchaseUnit } = parsePackSize(effectiveInput, baseUnit);

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

  // Fold brand / usage into the notes field so they're preserved and visible in the UI.
  const noteParts: string[] = [];
  if (data.brand) noteParts.push(`Brand: ${data.brand}`);
  if (data.usage) noteParts.push(`Used for: ${data.usage}`);
  const notes = noteParts.length > 0 ? noteParts.join(" | ") : null;

  // Resolve a product image — branded items get a brand-specific prompt so
  // the generated shot looks like that brand's packaging. No network hit here;
  // the URL is deterministic and the image is generated on first browser fetch.
  const imageUrl = buildInventoryImageUrl({
    name,
    brand: data.brand,
    category,
  });

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
      storageLocation: data.storage ?? null,
      notes,
      imageUrl,
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
  const brandLine = data.brand ? `\n• Brand: ${data.brand}` : "";
  const usageLine = data.usage ? `\n• Used for: ${data.usage}` : "";
  const storageLine = data.storage ? `\n• Stored in: ${data.storage}` : "";
  const supplierLine = data.primarySupplierId ? `\n• Supplier linked ✓` : "";

  return {
    reply: [
      `✅ *${name}* added to your inventory!`,
      ``,
      `• Category: ${catLabel}${brandLine}${usageLine}${storageLine}`,
      `• Unit: ${unitLabel}`,
      `• Par level: ${parLevelBase} ${unitLabel}`,
      `• Pack size: ${packSizeBase} ${purchaseUnit.toLowerCase()}`,
      `• Low stock alert at: ${lowStockThresholdBase} ${unitLabel}${supplierLine}`,
      ``,
      `Want to link *${name}* to a recipe? Say something like: "*banana smoothie uses 2 bananas*"`,
    ].join("\n"),
  };
}
