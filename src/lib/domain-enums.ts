export const Role = {
  STAFF: "STAFF",
  SUPERVISOR: "SUPERVISOR",
  MANAGER: "MANAGER",
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const AlertSeverity = {
  INFO: "INFO",
  WARNING: "WARNING",
  CRITICAL: "CRITICAL",
} as const;

export type AlertSeverity = (typeof AlertSeverity)[keyof typeof AlertSeverity];

export const AlertStatus = {
  OPEN: "OPEN",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  RESOLVED: "RESOLVED",
} as const;

export type AlertStatus = (typeof AlertStatus)[keyof typeof AlertStatus];

export const MappingStatus = {
  UNMAPPED: "UNMAPPED",
  RECIPE_DRAFT: "RECIPE_DRAFT",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  READY: "READY",
} as const;

export type MappingStatus = (typeof MappingStatus)[keyof typeof MappingStatus];

export const BaseUnit = {
  GRAM: "GRAM",
  MILLILITER: "MILLILITER",
  COUNT: "COUNT",
} as const;

export type BaseUnit = (typeof BaseUnit)[keyof typeof BaseUnit];

export const MeasurementUnit = {
  GRAM: "GRAM",
  KILOGRAM: "KILOGRAM",
  MILLILITER: "MILLILITER",
  LITER: "LITER",
  COUNT: "COUNT",
  CASE: "CASE",
  BOTTLE: "BOTTLE",
  BAG: "BAG",
  BOX: "BOX",
} as const;

export type MeasurementUnit =
  (typeof MeasurementUnit)[keyof typeof MeasurementUnit];

export const PurchaseOrderStatus = {
  DRAFT: "DRAFT",
  AWAITING_APPROVAL: "AWAITING_APPROVAL",
  APPROVED: "APPROVED",
  SENT: "SENT",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
} as const;

export type PurchaseOrderStatus =
  (typeof PurchaseOrderStatus)[keyof typeof PurchaseOrderStatus];

export const RecipeStatus = {
  DRAFT: "DRAFT",
  APPROVED: "APPROVED",
  ARCHIVED: "ARCHIVED",
} as const;

export type RecipeStatus = (typeof RecipeStatus)[keyof typeof RecipeStatus];

export const SupplierOrderingMode = {
  EMAIL: "EMAIL",
  WEBSITE: "WEBSITE",
  MANUAL: "MANUAL",
} as const;

export type SupplierOrderingMode =
  (typeof SupplierOrderingMode)[keyof typeof SupplierOrderingMode];

export const InventoryCategory = {
  COFFEE: "COFFEE",
  DAIRY: "DAIRY",
  ALT_DAIRY: "ALT_DAIRY",
  SYRUP: "SYRUP",
  BAKERY_INGREDIENT: "BAKERY_INGREDIENT",
  PACKAGING: "PACKAGING",
  CLEANING: "CLEANING",
  PAPER_GOODS: "PAPER_GOODS",
  RETAIL: "RETAIL",
  SEASONAL: "SEASONAL",
  SUPPLY: "SUPPLY",
} as const;

export type InventoryCategory =
  (typeof InventoryCategory)[keyof typeof InventoryCategory];
