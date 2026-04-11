"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { getDefaultRouteForRole, getHighestRole } from "@/lib/permissions";
import { createSession, destroySession } from "@/modules/auth/session";

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
