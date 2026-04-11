import { redirect } from "next/navigation";

import { getDefaultRouteForRole } from "@/lib/permissions";
import { getSession } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();

  redirect(session ? getDefaultRouteForRole(session.role) : "/login");
}
