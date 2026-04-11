import { createHmac, timingSafeEqual } from "node:crypto";

export function isValidTwilioWebhook(input: {
  authToken?: string;
  signature: string | null;
  url: string;
  formFields: URLSearchParams;
}) {
  if (!input.authToken) {
    return true;
  }

  if (!input.signature) {
    return false;
  }

  const payload = `${input.url}${[...input.formFields.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}${value}`)
    .join("")}`;
  const expectedSignature = createHmac("sha1", input.authToken)
    .update(payload)
    .digest("base64");

  return safeCompare(expectedSignature, input.signature);
}

export function buildTwimlMessageResponse(message: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(
    message
  )}</Message></Response>`;
}

export function buildTwimlEmptyResponse() {
  return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
