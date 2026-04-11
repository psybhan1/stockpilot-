import { MeasurementUnit, ServiceMode } from "@/lib/prisma";

import type { RecipeSuggestion } from "@/providers/contracts";

function packagingComponents() {
  return [
    {
      inventorySku: "INV-CUP-HOT-16",
      componentType: "PACKAGING" as const,
      quantityBase: 1,
      displayUnit: MeasurementUnit.COUNT,
      confidenceScore: 0.9,
      conditionServiceMode: ServiceMode.TO_GO,
    },
    {
      inventorySku: "INV-LID-HOT-16",
      componentType: "PACKAGING" as const,
      quantityBase: 1,
      displayUnit: MeasurementUnit.COUNT,
      confidenceScore: 0.9,
      conditionServiceMode: ServiceMode.TO_GO,
    },
  ];
}

export function buildRecipeSuggestion(variationName: string): RecipeSuggestion {
  const name = variationName.toLowerCase();

  if (name.includes("iced vanilla latte")) {
    return {
      summary:
        "Large iced vanilla latte uses espresso, oat milk, vanilla syrup, and to-go packaging. The oat milk component drives stockout risk.",
      confidenceScore: 0.87,
      components: [
        {
          inventorySku: "INV-BEANS-ESP",
          componentType: "INGREDIENT",
          quantityBase: 20,
          suggestedMinBase: 18,
          suggestedMaxBase: 22,
          displayUnit: MeasurementUnit.GRAM,
          confidenceScore: 0.83,
        },
        {
          inventorySku: "INV-OAT-01",
          componentType: "INGREDIENT",
          quantityBase: 320,
          suggestedMinBase: 300,
          suggestedMaxBase: 340,
          displayUnit: MeasurementUnit.MILLILITER,
          confidenceScore: 0.88,
        },
        {
          inventorySku: "INV-SYR-VAN",
          componentType: "INGREDIENT",
          quantityBase: 30,
          suggestedMinBase: 25,
          suggestedMaxBase: 35,
          displayUnit: MeasurementUnit.MILLILITER,
          confidenceScore: 0.78,
        },
        ...packagingComponents(),
      ],
    };
  }

  if (name.includes("matcha")) {
    return {
      summary:
        "Matcha latte uses matcha powder, milk, and to-go packaging when not served in-house.",
      confidenceScore: 0.8,
      components: [
        {
          inventorySku: "INV-MATCHA-01",
          componentType: "INGREDIENT",
          quantityBase: 12,
          suggestedMinBase: 10,
          suggestedMaxBase: 14,
          displayUnit: MeasurementUnit.GRAM,
          confidenceScore: 0.79,
        },
        {
          inventorySku: "INV-MILK-DAIRY",
          componentType: "INGREDIENT",
          quantityBase: 240,
          suggestedMinBase: 220,
          suggestedMaxBase: 260,
          displayUnit: MeasurementUnit.MILLILITER,
          confidenceScore: 0.82,
        },
        ...packagingComponents(),
      ],
    };
  }

  if (name.includes("mocha")) {
    return {
      summary:
        "Mocha needs espresso, milk, chocolate sauce, and to-go packaging. Leave chocolate usage in manager review before approval.",
      confidenceScore: 0.72,
      components: [
        {
          inventorySku: "INV-BEANS-ESP",
          componentType: "INGREDIENT",
          quantityBase: 18,
          suggestedMinBase: 18,
          suggestedMaxBase: 20,
          displayUnit: MeasurementUnit.GRAM,
          confidenceScore: 0.82,
        },
        {
          inventorySku: "INV-MILK-DAIRY",
          componentType: "INGREDIENT",
          quantityBase: 220,
          suggestedMinBase: 200,
          suggestedMaxBase: 240,
          displayUnit: MeasurementUnit.MILLILITER,
          confidenceScore: 0.81,
        },
        {
          inventorySku: "INV-CHOC-01",
          componentType: "INGREDIENT",
          quantityBase: 35,
          suggestedMinBase: 30,
          suggestedMaxBase: 40,
          displayUnit: MeasurementUnit.MILLILITER,
          confidenceScore: 0.69,
        },
        ...packagingComponents(),
      ],
    };
  }

  return {
    summary:
      "Default espresso milk beverage suggestion using espresso, dairy milk, and hot to-go packaging.",
    confidenceScore: 0.81,
    components: [
      {
        inventorySku: "INV-BEANS-ESP",
        componentType: "INGREDIENT",
        quantityBase: 18,
        suggestedMinBase: 18,
        suggestedMaxBase: 20,
        displayUnit: MeasurementUnit.GRAM,
        confidenceScore: 0.84,
      },
      {
        inventorySku: "INV-MILK-DAIRY",
        componentType: "INGREDIENT",
        quantityBase: 220,
        suggestedMinBase: 200,
        suggestedMaxBase: 240,
        displayUnit: MeasurementUnit.MILLILITER,
        confidenceScore: 0.83,
      },
      ...packagingComponents(),
      {
        inventorySku: "INV-SLEEVE-01",
        componentType: "PACKAGING",
        quantityBase: 1,
        displayUnit: MeasurementUnit.COUNT,
        confidenceScore: 0.78,
        conditionServiceMode: ServiceMode.TO_GO,
        optional: true,
      },
    ],
  };
}

