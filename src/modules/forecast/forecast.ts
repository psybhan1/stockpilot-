import { addDays } from "date-fns";
import { AlertSeverity } from "../../lib/domain-enums";

export function calculateAverageDailyUsage(totalConsumedBase: number, daysWindow = 7) {
  if (daysWindow <= 0) {
    return 0;
  }

  return totalConsumedBase / daysWindow;
}

export function calculateDaysLeft(
  stockOnHandBase: number,
  averageDailyUsageBase: number
) {
  // Stockout (or oversold) trumps a missing burn rate. Without this,
  // a brand-new item at 0 stock with no usage history classifies as
  // INFO — hiding a literal stockout behind "insufficient data."
  if (stockOnHandBase <= 0) {
    return 0;
  }

  if (averageDailyUsageBase <= 0) {
    return null;
  }

  return stockOnHandBase / averageDailyUsageBase;
}

export function projectRunoutDate(daysLeft: number | null) {
  if (daysLeft == null) {
    return null;
  }

  return addDays(new Date(), daysLeft);
}

export function classifyUrgency(input: {
  daysLeft: number | null;
  leadTimeDays: number;
  safetyDays: number;
}) {
  if (input.daysLeft == null) {
    return AlertSeverity.INFO;
  }

  if (input.daysLeft <= Math.max(input.leadTimeDays, 1)) {
    return AlertSeverity.CRITICAL;
  }

  if (input.daysLeft <= input.leadTimeDays + input.safetyDays) {
    return AlertSeverity.WARNING;
  }

  return AlertSeverity.INFO;
}

