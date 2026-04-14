import type { ReactNode } from "react";

import { AppShell } from "@/components/app/app-shell";
import { env } from "@/lib/env";
import { requireSession } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireSession();

  return (
    <AppShell
      session={{
        businessName: session.businessName,
        userName: session.userName,
        role: session.role,
        locationName: session.locationName,
      }}
      autoRefreshMs={env.APP_AUTO_REFRESH_MS}
      assistantPanel={null}
    >
      {children}
    </AppShell>
  );
}
