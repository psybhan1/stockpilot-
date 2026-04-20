/**
 * GET /api/suppliers/extension/list
 *
 * Used by the StockPilot browser extension to populate its supplier
 * picker. Authed via the standard StockPilot session cookie — the
 * extension calls this with `credentials: "include"` from its popup,
 * so the cookie tags along. We only expose what the popup needs:
 * id, name, and website (for auto-matching the active tab's host).
 *
 * We also reply to OPTIONS preflights so chrome-extension:// origins
 * can actually reach us with credentials (see `lib/extension-cors`).
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  extensionOptionsResponse,
  withExtensionCors,
} from "@/lib/extension-cors";
import { getExtensionSession } from "@/modules/auth/extension-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return extensionOptionsResponse(request);
}

export async function GET(request: Request) {
  const session = await getExtensionSession();
  if (!session) {
    return withExtensionCors(
      request,
      NextResponse.json(
        {
          message:
            "This browser isn't linked to StockPilot yet. Open the Extension tab on any supplier's sign-in page in StockPilot — it auto-links once you're signed in.",
          needsLink: true,
        },
        { status: 401 }
      )
    );
  }

  const suppliers = await db.supplier.findMany({
    where: { locationId: session.locationId },
    select: {
      id: true,
      name: true,
      website: true,
      credentialsConfigured: true,
    },
    orderBy: { name: "asc" },
  });

  return withExtensionCors(
    request,
    NextResponse.json({
      locationName: session.locationName,
      suppliers: suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        website: s.website,
        connected: s.credentialsConfigured,
      })),
    })
  );
}
