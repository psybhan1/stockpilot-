import { MovementType, ServiceMode } from "../../lib/domain-enums";

export const USAGE_SIGNAL_MOVEMENT_TYPES: readonly MovementType[] = [
  MovementType.POS_DEPLETION,
  MovementType.WASTE,
  MovementType.BREAKAGE,
  MovementType.MANUAL_COUNT_ADJUSTMENT,
  MovementType.CORRECTION,
  MovementType.TRANSFER,
  MovementType.RETURN,
] as const;

export function componentMatchesServiceMode(
  lineServiceMode: ServiceMode | null | undefined,
  conditionServiceMode: ServiceMode | null | undefined
): boolean {
  if (!conditionServiceMode) {
    return true;
  }

  return lineServiceMode === conditionServiceMode;
}

export function normalizeModifierKey(value: string): string {
  return value.trim().toLowerCase();
}

export function componentMatchesModifierKey(
  componentModifierKey: string | null | undefined,
  lineModifierKeys: string[]
): boolean {
  if (!componentModifierKey) {
    return true;
  }

  const normalized = normalizeModifierKey(componentModifierKey);
  return lineModifierKeys.some(
    (lineModifierKey) => normalizeModifierKey(lineModifierKey) === normalized
  );
}

export function extractModifierKeysFromValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((entry) => {
      if (typeof entry === "string") {
        return [entry];
      }

      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const record = entry as Record<string, unknown>;
        return [record.catalog_object_id, record.name].filter(
          (candidate): candidate is string =>
            typeof candidate === "string" && candidate.trim().length > 0
        );
      }

      return [];
    })
    .map((entry) => entry.trim());
}

export function extractModifierKeys(
  modifierKeys: unknown,
  rawData: unknown
): string[] {
  const fromField = extractModifierKeysFromValue(modifierKeys);

  if (fromField.length > 0) {
    return fromField;
  }

  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return [];
  }

  return extractModifierKeysFromValue(
    (rawData as Record<string, unknown>).modifiers
  );
}

export function sumNegativeUsageBase(
  movements: Array<{
    movementType: MovementType;
    quantityDeltaBase: number;
  }>
): number {
  return movements
    .filter((movement) => USAGE_SIGNAL_MOVEMENT_TYPES.includes(movement.movementType))
    .reduce(
      (sum, movement) => sum + Math.abs(Math.min(movement.quantityDeltaBase, 0)),
      0
    );
}

export function clampConfidenceScore(score: number): number {
  return Math.min(0.99, Math.max(0.2, score));
}
