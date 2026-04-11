import { NextResponse } from "next/server";

import { completeSquareOAuth } from "@/modules/pos/service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const integrationId = state?.split(".")[0];

  if (error) {
    return NextResponse.redirect(
      new URL(`/settings?square=error&reason=${encodeURIComponent(error)}`, url.origin)
    );
  }

  if (!code || !state || !integrationId) {
    return NextResponse.redirect(
      new URL("/settings?square=missing_code", url.origin)
    );
  }

  try {
    await completeSquareOAuth({
      integrationId,
      state,
      code,
    });

    return NextResponse.redirect(new URL("/settings?square=connected", url.origin));
  } catch (oauthError) {
    const message =
      oauthError instanceof Error ? oauthError.message : "oauth_failed";
    return NextResponse.redirect(
      new URL(`/settings?square=error&reason=${encodeURIComponent(message)}`, url.origin)
    );
  }
}
