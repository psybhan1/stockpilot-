import { env } from "@/lib/env";
import type { PosProvider } from "@/providers/contracts";
import { FakeSquareProvider } from "@/providers/pos/fake-square";
import { SquareProvider } from "@/providers/pos/square";

/**
 * Use the REAL Square provider whenever Square credentials are
 * configured — either an OAuth app (client id + secret) or a
 * personal access token. Only fall back to the FakeSquareProvider
 * in dev, where nothing's set. The old behaviour forced admins to
 * set DEFAULT_POS_PROVIDER=square on top of Square creds, which
 * silently fake-connected if that flag was missed — that's what the
 * user saw as "Reconnect doesn't work".
 */
export function hasRealSquareCredentials(): boolean {
  return Boolean(
    (env.SQUARE_CLIENT_ID && env.SQUARE_CLIENT_SECRET) ||
      env.SQUARE_ACCESS_TOKEN
  );
}

export function getPosProvider(): PosProvider {
  if (env.DEFAULT_POS_PROVIDER === "square" || hasRealSquareCredentials()) {
    return new SquareProvider();
  }
  return new FakeSquareProvider();
}
