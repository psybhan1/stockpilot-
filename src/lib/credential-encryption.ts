/**
 * Symmetric AES-256-GCM encryption for website login credentials
 * stored in Supplier.metadata. The key is derived from
 * N8N_WEBHOOK_SECRET (reuse existing secret so no new env var).
 *
 * Format: "enc:v1:<iv-hex>:<tag-hex>:<ciphertext-hex>"
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm" as const;

function deriveKey(): Buffer {
  const secret = env.N8N_WEBHOOK_SECRET ?? "";
  if (!secret) throw new Error("N8N_WEBHOOK_SECRET must be set for credential encryption.");
  return createHash("sha256").update(secret).digest();
}

export function encryptCredential(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptCredential(encoded: string): string {
  if (!encoded.startsWith(PREFIX)) {
    // Not encrypted — return as-is (for backwards compatibility
    // or plaintext dev values).
    return encoded;
  }
  const parts = encoded.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Malformed encrypted credential.");
  const [ivHex, tagHex, ctHex] = parts;
  const key = deriveKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}
