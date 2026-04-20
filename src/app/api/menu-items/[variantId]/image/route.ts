import { NextResponse } from "next/server";

import { db } from "@/lib/db";

/**
 * Serve the menu-level image for a given variant id. The image lives
 * on the parent MenuItem (Latte) so all variants (Small/Medium/Large)
 * share one photo — the drink looks the same across sizes.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ variantId: string }> }
) {
  const { variantId } = await context.params;
  const variant = await db.menuItemVariant.findUnique({
    where: { id: variantId },
    select: {
      menuItem: {
        select: { imageBytes: true, imageContentType: true },
      },
    },
  });
  const item = variant?.menuItem;
  if (!item?.imageBytes) {
    return new NextResponse("Not found", { status: 404 });
  }
  return new NextResponse(Buffer.from(item.imageBytes), {
    status: 200,
    headers: {
      "Content-Type": item.imageContentType ?? "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
