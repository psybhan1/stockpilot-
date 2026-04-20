import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/modules/auth/session";
import { Role } from "@/lib/domain-enums";
import { env } from "@/lib/env";
import { connectGmailChannel } from "@/modules/channels/service";

export async function GET(req: NextRequest) {
  const session = await requireSession(Role.MANAGER);
  const { searchParams } = new URL(req.url);

  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(
      `${env.APP_URL}/settings?channelConnect=error&channelType=email&channelDetail=${encodeURIComponent(
        error === "access_denied" ? "Google sign-in was cancelled." : "Google sign-in failed. Please try again."
      )}`
    );
  }

  const callbackUrl = `${env.APP_URL}/api/auth/google/gmail/callback`;

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: callbackUrl,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(
      `${env.APP_URL}/settings?channelConnect=error&channelType=email&channelDetail=${encodeURIComponent(
        "Failed to get Google tokens. Please try again."
      )}`
    );
  }

  const tokens = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  // Get the user's email address
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  const profile = profileRes.ok
    ? await profileRes.json() as { email?: string }
    : null;

  await connectGmailChannel(session.locationId, {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? "",
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    email: profile?.email ?? "",
  });

  return NextResponse.redirect(
    `${env.APP_URL}/settings?channelConnect=connected&channelType=email&channelDetail=${encodeURIComponent(
      profile?.email ?? "Gmail connected"
    )}`
  );
}
