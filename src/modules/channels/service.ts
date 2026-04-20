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
import { sendWhatsAppMessage } from "@/lib/whatsapp-bot";

export { ChannelType };

// Pairing code helpers live in ./pairing-codes so they can be unit-
// tested without pulling Prisma into the test compile.
import { generatePairingCode, pairingCodeExpiresAt } from "./pairing-codes";
export { generatePairingCode, pairingCodeExpiresAt };

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
// WhatsApp
// ---------------------------------------------------------------------------

export async function startWhatsAppChannelPairing(locationId: string) {
  const code = generatePairingCode();
  const expiresAt = pairingCodeExpiresAt();

  await db.locationChannel.upsert({
    where: { locationId_channel: { locationId, channel: ChannelType.WHATSAPP } },
    create: {
      locationId,
      channel: ChannelType.WHATSAPP,
      enabled: false,
      pairingCode: code,
      pairingExpiresAt: expiresAt,
    },
    update: {
      pairingCode: code,
      pairingExpiresAt: expiresAt,
      whatsappPhone: null,
      enabled: false,
    },
  });

  return { code, expiresAt };
}

/**
 * Called by the WhatsApp bot handler when it receives a message matching
 * the pairing code pattern (e.g. "SB-AB1234").
 */
export async function completeWhatsAppChannelPairing(input: {
  pairingCode: string;
  phone: string;
  senderDisplayName?: string | null;
}): Promise<{ ok: true; locationName: string } | { ok: false; reason: string }> {
  const row = await db.locationChannel.findFirst({
    where: { pairingCode: input.pairingCode, channel: ChannelType.WHATSAPP },
    include: { location: { select: { name: true } } },
  });

  if (!row) return { ok: false, reason: "Code not found" };
  if (!row.pairingExpiresAt || row.pairingExpiresAt < new Date()) {
    return { ok: false, reason: "Code expired" };
  }

  // Normalise to E.164, strip whatsapp: prefix if present
  const normalizedPhone = input.phone.replace(/^whatsapp:/i, "");

  await db.locationChannel.update({
    where: { id: row.id },
    data: {
      whatsappPhone: normalizedPhone,
      enabled: true,
      pairingCode: null,
      pairingExpiresAt: null,
    },
  });

  return { ok: true, locationName: row.location.name };
}

export async function disconnectWhatsAppChannel(locationId: string) {
  await db.locationChannel.updateMany({
    where: { locationId, channel: ChannelType.WHATSAPP },
    data: {
      whatsappPhone: null,
      enabled: false,
      pairingCode: null,
      pairingExpiresAt: null,
    },
  });
}

export async function sendWhatsAppChannelMessage(locationId: string, text: string) {
  const row = await db.locationChannel.findUnique({
    where: { locationId_channel: { locationId, channel: ChannelType.WHATSAPP } },
  });

  if (!row?.enabled || !row.whatsappPhone) {
    throw new Error(`WhatsApp channel not connected for location ${locationId}`);
  }

  await sendWhatsAppMessage(row.whatsappPhone, text);
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

/**
 * Persist a freshly-refreshed Gmail access token back to the channel.
 * Called by GmailEmailProvider after exchanging the refresh token for
 * a new short-lived access token — so the next send doesn't have to
 * refresh again immediately.
 */
export async function updateGmailAccessToken(
  locationId: string,
  patch: { accessToken: string; expiresAt: number }
) {
  const existing = await getGmailCredentials(locationId);
  if (!existing) return;
  const next: GmailCredentials = {
    ...existing,
    accessToken: patch.accessToken,
    expiresAt: patch.expiresAt,
  };
  const credentialsEncrypted = encryptJson(next as unknown as Record<string, unknown>);
  await db.locationChannel.update({
    where: { locationId_channel: { locationId, channel: ChannelType.EMAIL_GMAIL } },
    data: { credentialsEncrypted },
  });
}

// ---------------------------------------------------------------------------
// Email — Resend (API-key based, no OAuth)
// ---------------------------------------------------------------------------

export type ResendCredentials = {
  apiKey: string;
  fromEmail: string;
  /** Optional explicit display name. When omitted, the location's
   * business/location name is used at send time. */
  displayName?: string;
};

export async function connectResendEmailChannel(
  locationId: string,
  creds: ResendCredentials
) {
  const credentialsEncrypted = encryptJson(creds as unknown as Record<string, unknown>);

  await db.locationChannel.upsert({
    where: { locationId_channel: { locationId, channel: ChannelType.EMAIL_RESEND } },
    create: {
      locationId,
      channel: ChannelType.EMAIL_RESEND,
      enabled: true,
      emailAddress: creds.fromEmail,
      emailProvider: "resend",
      credentialsEncrypted,
    },
    update: {
      enabled: true,
      emailAddress: creds.fromEmail,
      emailProvider: "resend",
      credentialsEncrypted,
    },
  });
}

export async function getResendCredentials(
  locationId: string
): Promise<ResendCredentials | null> {
  const row = await db.locationChannel.findUnique({
    where: { locationId_channel: { locationId, channel: ChannelType.EMAIL_RESEND } },
  });

  if (!row?.enabled || !row.credentialsEncrypted) return null;

  try {
    return decryptJson<ResendCredentials>(row.credentialsEncrypted);
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
  const whatsapp = find(ChannelType.WHATSAPP);
  const smtp = find(ChannelType.EMAIL_SMTP);
  const gmail = find(ChannelType.EMAIL_GMAIL);
  const resend = find(ChannelType.EMAIL_RESEND);

  return {
    telegram: telegram
      ? {
          enabled: telegram.enabled,
          chatId: telegram.telegramChatId,
          pairingCode: telegram.pairingCode,
          pairingExpiresAt: telegram.pairingExpiresAt,
        }
      : null,
    whatsapp: whatsapp
      ? {
          enabled: whatsapp.enabled,
          phone: whatsapp.whatsappPhone,
          pairingCode: whatsapp.pairingCode,
          pairingExpiresAt: whatsapp.pairingExpiresAt,
        }
      : null,
    email: gmail?.enabled
      ? { provider: "gmail" as const, address: gmail.emailAddress }
      : resend?.enabled
        ? { provider: "resend" as const, address: resend.emailAddress }
        : smtp?.enabled
          ? { provider: "smtp" as const, address: smtp.emailAddress }
          : null,
  };
}
