import { NextResponse } from "next/server";

import { db } from "@/lib/db";

/**
 * Serve an inventory item's stored image bytes. Public endpoint — the
 * content isn't sensitive (just product photos), and caching here
 * lets <img src="/api/inventory/X/image"> work in emails too.
 *
 * Returns 404 when no bytes exist so the UI can fall back to the
 * placeholder / POS catalog URL cleanly.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await context.params;

  const item = await db.inventoryItem.findUnique({
    where: { id: itemId },
    select: { imageBytes: true, imageContentType: true },
  });

  if (!item?.imageBytes) {
    return new NextResponse("Not found", { status: 404 });
  }

  const contentType = item.imageContentType ?? "image/jpeg";
  return new NextResponse(Buffer.from(item.imageBytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Cache forever — image bytes are immutable per SKU. When the
      // user uploads a new one we'll cache-bust with a query string
      // from the calling component.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
