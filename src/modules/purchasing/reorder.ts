import { addDays, isBefore, nextDay } from "date-fns";
import {
  AlertSeverity,
  MeasurementUnit,
  SupplierOrderingMode,
} from "../../lib/domain-enums";

type ReorderInput = {
  stockOnHandBase: number;
  averageDailyUsageBase: number;
  parLevelBase: number;
  safetyStockBase: number;
  leadTimeDays: number;
  deliveryDays: number[];
  packSizeBase: number;
  minimumOrderQuantity: number;
};

export function getNextDeliveryDate(deliveryDays: number[]) {
  const today = new Date();

  if (deliveryDays.length === 0) {
    return addDays(today, 1);
  }

  let next = addDays(today, 14);

  for (const day of deliveryDays) {
    const candidate = nextDay(today, day as 0 | 1 | 2 | 3 | 4 | 5 | 6);
    if (isBefore(candidate, next)) {
      next = candidate;
    }
  }

  return next;
}

export function calculateRecommendedOrder(input: ReorderInput) {
  const daysUntilCoverageTarget = Math.max(input.leadTimeDays + 2, 3);
  const demandCoverageBase = Math.ceil(
    input.averageDailyUsageBase * daysUntilCoverageTarget
  );
  const targetBase = Math.max(
    input.parLevelBase + input.safetyStockBase,
    demandCoverageBase + input.safetyStockBase
  );
  const neededBase = Math.max(targetBase - input.stockOnHandBase, 0);
  const packCount = Math.max(
    Math.ceil(neededBase / Math.max(input.packSizeBase, 1)),
    input.minimumOrderQuantity
  );

  return {
    recommendedOrderQuantityBase: packCount * Math.max(input.packSizeBase, 1),
    recommendedPackCount: packCount,
    projectedDeliveryDate: getNextDeliveryDate(input.deliveryDays),
  };
}

export function buildRecommendationSummary(input: {
  inventoryName: string;
  recommendedPackCount: number;
  purchaseUnit: MeasurementUnit;
  supplierName: string;
  urgency: AlertSeverity;
}) {
  const urgencyLine =
    input.urgency === AlertSeverity.CRITICAL
      ? "Current projection reaches stockout before the next safe delivery window."
      : "Order now to stay above safety stock before the next delivery window.";

  return `Order ${input.recommendedPackCount} ${input.purchaseUnit.toLowerCase()} of ${input.inventoryName} from ${input.supplierName}. ${urgencyLine}`;
}

export function getApprovalOutcome(orderingMode: SupplierOrderingMode) {
  return orderingMode === SupplierOrderingMode.WEBSITE
    ? "agent-task"
    : "purchase-order";
}

