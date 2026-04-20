/**
 * "Try the demo" — spins up a throwaway tenant with realistic data
 * (one café, three suppliers, nine items at varying stock levels,
 * three recent POs). Issues a session cookie and redirects to the
 * dashboard. No signup, no credit card.
 *
 * Clean-up: demo tenants are tagged with "[DEMO]" in the Business
 * name and auto-deleted by the worker after 7 days.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  AlertSeverity,
  BaseUnit,
  InventoryCategory,
  MeasurementUnit,
  Role as PrismaRole,
  SupplierOrderingMode,
} from "@/lib/prisma";
import { db } from "@/lib/db";
import { createSession } from "@/modules/auth/session";

export async function POST(req: NextRequest) {
  return startDemo(req);
}
export async function GET(req: NextRequest) {
  return startDemo(req);
}

async function startDemo(req: NextRequest) {
  try {
    const suffix = randomBytes(4).toString("hex");
    const slug = `demo-${suffix}`;
    const business = await db.business.create({
      data: {
        name: "[DEMO] Northside Café",
        slug,
        locations: {
          create: {
            name: "Queen Street",
            timezone: "America/Toronto",
            isPrimary: true,
          },
        },
      },
      include: { locations: true },
    });
    const location = business.locations[0];

    const passwordHash = await bcrypt.hash(randomUUID(), 10);
    const user = await db.user.create({
      data: {
        email: `${slug}@demo.stockpilot.app`,
        name: "Demo Manager",
        passwordHash,
        roles: {
          create: {
            locationId: location.id,
            role: PrismaRole.MANAGER,
          },
        },
      },
    });

    await seedDemoData(location.id);
    await createSession(user.id);

    const url = new URL("/dashboard?demo=1", req.url);
    return NextResponse.redirect(url, 303);
  } catch (err) {
    console.error("[demo/start] failed:", err);
    return NextResponse.json(
      { ok: false, message: "Couldn't start demo — try again in a moment." },
      { status: 500 }
    );
  }
}

async function seedDemoData(locationId: string) {
  const suppliers = await Promise.all([
    db.supplier.create({
      data: {
        locationId,
        name: "FreshCo Produce",
        contactName: "Ellie",
        email: "orders@freshco.demo",
        orderingMode: SupplierOrderingMode.EMAIL,
        leadTimeDays: 2,
      },
    }),
    db.supplier.create({
      data: {
        locationId,
        name: "BeanCo Roasters",
        contactName: "Marco",
        email: "orders@beanco.demo",
        orderingMode: SupplierOrderingMode.EMAIL,
        leadTimeDays: 3,
      },
    }),
    db.supplier.create({
      data: {
        locationId,
        name: "DairyFlow Wholesale",
        contactName: "Priya",
        email: "orders@dairyflow.demo",
        orderingMode: SupplierOrderingMode.EMAIL,
        leadTimeDays: 1,
      },
    }),
  ]);
  const [freshCo, beanCo, dairyFlow] = suppliers;

  const items = [
    { name: "Oat Milk", category: InventoryCategory.ALT_DAIRY, baseUnit: BaseUnit.MILLILITER, displayUnit: MeasurementUnit.LITER, pack: 1000, on: 3000, par: 12000, supplier: dairyFlow.id },
    { name: "Ground Coffee", category: InventoryCategory.COFFEE, baseUnit: BaseUnit.GRAM, displayUnit: MeasurementUnit.KILOGRAM, pack: 1000, on: 2000, par: 8000, supplier: beanCo.id },
    { name: "Espresso Beans", category: InventoryCategory.COFFEE, baseUnit: BaseUnit.GRAM, displayUnit: MeasurementUnit.KILOGRAM, pack: 1000, on: 6500, par: 10000, supplier: beanCo.id },
    { name: "Whole Milk", category: InventoryCategory.DAIRY, baseUnit: BaseUnit.MILLILITER, displayUnit: MeasurementUnit.LITER, pack: 1000, on: 8000, par: 20000, supplier: dairyFlow.id },
    { name: "Coconut Syrup", category: InventoryCategory.SYRUP, baseUnit: BaseUnit.MILLILITER, displayUnit: MeasurementUnit.LITER, pack: 750, on: 1200, par: 3000, supplier: freshCo.id },
    { name: "Vanilla Syrup", category: InventoryCategory.SYRUP, baseUnit: BaseUnit.MILLILITER, displayUnit: MeasurementUnit.LITER, pack: 750, on: 2800, par: 3000, supplier: freshCo.id },
    { name: "12 oz Hot Cups", category: InventoryCategory.PACKAGING, baseUnit: BaseUnit.COUNT, displayUnit: MeasurementUnit.COUNT, pack: 50, on: 300, par: 500, supplier: freshCo.id },
    { name: "Pastry Boxes", category: InventoryCategory.PACKAGING, baseUnit: BaseUnit.COUNT, displayUnit: MeasurementUnit.COUNT, pack: 25, on: 40, par: 120, supplier: freshCo.id },
    { name: "Coffee Filters", category: InventoryCategory.PACKAGING, baseUnit: BaseUnit.COUNT, displayUnit: MeasurementUnit.COUNT, pack: 100, on: 50, par: 300, supplier: beanCo.id },
  ];

  for (const it of items) {
    const created = await db.inventoryItem.create({
      data: {
        locationId,
        name: it.name,
        sku: `DEMO-${randomBytes(3).toString("hex").toUpperCase()}`,
        category: it.category,
        baseUnit: it.baseUnit,
        displayUnit: it.displayUnit,
        countUnit: it.displayUnit,
        purchaseUnit: it.displayUnit,
        packSizeBase: it.pack,
        stockOnHandBase: it.on,
        parLevelBase: it.par,
        safetyStockBase: Math.max(1, Math.round(it.par * 0.2)),
        lowStockThresholdBase: Math.max(1, Math.round(it.par * 0.4)),
        primarySupplierId: it.supplier,
      },
    });
    await db.supplierItem.create({
      data: {
        supplierId: it.supplier,
        inventoryItemId: created.id,
        packSizeBase: it.pack,
        minimumOrderQuantity: 1,
        preferred: true,
      },
    });

    // Second supplier link for a few items so rescue-flow is demoable.
    if (it.name === "Ground Coffee" || it.name === "Coffee Filters") {
      await db.supplierItem.create({
        data: {
          supplierId: freshCo.id,
          inventoryItemId: created.id,
          packSizeBase: it.pack,
          minimumOrderQuantity: 1,
          preferred: false,
        },
      });
    }

    const urgency =
      it.on < it.par * 0.25
        ? AlertSeverity.CRITICAL
        : it.on < it.par * 0.5
        ? AlertSeverity.WARNING
        : AlertSeverity.INFO;
    const dailyBurn = Math.max(1, Math.round(it.par * 0.1));
    await db.inventorySnapshot.create({
      data: {
        locationId,
        inventoryItemId: created.id,
        stockOnHandBase: it.on,
        averageDailyUsageBase: dailyBurn,
        urgency,
        daysLeft: Math.max(0, Math.round((it.on / dailyBurn) * 10) / 10),
      },
    });
  }
}
