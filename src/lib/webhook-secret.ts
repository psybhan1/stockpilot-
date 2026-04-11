import { timingSafeEqual } from "node:crypto";

function normalizeSecret(value: string | null | undefined) {
  return value?.trim() ?? "";
}

export function isWebhookSecretValid(
  requestHeaders: Headers,
  expectedSecret?: string | null
) {
  const normalizedExpected = normalizeSecret(expectedSecret);

  if (!normalizedExpected) {
    return true;
  }

  const providedSecret = normalizeSecret(
    requestHeaders.get("x-stockpilot-webhook-secret")
  );

  if (!providedSecret) {
    return false;
  }

  const expectedBuffer = Buffer.from(normalizedExpected);
  const providedBuffer = Buffer.from(providedSecret);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
