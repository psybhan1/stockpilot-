/**
 * Live health check for a Square integration.
 *
 * "Connected" in our DB doesn't mean "token still works". Refresh
 * failures, revoked tokens, and "we deleted the OAuth app" silently
 * leave the integration flagged CONNECTED but every subsequent
 * webhook/sync 401s. This ping calls Square's /merchants/me with
 * the stored access token — if it responds 200 the token is live;
 * a 401 / 403 / 5xx surfaces the breakage on the Settings page so
 * the owner can Reconnect instead of staring at a green dot.
 *
 * Wrapped in a short timeout so Settings never hangs on a slow
 * Square API response.
 */

import { decryptSecret } from "@/lib/secrets";
import { env } from "@/lib/env";
import { db } from "@/lib/db";

export type SquareHealth =
  | { status: "not_connected" }
  | { status: "healthy"; merchantId: string | null; checkedAt: Date }
  | { status: "token_dead"; httpStatus: number; checkedAt: Date }
  | { status: "unreachable"; reason: string; checkedAt: Date };

export async function checkSquareHealth(locationId: string): Promise<SquareHealth> {
  const integration = await db.posIntegration.findFirst({
    where: {
      locationId,
      provider: "SQUARE",
      status: "CONNECTED",
    },
    select: {
      accessTokenEncrypted: true,
      sandbox: true,
      externalMerchantId: true,
    },
  });

  if (!integration) return { status: "not_connected" };

  let accessToken: string | null = null;
  if (integration.accessTokenEncrypted) {
    try {
      accessToken = decryptSecret(integration.accessTokenEncrypted);
    } catch {
      // corrupted ciphertext → treat as dead
      return {
        status: "token_dead",
        httpStatus: 0,
        checkedAt: new Date(),
      };
    }
  } else if (env.SQUARE_ACCESS_TOKEN) {
    accessToken = env.SQUARE_ACCESS_TOKEN;
  }
  if (!accessToken) {
    return { status: "not_connected" };
  }

  const baseUrl = integration.sandbox
    ? "https://connect.squareupsandbox.com/v2"
    : "https://connect.squareup.com/v2";

  try {
    const res = await fetch(`${baseUrl}/merchants/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": env.SQUARE_API_VERSION,
      },
      signal: AbortSignal.timeout(3_000),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        merchant?: { id?: string };
      };
      return {
        status: "healthy",
        merchantId: body.merchant?.id ?? integration.externalMerchantId ?? null,
        checkedAt: new Date(),
      };
    }
    return {
      status: "token_dead",
      httpStatus: res.status,
      checkedAt: new Date(),
    };
  } catch (err) {
    return {
      status: "unreachable",
      reason:
        err instanceof Error
          ? err.message.slice(0, 120)
          : "unknown network failure",
      checkedAt: new Date(),
    };
  }
}
