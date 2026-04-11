import { env } from "@/lib/env";
import type { PosProvider } from "@/providers/contracts";
import { FakeSquareProvider } from "@/providers/pos/fake-square";
import { SquareProvider } from "@/providers/pos/square";

export function getPosProvider(): PosProvider {
  return env.DEFAULT_POS_PROVIDER === "square"
    ? new SquareProvider()
    : new FakeSquareProvider();
}
