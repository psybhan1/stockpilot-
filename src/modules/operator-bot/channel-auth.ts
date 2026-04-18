/**
 * Shared auth-flow helpers for every bot channel (Telegram / WhatsApp /
 * anything we add next). Keeps the regex + reply copy in one place so a
 * third channel (SMS, Slack, Discord) only has to wire I/O.
 *
 * What lives here:
 *   - LOCATION_PAIRING_CODE_PATTERN: the SB-XXXXXX regex — was literally
 *     duplicated across telegram/route.ts and whatsapp/route.ts.
 *   - readLocationPairingCode(): parse a message into a pairing code.
 *   - pairingReplyText(): format the result of a pairing attempt into a
 *     user-visible string, so adding a new channel doesn't mean copy-
 *     pasting "✅ connected" / "⏱ expired" / "❌ bad code" three more times.
 */

/** SB- followed by 6 alphanumerics. Hyphen-separated, case-insensitive. */
export const LOCATION_PAIRING_CODE_PATTERN = /^(SB-[A-Z0-9]{6})$/i;

/** Returns an upper-cased pairing code, or null if `text` is not a pairing code. */
export function readLocationPairingCode(text: string): string | null {
  const match = text.trim().match(LOCATION_PAIRING_CODE_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

export type PairingResult =
  | { ok: true; locationName: string }
  | { ok: false; reason: string };

export type ChannelLabel = "Telegram" | "WhatsApp" | "SMS" | "Slack" | "Discord";

/**
 * One string template for all pairing outcomes. Channels differ in how
 * they *send* the reply (TwiML vs Bot API), not in what the reply says.
 */
export function pairingReplyText(
  result: PairingResult,
  channelLabel: ChannelLabel,
): string {
  if (result.ok) {
    return `✅ This ${channelLabel} chat is now connected to *${result.locationName}* on StockPilot.\n\nStock alerts and order approvals will be sent here automatically.`;
  }
  if (result.reason === "Code expired") {
    return `⏱ That code has expired. Open StockPilot → Settings → Channels → ${channelLabel} and generate a new code.`;
  }
  return `❌ Pairing code not recognised. Open StockPilot → Settings → Channels → ${channelLabel} and copy the current code.`;
}
