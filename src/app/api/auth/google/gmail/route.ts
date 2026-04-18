import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { requireSession } from "@/modules/auth/session";
import { Role } from "@/lib/domain-enums";
import { env } from "@/lib/env";

// Only request `gmail.send` (sensitive) — we deliberately do NOT
// request `gmail.readonly` anymore. readonly is a RESTRICTED scope,
// which would force Google's CASA security assessment (~$4-15k +
// months) before we could publish the OAuth consent screen to any
// user outside our test-user list. Supplier reply detection moved
// from the Gmail thread poller to the inbound-email webhook
// (src/app/api/inbound/email/route.ts) — same behavior, no need to
// read the user's mailbox.
//   - gmail.send      → users.messages.send (PO emails out)
//   - userinfo.email  → identify which Gmail address we connected
const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export async function GET(_req: NextRequest) {
  await requireSession(Role.MANAGER);

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    redirect(
      `/settings?channelConnect=error&channelType=email&channelDetail=${encodeURIComponent(
        "Google OAuth is not configured. Ask your admin to add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
      )}`
    );
  }

  const callbackUrl = `${env.APP_URL}/api/auth/google/gmail/callback`;

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: GMAIL_SCOPES,
    access_type: "offline",
    prompt: "consent",
  });

  redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
