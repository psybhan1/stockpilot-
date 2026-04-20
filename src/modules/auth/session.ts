import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Role } from "@/lib/domain-enums";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getHighestRole, hasMinimumRole } from "@/lib/permissions";

const SESSION_COOKIE = "stockpilot_session";
const ACTIVE_LOCATION_COOKIE = "stockpilot_active_location";
const SESSION_TTL_DAYS = 30;

export async function setActiveLocationCookie(locationId: string) {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_LOCATION_COOKIE, locationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    path: "/",
  });
}

export type AuthSession = {
  userId: string;
  userName: string;
  email: string;
  locationId: string;
  locationName: string;
  businessName: string;
  role: Role;
};

function hashToken(token: string) {
  return createHash("sha256").update(token + env.SESSION_SECRET).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.session.deleteMany({
      where: {
        tokenHash: hashToken(token),
      },
    });
  }

  cookieStore.delete(SESSION_COOKIE);

  // Also revoke the browser-extension session when the user signs
  // out — otherwise the extension cookie would remain valid for
  // its 30-day TTL, meaning a logout wouldn't actually log the
  // extension out.
  const { unlinkExtensionSession } = await import(
    "@/modules/auth/extension-session"
  );
  await unlinkExtensionSession().catch(() => null);
}

export const getSession = cache(async (): Promise<AuthSession | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  const session = await db.session.findUnique({
    where: {
      tokenHash: hashToken(token),
    },
    include: {
      user: {
        include: {
          roles: {
            include: {
              location: {
                include: {
                  business: true,
                },
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

  // Allow the user to switch which location is "active" via a
  // separate cookie. We only accept an id that matches one of their
  // own roles — a forged or stale cookie just falls back to the
  // first role on the account.
  const activeLocationCookie = cookieStore.get(ACTIVE_LOCATION_COOKIE)?.value;
  const activeRole = activeLocationCookie
    ? session.user.roles.find((r) => r.location.id === activeLocationCookie)
    : null;
  const primaryRole = activeRole ?? session.user.roles[0];

  if (!primaryRole) {
    return null;
  }

  await db.session.update({
    where: {
      id: session.id,
    },
    data: {
      lastSeenAt: new Date(),
    },
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
});

export async function requireSession(minimumRole?: Role) {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  if (minimumRole && !hasMinimumRole(session.role, minimumRole)) {
    redirect("/dashboard?forbidden=1");
  }

  return session;
}

