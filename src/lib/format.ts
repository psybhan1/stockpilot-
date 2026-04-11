import { format, formatDistanceToNowStrict } from "date-fns";
import { BaseUnit } from "@/lib/domain-enums";

export function formatRelativeDays(daysLeft: number | null | undefined) {
  if (daysLeft == null || Number.isNaN(daysLeft)) {
    return "Unknown";
  }

  if (daysLeft < 1) {
    return `${Math.max(daysLeft * 24, 1).toFixed(1)} hrs`;
  }

  return `${daysLeft.toFixed(1)} days`;
}

export function formatDateTime(value: Date | null | undefined) {
  if (!value) {
    return "Not scheduled";
  }

  return format(value, "MMM d, yyyy h:mm a");
}

export function formatFromNow(value: Date | null | undefined) {
  if (!value) {
    return "Unknown";
  }

  return formatDistanceToNowStrict(value, { addSuffix: true });
}

export function formatCurrency(cents: number | null | undefined) {
  if (cents == null) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}

export function baseUnitLabel(baseUnit: BaseUnit) {
  switch (baseUnit) {
    case "GRAM":
      return "g";
    case "MILLILITER":
      return "ml";
    case "COUNT":
    default:
      return "ct";
  }
}

