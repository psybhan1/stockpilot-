/**
 * Pure helpers for the channel pairing flow. Separated from
 * service.ts (which imports Prisma) so they can be unit-tested in
 * isolation.
 */

const PAIRING_CODE_TTL_MINUTES = 15;

export function generatePairingCode(): string {
  // 6 uppercase alphanumeric chars — easy to type.
  // Alphabet excludes 0/O and 1/I/l to avoid character confusion
  // when a manager reads the code off their phone screen.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "SB-";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function pairingCodeExpiresAt(): Date {
  return new Date(Date.now() + PAIRING_CODE_TTL_MINUTES * 60_000);
}
