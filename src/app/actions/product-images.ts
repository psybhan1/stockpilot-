"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@/lib/domain-enums";

import { db } from "@/lib/db";
import { requireSession } from "@/modules/auth/session";
import { researchBusinessBrand } from "@/modules/images/brand-research";
import {
  generateProductImage,
  getBrandIdentity,
} from "@/modules/images/product-image";
import { findAndPersistStockImage } from "@/modules/images/stock-image-finder";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Upload a manual product image. Accepts form-data with a `file` field.
 * Replaces whatever's on imageBytes (whether from AI or a prior upload).
 */
export async function uploadInventoryImageAction(
  formData: FormData
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const session = await requireSession(Role.MANAGER);
  const itemId = String(formData.get("itemId") ?? "");
  const file = formData.get("file");

  if (!itemId) return { ok: false, reason: "Missing item id." };
  if (!(file instanceof Blob)) {
    return { ok: false, reason: "No file uploaded." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: "File too big (max 5 MB)." };
  }
  const contentType = file.type || "image/jpeg";
  if (!contentType.startsWith("image/")) {
    return { ok: false, reason: "Only image files are accepted." };
  }

  const item = await db.inventoryItem.findFirst({
    where: { id: itemId, locationId: session.locationId },
    select: { id: true },
  });
  if (!item) return { ok: false, reason: "Item not found in this location." };

  const buffer = Buffer.from(await file.arrayBuffer());

  await db.inventoryItem.update({
    where: { id: item.id },
    data: {
      imageBytes: new Uint8Array(buffer),
      imageContentType: contentType,
      imageSource: "upload",
      imageGeneratedAt: new Date(),
    },
  });

  revalidatePath("/inventory");
  revalidatePath(`/inventory/${item.id}`);
  return { ok: true };
}

/**
 * Find a real product photo on the web for a stock inventory item.
 * Uses Brave Image Search scoped to "{supplier} {item name} product".
 * Never uses AI — stock items are specific brand products (Kirkland
 * milk, Solo cups) and the barista needs to match real cartons.
 *
 * For menu items (drinks), see generateMenuImageAction which DOES
 * use AI with the café's brand template.
 */
export async function findInventoryImageAction(
  itemId: string
): Promise<{ ok: true; sourceUrl?: string } | { ok: false; reason: string }> {
  const session = await requireSession(Role.MANAGER);
  const result = await findAndPersistStockImage({
    inventoryItemId: itemId,
    locationId: session.locationId,
  });
  revalidatePath("/inventory");
  revalidatePath(`/inventory/${itemId}`);
  return result.ok
    ? { ok: true, sourceUrl: result.sourceUrl }
    : { ok: false, reason: result.reason };
}

/**
 * Generate an AI image for a MENU item (drinks/foods your café
 * makes) using the business's auto-derived brand identity. Uses
 * Cloudflare Workers AI Flux Schnell — free at our scale.
 *
 * Research brand identity first if stale, silently.
 */
export async function generateMenuImageAction(
  menuItemId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const session = await requireSession(Role.MANAGER);

  const item = await db.menuItem.findFirst({
    where: { id: menuItemId, locationId: session.locationId },
    select: {
      id: true,
      name: true,
      category: true,
      location: {
        select: {
          business: {
            select: {
              id: true,
              name: true,
              streetAddress: true,
              postalCode: true,
              brandIdentityAt: true,
            },
          },
        },
      },
    },
  });
  if (!item) return { ok: false, reason: "Menu item not found." };

  const business = item.location.business;
  const brandStale =
    !business.brandIdentityAt ||
    Date.now() - business.brandIdentityAt.getTime() > 90 * 24 * 60 * 60 * 1000;
  if (brandStale) {
    await researchBusinessBrand({
      businessId: business.id,
      businessName: business.name,
      streetAddress: business.streetAddress,
      postalCode: business.postalCode,
    }).catch(() => null);
  }

  const brand = await getBrandIdentity(business.id);
  const generated = await generateProductImage({
    productName: item.name,
    category: item.category ?? "BEVERAGE",
    brand,
  });

  if (!generated) {
    return {
      ok: false,
      reason:
        "Image generation is offline. Add CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN on Railway, or upload manually.",
    };
  }

  await db.menuItem.update({
    where: { id: item.id },
    data: {
      imageBytes: new Uint8Array(generated.bytes),
      imageContentType: generated.contentType,
      imageSource: "ai",
      imageGeneratedAt: new Date(),
    },
  });

  revalidatePath("/recipes");
  return { ok: true };
}

export async function uploadMenuImageAction(
  formData: FormData
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const session = await requireSession(Role.MANAGER);
  const menuItemId = String(formData.get("menuItemId") ?? "");
  const file = formData.get("file");
  if (!menuItemId) return { ok: false, reason: "Missing menu item id." };
  if (!(file instanceof Blob)) return { ok: false, reason: "No file." };
  if (file.size > MAX_UPLOAD_BYTES)
    return { ok: false, reason: "File too big (max 5 MB)." };
  const contentType = file.type || "image/jpeg";
  if (!contentType.startsWith("image/"))
    return { ok: false, reason: "Only image files." };

  const item = await db.menuItem.findFirst({
    where: { id: menuItemId, locationId: session.locationId },
    select: { id: true },
  });
  if (!item) return { ok: false, reason: "Menu item not found." };

  const buffer = Buffer.from(await file.arrayBuffer());
  await db.menuItem.update({
    where: { id: item.id },
    data: {
      imageBytes: new Uint8Array(buffer),
      imageContentType: contentType,
      imageSource: "upload",
      imageGeneratedAt: new Date(),
    },
  });
  revalidatePath("/recipes");
  return { ok: true };
}

/**
 * Clear the stored bytes. Useful when the user wants to revert to the
 * POS catalog image (if one exists) or placeholder.
 */
export async function clearInventoryImageAction(
  itemId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const session = await requireSession(Role.MANAGER);
  const item = await db.inventoryItem.findFirst({
    where: { id: itemId, locationId: session.locationId },
    select: { id: true },
  });
  if (!item) return { ok: false, reason: "Item not found." };

  await db.inventoryItem.update({
    where: { id: item.id },
    data: {
      imageBytes: null,
      imageContentType: null,
      imageSource: "none",
      imageGeneratedAt: null,
    },
  });

  revalidatePath("/inventory");
  revalidatePath(`/inventory/${item.id}`);
  return { ok: true };
}
