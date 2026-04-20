import type { BaseUnit, BotChannel, InventoryCategory, MeasurementUnit, SupplierOrderingMode } from "@/lib/prisma";

export type WorkflowType = "ADD_ITEM" | "ADD_SUPPLIER" | "ADD_RECIPE" | "UPDATE_ITEM";

export type WorkflowContext = {
  locationId: string;
  userId: string;
  channel: BotChannel;
  inventoryItems: Array<{ id: string; name: string; sku: string }>;
  suppliers: Array<{ id: string; name: string }>;
};

export type WorkflowData = Record<string, unknown>;

export type ActiveWorkflowState = {
  id: string;
  workflow: WorkflowType;
  step: string;
  data: WorkflowData;
  locationId: string;
  userId: string;
  senderId: string;
  channel: BotChannel;
};

export type WorkflowAdvanceResult = {
  reply: string;
  done: boolean;
  nextStep?: string;
  updatedData?: WorkflowData;
};

// ── ADD_ITEM data shape ───────────────────────────────────────────────────────
export type AddItemData = {
  name?: string;
  category?: InventoryCategory;
  /** True when category was auto-detected from the item name — skip the category question */
  _categoryResolved?: boolean;
  brand?: string | null;
  usage?: string | null;
  storage?: string | null;
  baseUnit?: BaseUnit;
  parLevelBase?: number;
  packSizeBase?: number;
  purchaseUnit?: MeasurementUnit;
  primarySupplierId?: string | null;
  /** Smart defaults suggested by LLM — used to pre-fill answers */
  suggestedBaseUnit?: BaseUnit;
  suggestedParLevel?: number;
  suggestedPackText?: string;
};

// ── ADD_SUPPLIER data shape ───────────────────────────────────────────────────
export type AddSupplierData = {
  name?: string;
  orderingMode?: SupplierOrderingMode;
  email?: string | null;
  contactName?: string | null;
  leadTimeDays?: number;
};

// ── ADD_RECIPE data shape ─────────────────────────────────────────────────────
export type RecipeComponentDraft = {
  inventoryItemId: string;
  inventoryItemName: string;
  quantityBase: number;
  displayUnit: MeasurementUnit;
  componentType: "INGREDIENT" | "PACKAGING";
};

export type AddRecipeData = {
  dishName?: string;
  variantName?: string;
  components?: RecipeComponentDraft[];
  pendingUnmatched?: string[];
};

// ── UPDATE_ITEM data shape ────────────────────────────────────────────────────
export type UpdateItemData = {
  inventoryItemId?: string;
  inventoryItemName?: string;
  field?: string;
};
