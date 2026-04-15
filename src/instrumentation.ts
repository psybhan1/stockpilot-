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

  // Fire and forget — don't block startup. If it fails, log and move on;
  // the manager can re-run from Settings → Telegram connect page.
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
}
