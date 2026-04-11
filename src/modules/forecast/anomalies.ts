import { differenceInCalendarDays } from "date-fns";

export function isCountStale(
  lastCountedAt: Date | null | undefined,
  maxAgeDays = 3,
  now = new Date()
) {
  if (!lastCountedAt) {
    return true;
  }

  return differenceInCalendarDays(now, lastCountedAt) >= maxAgeDays;
}

export function isHighUsageSpike(input: {
  recentAverageDailyUsageBase: number;
  baselineAverageDailyUsageBase: number;
  multiplier?: number;
  minimumDeltaBase?: number;
}) {
  const multiplier = input.multiplier ?? 1.5;
  const minimumDeltaBase = input.minimumDeltaBase ?? 1;

  if (input.recentAverageDailyUsageBase <= 0 || input.baselineAverageDailyUsageBase <= 0) {
    return false;
  }

  return (
    input.recentAverageDailyUsageBase >=
      input.baselineAverageDailyUsageBase * multiplier &&
    input.recentAverageDailyUsageBase - input.baselineAverageDailyUsageBase >= minimumDeltaBase
  );
}
