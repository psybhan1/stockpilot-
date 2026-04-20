import type { ReactNode } from "react";

import { AppShell } from "@/components/app/app-shell";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireSession();

  // Every location this user has a role at — feeds the location
  // switcher in the top bar. Hidden when there's only one.
  const roles = await db.userLocationRole.findMany({
    where: { userId: session.userId },
    select: {
      location: { select: { id: true, name: true } },
    },
    orderBy: { location: { name: "asc" } },
  });
  const accessibleLocations = roles
    .map((r) => ({ id: r.location.id, name: r.location.name }))
    .filter((v, i, arr) => arr.findIndex((x) => x.id === v.id) === i);

  return (
    <AppShell
      session={{
        businessName: session.businessName,
        userName: session.userName,
        role: session.role,
        locationName: session.locationName,
        locationId: session.locationId,
      }}
      locations={accessibleLocations}
      autoRefreshMs={env.APP_AUTO_REFRESH_MS}
      assistantPanel={null}
    >
      {children}
    </AppShell>
  );
}
