/**
 * GET /extension/connect — the browser extension's "link this
 * browser" button opens this URL in a new tab. It mints the
 * extension session cookie (route handlers CAN set cookies, unlike
 * server components) and returns a minimal HTML success page the
 * user can close.
 *
 * Kept as a route handler (not a page) specifically because
 * `cookieStore.set()` isn't allowed from a Server Component.
 */
import { NextResponse } from "next/server";

import { createAuditLogTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { Role } from "@/lib/domain-enums";
import { hasMinimumRole } from "@/lib/permissions";
import { linkExtensionSession } from "@/modules/auth/extension-session";
import { getSession } from "@/modules/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function htmlResponse(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page({
  title,
  icon,
  iconColor,
  headline,
  body,
  tail,
}: {
  title: string;
  icon: string;
  iconColor: string;
  headline: string;
  body: string;
  tail: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escape(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; color: #111; margin: 0; padding: 48px 16px; display: flex; justify-content: center; }
    .card { max-width: 460px; width: 100%; padding: 28px; border: 1px solid #e5e7eb; border-radius: 14px; text-align: center; }
    .icon { width: 56px; height: 56px; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 700; margin: 0 auto 16px; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p { color: #555; line-height: 1.45; margin: 0 0 14px; }
    .tail { color: #888; font-size: 13px; margin-top: 18px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon" style="background: ${iconColor};">${escape(icon)}</div>
    <h1>${escape(headline)}</h1>
    <div>${body}</div>
    <p class="tail">${tail}</p>
  </div>
</body>
</html>`;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    const next = new URL(request.url).pathname;
    return NextResponse.redirect(
      new URL(`/login?redirect=${encodeURIComponent(next)}`, request.url)
    );
  }
  if (!hasMinimumRole(session.role, Role.MANAGER)) {
    return htmlResponse(
      page({
        title: "StockPilot — manager role required",
        icon: "!",
        iconColor: "#d97706",
        headline: "Manager role required.",
        body: `<p>Only managers can link a browser to StockPilot. Ask your manager to sign in and visit this page, or ask them to grant you the manager role first.</p>`,
        tail:
          "Signed in as " +
          escape(session.userName) +
          " (" +
          escape(session.role) +
          ").",
      }),
      403
    );
  }

  try {
    await linkExtensionSession();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return htmlResponse(
      page({
        title: "StockPilot — link failed",
        icon: "!",
        iconColor: "#dc2626",
        headline: "Couldn't link this browser.",
        body: `<p>${escape(message)}</p>`,
        tail:
          'Try reloading this page. If it keeps failing, the extension will still work with the "Paste cookies" tab in the sign-in wizard as a fallback.',
      }),
      500
    );
  }

  // Best-effort audit — don't fail the user-facing link step if
  // the audit write blows up (e.g. schema drift in a side table).
  await db
    .$transaction((tx) =>
      createAuditLogTx(tx, {
        locationId: session.locationId,
        userId: session.userId,
        action: "extension.session_linked",
        entityType: "user",
        entityId: session.userId,
        details: { source: "connect-page" },
      })
    )
    .catch(() => null);

  return htmlResponse(
    page({
      title: "StockPilot — browser linked",
      icon: "✓",
      iconColor: "#16a34a",
      headline: "This browser is linked to StockPilot.",
      body: `<p>Signed in as <strong>${escape(session.userName)}</strong> at <strong>${escape(session.locationName)}</strong>. You can close this tab and use the StockPilot extension now.</p>`,
      tail:
        "The link is valid for 30 days on this browser. Revisit this page any time to refresh it.",
    })
  );
}
