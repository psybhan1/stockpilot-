import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { requireSession } from "@/modules/auth/session";
import { Role } from "@/lib/domain-enums";
import { env } from "@/lib/env";

const GMAIL_SCOPES = [
  "https://mail.google.com/",
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
