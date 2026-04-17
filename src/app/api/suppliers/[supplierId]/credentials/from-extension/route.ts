/**
 * POST /api/suppliers/[supplierId]/credentials/from-extension
 *
 * The StockPilot browser extension sends the cookies it just
 * captured from the user's normal browser session (via
 * chrome.cookies.getAll) here. We encrypt + store them on the
 * Supplier row, same as the pasted-JSON path does — just sourced
 * from the extension instead of a textarea.
 *
 * Request body:
 *   { cookies: [{ name, value, domain?, path?, expires?, httpOnly?, secure?, sameSite? }, ...] }
 *
 * Guardrails:
 *   - Session cookie must belong to a manager at the supplier's location.
 *   - Cookie count clamp (max 200) to stop a malicious extension from DoSing the encryption step.
 *   - Audit log entry with cookieCount; never log cookie values.
 */
import { NextResponse } from "next/server";

import { createAuditLogTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { Role } from "@/lib/domain-enums";
import {
  extensionOptionsResponse,
  withExtensionCors,
} from "@/lib/extension-cors";
import { getExtensionSession } from "@/modules/auth/extension-session";
import { hasMinimumRole } from "@/lib/permissions";
import {
  MAX_COOKIES,
  normaliseExtensionCookies,
} from "@/modules/suppliers/extension-cookies";
import { encryptSupplierCredentials } from "@/modules/suppliers/website-credentials";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return extensionOptionsResponse(request);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ supplierId: string }> }
) {
  const { supplierId } = await params;

  const session = await getExtensionSession();
  if (!session) {
    return withExtensionCors(
      request,
      NextResponse.json(
        {
          message:
            "This browser isn't linked to StockPilot yet. Open the Extension tab in the signin wizard once to link it.",
          needsLink: true,
        },
        { status: 401 }
      )
    );
  }
  if (!hasMinimumRole(session.role, Role.MANAGER)) {
    return withExtensionCors(
      request,
      NextResponse.json({ message: "Manager role required." }, { status: 403 })
    );
  }

  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, locationId: session.locationId },
    select: { id: true, name: true },
  });
  if (!supplier) {
    return withExtensionCors(
      request,
      NextResponse.json(
        { message: "Supplier not found at this location." },
        { status: 404 }
      )
    );
  }

  const body = (await request.json().catch(() => null)) as { cookies?: unknown } | null;
  if (!body || typeof body !== "object") {
    return withExtensionCors(
      request,
      NextResponse.json({ message: "Invalid request body." }, { status: 400 })
    );
  }

  const normalised = normaliseExtensionCookies(body.cookies);
  if (!normalised.ok) {
    return withExtensionCors(
      request,
      NextResponse.json(
        {
          message: `Provide 1–${MAX_COOKIES} cookies, each with a name and string value (${normalised.reason}).`,
        },
        { status: 400 }
      )
    );
  }
  const cookies = normalised.cookies;

  try {
    const encrypted = encryptSupplierCredentials({ kind: "cookies", cookies });
    await db.$transaction(async (tx) => {
      await tx.supplier.update({
        where: { id: supplier.id },
        data: {
          websiteCredentials: encrypted,
          credentialsConfigured: true,
        },
      });
      await createAuditLogTx(tx, {
        locationId: session.locationId,
        userId: session.userId,
        action: "supplier.credentials_set_via_extension",
        entityType: "supplier",
        entityId: supplier.id,
        details: { cookieCount: cookies.length },
      });
    });
    return withExtensionCors(
      request,
      NextResponse.json({
        ok: true,
        cookieCount: cookies.length,
        supplierName: supplier.name,
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return withExtensionCors(
      request,
      NextResponse.json({ message: message.slice(0, 200) }, { status: 500 })
    );
  }
}
