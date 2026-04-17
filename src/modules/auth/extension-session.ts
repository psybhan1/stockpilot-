/**
 * Browser-extension auth.
 *
 * Problem it solves: the main StockPilot session cookie is
 * `SameSite=Lax`, which means the browser won't include it on a
 * cross-origin fetch from a `chrome-extension://` popup — so every
 * API call from the extension would 401, even when the user is
 * signed in to StockPilot in the same profile.
 *
 * Fix: a dedicated `stockpilot_extension_session` cookie with
 * `SameSite=None; Secure` (prod) that the browser WILL send
 * cross-origin. It's minted by the signed-in user visiting the
 * wizard's "Use browser extension" tab (the tab auto-calls
 * /api/extension/link). Value is independent of the main session
 * token so stealing one doesn't give the other — tokens are hashed
 * with an "ext_" prefix before the Session.tokenHash lookup.
 *
 * We keep rows in the same `Session` table (no schema migration)
 * but the prefixing + different cookie name mean the two token
 * spaces can't collide or substitute for each other.
 */
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getHighestRole } from "@/lib/permissions";
import type { AuthSession } from "@/modules/auth/session";
import { getSession } from "@/modules/auth/session";

export const EXTENSION_COOKIE_NAME = "stockpilot_extension_session";
const EXT_HASH_PREFIX = "ext_";
const EXTENSION_SESSION_TTL_DAYS = 30;

function hashExtensionToken(token: string): string {
  return createHash("sha256")
    .update(EXT_HASH_PREFIX + token + env.SESSION_SECRET)
    .digest("hex");
}

/**
 * Mint an extension-scoped session cookie for the currently signed-in
 * user. Must be called from an authed HTTP context. The main session
 * cookie is not touched — both live side-by-side.
 *
 * Returns the extension session metadata (same AuthSession shape) so
 * callers can tell whose session was linked.
 */
export async function linkExtensionSession(): Promise<AuthSession> {
  const mainSession = await getSession();
  if (!mainSession) {
    throw new Error("Sign in to StockPilot first.");
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashExtensionToken(token);
  const expiresAt = new Date(
    Date.now() + EXTENSION_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
  );

  await db.session.create({
    data: {
      userId: mainSession.userId,
      tokenHash,
      expiresAt,
    },
  });

  const cookieStore = await cookies();
  const isProd = process.env.NODE_ENV === "production";
  cookieStore.set(EXTENSION_COOKIE_NAME, token, {
    httpOnly: true,
    // SameSite=None is what lets the cookie ride cross-origin from
    // the chrome-extension:// popup. Requires Secure, which is fine
    // in prod (StockPilot is HTTPS) and relaxed in dev so localhost
    // testing still works.
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    expires: expiresAt,
    path: "/",
  });

  return mainSession;
}

/**
 * Resolve the currently active extension session, if any. Reads the
 * extension cookie, verifies it against the Session table, returns
 * the AuthSession (same shape getSession returns) or null.
 *
 * Falls back to the main session cookie only in dev — in prod the
 * Lax main cookie won't make it across origins anyway, and relying
 * on it would mask bugs.
 */
export async function getExtensionSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(EXTENSION_COOKIE_NAME)?.value;
  if (!token) {
    // Dev convenience: fall back to the main session so local
    // development (where the extension popup and the dev server
    // share localhost and the Lax cookie can fly) still works.
    if (process.env.NODE_ENV !== "production") {
      return getSession();
    }
    return null;
  }

  const tokenHash = hashExtensionToken(token);
  const session = await db.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          roles: {
            include: {
              location: {
                include: { business: true },
              },
            },
          },
        },
      },
    },
  });

  if (!session || session.expiresAt < new Date()) {
    return null;
  }

  const primaryRole = session.user.roles[0];
  if (!primaryRole) return null;

  // Bump lastSeenAt so idle revocation can rely on it.
  await db.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() },
  });

  const role = getHighestRole(session.user.roles.map((entry) => entry.role));
  return {
    userId: session.user.id,
    userName: session.user.name,
    email: session.user.email,
    locationId: primaryRole.location.id,
    locationName: primaryRole.location.name,
    businessName: primaryRole.location.business.name,
    role,
  };
}

/**
 * Revoke the extension session — removes the row and clears the
 * cookie. Used by a (future) "disconnect this browser" button.
 */
export async function unlinkExtensionSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(EXTENSION_COOKIE_NAME)?.value;
  if (token) {
    const tokenHash = hashExtensionToken(token);
    await db.session.deleteMany({ where: { tokenHash } });
  }
  cookieStore.delete(EXTENSION_COOKIE_NAME);
}

/**
 * Test-only helper — exposes the hash function so test harnesses
 * can round-trip a known token through the Session table.
 */
export function _hashExtensionTokenForTests(token: string): string {
  return hashExtensionToken(token);
}
