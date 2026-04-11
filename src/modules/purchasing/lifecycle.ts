import { PurchaseOrderStatus } from "../../lib/domain-enums";

export function canMarkPurchaseOrderSent(status: PurchaseOrderStatus) {
  return status === PurchaseOrderStatus.APPROVED;
}

export function canAcknowledgePurchaseOrder(status: PurchaseOrderStatus) {
  return ([
    PurchaseOrderStatus.APPROVED,
    PurchaseOrderStatus.SENT,
  ] as PurchaseOrderStatus[]).includes(status);
}

export function canDeliverPurchaseOrder(status: PurchaseOrderStatus) {
  return ([
    PurchaseOrderStatus.APPROVED,
    PurchaseOrderStatus.SENT,
    PurchaseOrderStatus.ACKNOWLEDGED,
  ] as PurchaseOrderStatus[]).includes(status);
}

export function canCancelPurchaseOrder(status: PurchaseOrderStatus) {
  return ([
    PurchaseOrderStatus.DRAFT,
    PurchaseOrderStatus.AWAITING_APPROVAL,
    PurchaseOrderStatus.APPROVED,
    PurchaseOrderStatus.SENT,
    PurchaseOrderStatus.ACKNOWLEDGED,
  ] as PurchaseOrderStatus[]).includes(status);
}

export function getPurchaseOrderStatusTone(status: PurchaseOrderStatus) {
  switch (status) {
    case PurchaseOrderStatus.DELIVERED:
      return "success";
    case PurchaseOrderStatus.CANCELLED:
    case PurchaseOrderStatus.FAILED:
      return "critical";
    case PurchaseOrderStatus.AWAITING_APPROVAL:
    case PurchaseOrderStatus.ACKNOWLEDGED:
      return "warning";
    case PurchaseOrderStatus.APPROVED:
    case PurchaseOrderStatus.SENT:
      return "info";
    case PurchaseOrderStatus.DRAFT:
    default:
      return "neutral";
  }
}

export function normalizeReceivedPackCount(
  value: FormDataEntryValue | number | null | undefined,
  fallback: number
) {
  if (typeof value === "number") {
    return Math.max(0, Math.round(value));
  }

  if (typeof value === "string") {
    if (!value.trim()) {
      return fallback;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
  }

  return fallback;
}

export function receivedQuantityBaseFromPacks(
  receivedPackCount: number,
  packSizeBase: number
) {
  return Math.max(0, receivedPackCount) * Math.max(0, packSizeBase);
}

