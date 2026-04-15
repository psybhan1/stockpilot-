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

  // 2) LOUD warning if neither global email provider is configured
  //    AND no location has a Gmail channel connected. Means any bot-
  //    approved PO at a naked location will fake the send. Each
  //    location can still opt into Gmail individually via the
  //    Settings → Channels → Gmail flow — that's the free path.
  void (async () => {
    try {
      const [{ isRealEmailProviderConfigured, emailProviderName }, { db }] =
        await Promise.all([
          import("@/providers/email/provider-status"),
          import("@/lib/db"),
        ]);
      if (isRealEmailProviderConfigured()) return; // Resend is set — fine

      const gmailCount = await db.locationChannel.count({
        where: { channel: "EMAIL_GMAIL", enabled: true },
      });

      if (gmailCount > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[email] No global provider, but ${gmailCount} location(s) have Gmail connected. Locations without Gmail will simulate sends.`
        );
        return;
      }

      // eslint-disable-next-line no-console
      console.warn(
        "\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          `⚠  NO EMAIL PATH CONFIGURED (global: ${emailProviderName()})\n` +
          "   Bot-approved POs will flip to SENT in the DB, but no\n" +
          "   real email will reach suppliers. Two options:\n" +
          "     A) FREE (recommended): each location connects their\n" +
          "        Gmail under Settings → Channels → Gmail.\n" +
          "     B) Global fallback: set DEFAULT_EMAIL_PROVIDER=resend\n" +
          "        and RESEND_API_KEY=re_... on Railway.\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
      );
    } catch {
      /* ignore — instrumentation must never crash boot */
    }
  })();
}
