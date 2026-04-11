import { BaseUnit, MeasurementUnit } from "../../lib/domain-enums";

export function convertBaseToDisplay(
  quantityBase: number,
  displayUnit: MeasurementUnit,
  packSizeBase = 1
) {
  switch (displayUnit) {
    case "KILOGRAM":
    case "LITER":
      return quantityBase / 1000;
    case "CASE":
    case "BAG":
    case "BOTTLE":
    case "BOX":
      return quantityBase / Math.max(packSizeBase, 1);
    case "GRAM":
    case "MILLILITER":
    case "COUNT":
    default:
      return quantityBase;
  }
}

export function convertDisplayToBase(
  quantityDisplay: number,
  displayUnit: MeasurementUnit,
  packSizeBase = 1
) {
  switch (displayUnit) {
    case "KILOGRAM":
    case "LITER":
      return Math.round(quantityDisplay * 1000);
    case "CASE":
    case "BAG":
    case "BOTTLE":
    case "BOX":
      return Math.round(quantityDisplay * Math.max(packSizeBase, 1));
    case "GRAM":
    case "MILLILITER":
    case "COUNT":
    default:
      return Math.round(quantityDisplay);
  }
}

export function formatQuantityBase(
  quantityBase: number,
  displayUnit: MeasurementUnit,
  packSizeBase = 1
) {
  const value = convertBaseToDisplay(quantityBase, displayUnit, packSizeBase);
  const maximumFractionDigits =
    displayUnit === "KILOGRAM" || displayUnit === "LITER" ? 2 : 0;

  return `${value.toLocaleString("en-CA", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  })} ${displayUnit.toLowerCase()}`;
}

export function applyDelta(stockOnHandBase: number, quantityDeltaBase: number) {
  return {
    beforeBalanceBase: stockOnHandBase,
    afterBalanceBase: stockOnHandBase + quantityDeltaBase,
  };
}

export function calculateCountAdjustment(expectedBase: number, countedBase: number) {
  return countedBase - expectedBase;
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

