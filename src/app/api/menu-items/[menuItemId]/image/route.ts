import { NextResponse } from "next/server";

import { db } from "@/lib/db";

export async function GET(
  _request: Request,
  context: { params: Promise<{ menuItemId: string }> }
) {
  const { menuItemId } = await context.params;
  const item = await db.menuItem.findUnique({
    where: { id: menuItemId },
    select: { imageBytes: true, imageContentType: true },
  });
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
