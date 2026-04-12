/**
 * Per-tenant channel service.
 *
 * Each Location can independently connect/disconnect channels.
 * Credentials (tokens, SMTP passwords, etc.) are encrypted with AES-256-GCM
 * using channel-crypto.ts before being stored.
 */

import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { ChannelType } from "@/generated/prisma-postgres";
import { decryptJson, encryptJson } from "@/lib/channel-crypto";
import { sendTelegramMessage } from "@/lib/telegram-bot";

export { ChannelType };

const PAIRING_CODE_TTL_MINUTES = 15;

// ---------------------------------------------------------------------------
// Pairing code helpers
// ---------------------------------------------------------------------------

export function generatePairingCode(): string {
  // 6 uppercase alphanumeric chars — easy to type
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

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

export async function startTelegramChannelPairing(locationId: string) {
  const code = generatePairingCode();
  const expiresAt = pairingCodeExpiresAt();

  await db.locationChannel.upsert({
    where: { locationId_channel: { locationId, channel: ChannelType.TELEGRAM } },
    create: {
      locationId,
      channel: ChannelType.TELEGRAM,
      enabled: false,
      pairingCode: code,
      pairingExpiresAt: expiresAt,
    },
    update: {
      pairingCode: code,
      pairingExpiresAt: expiresAt,
      // Reset previous connection so manager must re-pair
      telegramChatId: null,
      enabled: false,
    },
  });

  return { code, expiresAt };
}

/**
 * Called by the Telegram bot handler when it receives a message matching
 * the pairing code pattern (e.g. "SB-AB1234").
 *
 * Returns the name of the location on success, or null if code is invalid/expired.
 */
export async function completeTelegramChannelPairing(input: {
  pairingCode: string;
  chatId: string;
  senderDisplayName?: string | null;
}): Promise<{ ok: true; locationName: string } | { ok: false; reason: string }> {
  const row = await db.locationChannel.findFirst({
    where: { pairingCode: input.pairingCode, channel: ChannelType.TELEGRAM },
    include: { location: { select: { name: true } } },
  });

  if (!row) {
    return { ok: false, reason: "Code not found" };
  }

  if (!row.pairingExpiresAt || row.pairingExpiresAt < new Date()) {
    return { ok: false, reason: "Code expired" };
  }

  await db.locationChannel.update({
    where: { id: row.id },
    data: {
      telegramChatId: input.chatId,
      enabled: true,
      pairingCode: null,
      pairingExpiresAt: null,
    },
  });

  return { ok: true, locationName: row.location.name };
}

export async function disconnectTelegramChannel(locationId: string) {
  await db.locationChannel.updateMany({
    where: { locationId, channel: ChannelType.TELEGRAM },
    data: {
      telegramChatId: null,
      enabled: false,
      pairingCode: null,
      pairingExpiresAt: null,
    },
  });
}

export async function sendTelegramChannelMessage(locationId: string, text: string) {
  const row = await db.locationChannel.findUnique({
    where: { locationId_channel: { locationId, channel: ChannelType.TELEGRAM } },
  });

  if (!row?.enabled || !row.telegramChatId) {
    throw new Error(`Telegram channel not connected for location ${locationId}`);
  }

  await sendTelegramMessage(row.telegramChatId, text);
}

// ---------------------------------------------------------------------------
// Email — SMTP
// ---------------------------------------------------------------------------

export type SmtpCredentials = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
};

export async function connectSmtpEmailChannel(
  locationId: string,
  creds: SmtpCredentials
) {
  const credentialsEncrypted = encryptJson(creds as unknown as Record<string, unknown>);

  await db.locationChannel.upsert({
    where: { locationId_channel: { locationId, channel: ChannelType.EMAIL_SMTP } },
    create: {
      locationId,
      channel: ChannelType.EMAIL_SMTP,
      enabled: true,
      emailAddress: creds.fromEmail,
      emailProvider: "smtp",
      credentialsEncrypted,
    },
    update: {
      enabled: true,
      emailAddress: creds.fromEmail,
      emailProvider: "smtp",
      credentialsEncrypted,
    },
  });
}

export async function getSmtpCredentials(locationId: string): Promise<SmtpCredentials | null> {
  const row = await db.locationChannel.findUnique({
    where: { locationId_channel: { locationId, channel: ChannelType.EMAIL_SMTP } },
  });

  if (!row?.enabled || !row.credentialsEncrypted) return null;

  try {
    return decryptJson<SmtpCredentials>(row.credentialsEncrypted);
  } catch {
    return null;
  }
}

export async function disconnectEmailChannel(
  locationId: string,
  channel: ChannelType
) {
  await db.locationChannel.updateMany({
    where: { locationId, channel },
    data: {
      enabled: false,
      emailAddress: null,
      credentialsEncrypted: null,
    },
  });
}

// ---------------------------------------------------------------------------
// Email — Gmail OAuth
// ---------------------------------------------------------------------------

export type GmailCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
  email: string;
};

export async function connectGmailChannel(locationId: string, creds: GmailCredentials) {
  const credentialsEncrypted = encryptJson(creds as unknown as Record<string, unknown>);

  await db.locationChannel.upsert({
    where: { locationId_channel: { locationId, channel: ChannelType.EMAIL_GMAIL } },
    create: {
      locationId,
      channel: ChannelType.EMAIL_GMAIL,
      enabled: true,
      emailAddress: creds.email,
      emailProvider: "gmail",
      credentialsEncrypted,
    },
    update: {
      enabled: true,
      emailAddress: creds.email,
      emailProvider: "gmail",
      credentialsEncrypted,
    },
  });
}

export async function getGmailCredentials(locationId: string): Promise<GmailCredentials | null> {
  const row = await db.locationChannel.findUnique({
    where: { locationId_channel: { locationId, channel: ChannelType.EMAIL_GMAIL } },
  });

  if (!row?.enabled || !row.credentialsEncrypted) return null;

  try {
    return decryptJson<GmailCredentials>(row.credentialsEncrypted);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Generic channel status query
// ---------------------------------------------------------------------------

export async function getLocationChannels(locationId: string) {
  const rows = await db.locationChannel.findMany({
    where: { locationId },
  });

  const find = (channel: ChannelType) => rows.find((r) => r.channel === channel);

  const telegram = find(ChannelType.TELEGRAM);
  const smtp = find(ChannelType.EMAIL_SMTP);
  const gmail = find(ChannelType.EMAIL_GMAIL);

  return {
    telegram: telegram
      ? {
          enabled: telegram.enabled,
          chatId: telegram.telegramChatId,
          pairingCode: telegram.pairingCode,
          pairingExpiresAt: telegram.pairingExpiresAt,
        }
      : null,
    email: smtp?.enabled
      ? { provider: "smtp" as const, address: smtp.emailAddress }
      : gmail?.enabled
        ? { provider: "gmail" as const, address: gmail.emailAddress }
        : null,
  };
}
