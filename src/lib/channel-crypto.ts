/**
 * AES-256-GCM encryption for per-location channel credentials.
 *
 * Master key: CHANNEL_ENCRYPTION_KEY env var (32 hex-encoded bytes = 64 chars).
 * Falls back to SESSION_SECRET for local dev (not secure — always set the env var
 * in production).
 *
 * Encrypted format: base64( iv[12] + authTag[16] + ciphertext )
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard nonce
const TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  const raw = process.env.CHANNEL_ENCRYPTION_KEY ?? process.env.SESSION_SECRET ?? "local-dev-fallback-key-not-secure";
  // Always derive a 32-byte key via SHA-256 so any string length works
  return createHash("sha256").update(raw).digest();
}

export function encryptCredentials(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack: iv | authTag | ciphertext → base64
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptCredentials(encoded: string): string {
  const key = getMasterKey();
  const buf = Buffer.from(encoded, "base64");

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function encryptJson(data: Record<string, unknown>): string {
  return encryptCredentials(JSON.stringify(data));
}

export function decryptJson<T = Record<string, unknown>>(encoded: string): T {
  return JSON.parse(decryptCredentials(encoded)) as T;
}
