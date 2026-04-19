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
 * Ask StockBuddy to generate a product image. Uses the business's
 * brandIdentity template; if brandIdentity is empty or stale, kicks
 * off auto-research first (which ALSO runs silently in the background
 * on signup once brand-research is wired).
 *
 * Falls back gracefully if Cloudflare isn't configured — returns an
 * error message the UI surfaces so the user knows they can still
 * upload manually.
 */
export async function generateInventoryImageAction(
  itemId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const session = await requireSession(Role.MANAGER);

  const item = await db.inventoryItem.findFirst({
    where: { id: itemId, locationId: session.locationId },
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
  if (!item) return { ok: false, reason: "Item not found in this location." };

  const business = item.location.business;

  // If brand research is missing or older than 90 days, refresh first.
  // Best-effort; failures fall back to default brand identity.
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
    category: String(item.category),
    brand,
  });

  if (!generated) {
    return {
      ok: false,
      reason:
        "Image generation is offline. Add CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN on Railway, or upload manually.",
    };
  }

  await db.inventoryItem.update({
    where: { id: item.id },
    data: {
      imageBytes: new Uint8Array(generated.bytes),
      imageContentType: generated.contentType,
      imageSource: "ai",
      imageGeneratedAt: new Date(),
    },
  });

  revalidatePath("/inventory");
  revalidatePath(`/inventory/${item.id}`);
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
