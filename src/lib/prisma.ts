import { PrismaClient as PostgresPrismaClient } from "@/generated/prisma-postgres";
import { PrismaClient as SqlitePrismaClient } from "@/generated/prisma-sqlite";

export { Prisma } from "@/generated/prisma-postgres";
export {
  AgentTaskStatus,
  AgentTaskType,
  AlertSeverity,
  AlertStatus,
  AlertType,
  BotChannel,
  ChannelType,
  CommunicationDirection,
  CommunicationStatus,
  CountSessionMode,
  CountSessionStatus,
  BaseUnit,
  IntegrationStatus,
  InventoryCategory,
  JobStatus,
  JobType,
  MappingStatus,
  MeasurementUnit,
  MovementType,
  NotificationChannel,
  NotificationStatus,
  PosProviderType,
  PosSyncType,
  PurchaseOrderStatus,
  RecipeComponentType,
  RecipeStatus,
  RecommendationStatus,
  Role,
  SaleProcessingStatus,
  ServiceMode,
  SupplierOrderingMode,
} from "@/generated/prisma-postgres";

export type PrismaClient = import("@/generated/prisma-postgres").PrismaClient;

export function databaseUsesPostgres(databaseUrl = process.env.DATABASE_URL) {
  return /^(postgres(ql)?|prisma\+postgres):/i.test(databaseUrl ?? "");
}

export function createPrismaClient(
  options?: ConstructorParameters<typeof PostgresPrismaClient>[0]
) {
  if (databaseUsesPostgres()) {
    return new PostgresPrismaClient(options);
  }

  return new SqlitePrismaClient(
    options as ConstructorParameters<typeof SqlitePrismaClient>[0]
  ) as unknown as PrismaClient;
}
