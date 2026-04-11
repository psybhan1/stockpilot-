import type { Prisma } from "@/lib/prisma";

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function parseDeliveryDays(
  value: Prisma.JsonValue | null | undefined
): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const day =
      typeof entry === "number"
        ? entry
        : typeof entry === "string"
          ? Number(entry)
          : Number.NaN;

    return Number.isInteger(day) && day >= 0 && day <= 6 ? [day] : [];
  });
}

export function toDeliveryDaysJson(
  days: readonly number[]
): Prisma.InputJsonValue {
  return [...new Set(days)].filter(
    (day) => Number.isInteger(day) && day >= 0 && day <= 6
  );
}

export function formatDeliveryDays(
  value: Prisma.JsonValue | null | undefined
): string {
  const days = parseDeliveryDays(value);

  if (!days.length) {
    return "No delivery schedule";
  }

  return days.map((day) => weekdayLabels[day] ?? `Day ${day}`).join(", ");
}

