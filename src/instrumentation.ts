/**
 * Next.js instrumentation — runs once at server startup (both `next
 * start` and Vercel/Railway serverless warmup).
 *
 * We use it to re-sync the Telegram webhook registration on every
 * deploy. If we ever add a new update type (e.g. `callback_query` for
 * inline keyboards), this guarantees the live subscription matches
 * what the code expects — no more silently-dropped events because
 * Telegram still has the old allowed_updates list.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // 1) Re-sync Telegram's allowed_updates list on every deploy so
  //    code-level changes to subscriptions (e.g. adding callback_query)
  //    always propagate.
  void (async () => {
    try {
      const { ensureTelegramWebhook } = await import("@/lib/telegram-bot");
      const result = await ensureTelegramWebhook();
      if (!result.ok) {
        // eslint-disable-next-line no-console
        console.warn("[bot] Telegram webhook sync skipped:", result.reason);
        return;
      }
      if (result.changed) {
        // eslint-disable-next-line no-console
        console.log(
          `[bot] Telegram webhook re-synced → ${result.webhookUrl} (allowed_updates updated)`
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        "[bot] Telegram webhook sync failed:",
        err instanceof Error ? err.message : err
      );
    }
  })();

  // 2) LOUD warning if the email provider is still the console/mock
  //    one in production — means bot-approved POs will say 'sent' but
  //    no supplier will actually receive anything. Easy to miss.
  void (async () => {
    try {
      const { isRealEmailProviderConfigured, emailProviderName } =
        await import("@/providers/email/provider-status");
      if (!isRealEmailProviderConfigured()) {
        // eslint-disable-next-line no-console
        console.warn(
          "\n" +
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
            `⚠  EMAIL PROVIDER IS IN TEST MODE (${emailProviderName()})\n` +
            "   Bot-approved POs will flip to SENT in the DB, but no\n" +
            "   real email will reach suppliers. Fix:\n" +
            "     railway variables --service stockpilot set \\\n" +
            "       DEFAULT_EMAIL_PROVIDER=resend RESEND_API_KEY=re_...\n" +
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        );
      }
    } catch {
      // provider-status is pure — if this throws something really odd,
      // just skip. Nothing actionable.
    }
  })();
}
