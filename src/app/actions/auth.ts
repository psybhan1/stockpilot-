"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { getDefaultRouteForRole, getHighestRole } from "@/lib/permissions";
import { createSession, destroySession } from "@/modules/auth/session";
import { rateLimit } from "@/lib/rate-limit";

export async function loginAction(
  _previousState: { error?: string } | undefined,
  formData: FormData
) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const user = await db.user.findUnique({
    where: { email },
  });

  if (!user) {
    return { error: "No user found for that email." };
  }

  const valid = await bcrypt.compare(password, user.passwordHash);

  if (!valid) {
    return { error: "Incorrect password." };
  }

  const roles = await db.userLocationRole.findMany({
    where: { userId: user.id },
    select: { role: true },
  });

  await createSession(user.id);
  redirect(getDefaultRouteForRole(getHighestRole(roles.map((entry) => entry.role))));
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

/**
 * Self-signup for a new café. Creates Business + Location + User +
 * MANAGER role atomically, then logs the user in and redirects to
 * /onboarding.
 *
 * Validation rules (simple on purpose — this is a real-world B2B
 * signup, not a fortress):
 *   - email must parse and be unique
 *   - password ≥ 8 chars (bcrypt doesn't care about complexity; we
 *     nudge users toward long, not clever)
 *   - business name 2..80 chars
 *   - owner name 1..80 chars
 *   - timezone is picked up from the browser (Intl) or defaults to
 *     America/Toronto if the client doesn't send one
 *
 * Rate-limited by IP (5 signups per 10 min) so a scripted abuser
 * can't flood the business table.
 */
export async function signupAction(
  _previousState: { error?: string } | undefined,
  formData: FormData
) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const businessName = String(formData.get("businessName") ?? "").trim();
  const ownerName = String(formData.get("ownerName") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim() || "America/Toronto";

  // ── Validation ───────────────────────────────────────────────────
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address." };
  }
  if (!password || password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (!businessName || businessName.length < 2 || businessName.length > 80) {
    return { error: "Business name must be 2–80 characters." };
  }
  if (!ownerName || ownerName.length < 1 || ownerName.length > 80) {
    return { error: "Enter your name (1–80 characters)." };
  }

  // ── Rate limit by forwarded-for IP (or a generic bucket if no
  //    header is present — better than unlimited). ─────────────────
  const hdrs = await headers();
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    hdrs.get("x-real-ip") ||
    "anon";
  const rl = rateLimit({
    key: `signup:${ip}`,
    windowMs: 10 * 60 * 1000,
    max: 5,
  });
  if (!rl.allowed) {
    return {
      error: `Too many sign-ups from this network. Try again in ${rl.retryAfterSec}s.`,
    };
  }

  // ── Uniqueness ───────────────────────────────────────────────────
  const existingUser = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existingUser) {
    return {
      error:
        "An account already exists for that email. Sign in instead, or use a different email.",
    };
  }

  // Build a unique slug from the business name; fall back to a
  // random suffix if the simple slug is taken.
  const baseSlug =
    businessName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "business";
  let slug = baseSlug;
  for (let i = 0; i < 5; i += 1) {
    const taken = await db.business.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!taken) break;
    slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // ── Atomic create ───────────────────────────────────────────────
  const user = await db.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: { name: businessName, slug },
    });
    const location = await tx.location.create({
      data: {
        businessId: business.id,
        name: businessName, // single-location default; rename later
        timezone,
        isPrimary: true,
      },
    });
    const created = await tx.user.create({
      data: {
        email,
        name: ownerName,
        passwordHash,
      },
    });
    await tx.userLocationRole.create({
      data: {
        userId: created.id,
        locationId: location.id,
        role: "MANAGER",
      },
    });

    // Seed a typical café starter pack (~16 items) so the new user
    // lands on a dashboard that already has data flowing through it.
    // Blank tables are the #1 reason a first-time user bounces; this
    // gets them from "logged in" to "adjusting real stock levels" in
    // one step. Items they don't need are a tap to delete.
    const { seedStarterPackTx } = await import(
      "@/modules/onboarding/starter-pack"
    );
    await seedStarterPackTx(tx, location.id);

    return created;
  });

  await createSession(user.id);
  redirect("/onboarding");
}
