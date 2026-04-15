import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { requireSession } from "@/modules/auth/session";
import { Role } from "@/lib/domain-enums";
import { env } from "@/lib/env";

// Use the narrow sensitive scopes (send + readonly) instead of the
// full-mailbox restricted scope `https://mail.google.com/`. The
// restricted scope is silently downgraded for unverified apps,
// which causes 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT on send.
//   - gmail.send      → users.messages.send (PO emails out)
//   - gmail.readonly  → threads.get          (supplier reply poller)
const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
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
