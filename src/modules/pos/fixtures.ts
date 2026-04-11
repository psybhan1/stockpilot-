import { ServiceMode } from "@/lib/prisma";

import type { ProviderCatalogItem, ProviderSaleEvent } from "@/providers/contracts";

export const fakeSquareCatalog: ProviderCatalogItem[] = [
  {
    externalItemId: "sq-item-espresso",
    name: "Espresso",
    category: "Coffee",
    imageUrl: "/inventory/espresso.svg",
    variations: [
      {
        externalVariationId: "sq-var-espresso-single",
        name: "Espresso",
        sizeLabel: "Single",
        priceCents: 350,
        serviceMode: ServiceMode.DINE_IN,
      },
    ],
  },
  {
    externalItemId: "sq-item-americano",
    name: "Americano",
    category: "Coffee",
    imageUrl: "/inventory/americano.svg",
    variations: [
      {
        externalVariationId: "sq-var-americano-medium",
        name: "Americano",
        sizeLabel: "Medium",
        priceCents: 450,
        serviceMode: ServiceMode.TO_GO,
      },
    ],
  },
  {
    externalItemId: "sq-item-cappuccino",
    name: "Cappuccino",
    category: "Coffee",
    imageUrl: "/inventory/cappuccino.svg",
    variations: [
      {
        externalVariationId: "sq-var-cappuccino-medium",
        name: "Cappuccino",
        sizeLabel: "Medium",
        priceCents: 520,
        serviceMode: ServiceMode.TO_GO,
      },
    ],
  },
  {
    externalItemId: "sq-item-latte",
    name: "Latte",
    category: "Coffee",
    imageUrl: "/inventory/latte.svg",
    variations: [
      {
        externalVariationId: "sq-var-latte-medium",
        name: "Medium Latte",
        sizeLabel: "Medium",
        priceCents: 560,
        serviceMode: ServiceMode.TO_GO,
      },
      {
        externalVariationId: "sq-var-latte-iced-large",
        name: "Large Iced Vanilla Latte",
        sizeLabel: "Large",
        priceCents: 690,
        serviceMode: ServiceMode.TO_GO,
      },
    ],
  },
  {
    externalItemId: "sq-item-matcha",
    name: "Matcha Latte",
    category: "Tea",
    imageUrl: "/inventory/matcha.svg",
    variations: [
      {
        externalVariationId: "sq-var-matcha-medium",
        name: "Matcha Latte",
        sizeLabel: "Medium",
        priceCents: 620,
        serviceMode: ServiceMode.TO_GO,
      },
    ],
  },
  {
    externalItemId: "sq-item-mocha",
    name: "Mocha",
    category: "Coffee",
    imageUrl: "/inventory/mocha.svg",
    variations: [
      {
        externalVariationId: "sq-var-mocha-medium",
        name: "Mocha",
        sizeLabel: "Medium",
        priceCents: 650,
        serviceMode: ServiceMode.TO_GO,
      },
    ],
  },
];

export const fakeSquareOrders: ProviderSaleEvent[] = [
  {
    externalOrderId: "sq-order-demo-001",
    occurredAt: new Date("2026-04-08T12:15:00.000Z"),
    status: "COMPLETED",
    serviceMode: ServiceMode.TO_GO,
    lines: [
      {
        externalLineId: "line-001",
        externalVariationId: "sq-var-latte-medium",
        quantity: 9,
        unitPriceCents: 560,
        serviceMode: ServiceMode.TO_GO,
      },
      {
        externalLineId: "line-002",
        externalVariationId: "sq-var-latte-iced-large",
        quantity: 7,
        unitPriceCents: 690,
        serviceMode: ServiceMode.TO_GO,
      },
      {
        externalLineId: "line-003",
        externalVariationId: "sq-var-matcha-medium",
        quantity: 4,
        unitPriceCents: 620,
        serviceMode: ServiceMode.TO_GO,
      },
    ],
  },
];

