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

  // 3) Run the worker loop in-process so background jobs and the
  //    supplier-reply poller actually execute on Railway (which only
  //    starts the Next.js server, not a separate worker process).
  //    Opt-out with WORKER_IN_PROCESS=false if you ever split the
  //    worker into its own service.
  if (process.env.WORKER_IN_PROCESS !== "false") {
    void (async () => {
      try {
        const [
          { runPendingJobs },
          { pollInboundBotChannels },
          { pollSupplierReplies },
          { backfillGmailThreadIds },
          { runSupplierNudges },
        ] = await Promise.all([
          import("@/modules/jobs/dispatcher"),
          import("@/modules/operator-bot/polling"),
          import("@/modules/purchasing/supplier-reply-poller"),
          import("@/modules/purchasing/backfill-gmail-threads"),
          import("@/modules/purchasing/supplier-nudges"),
        ]);

        // Clean up expired demo tenants (>48h old) on every boot.
        setTimeout(async () => {
          try {
            const { db } = await import("@/lib/db");
            const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
            const demoBiz = await db.business.findMany({
              where: { name: { startsWith: "[DEMO]" }, createdAt: { lt: cutoff } },
              select: { id: true },
            });
            if (demoBiz.length > 0) {
              const ids = demoBiz.map((b) => b.id);
              await db.business.deleteMany({ where: { id: { in: ids } } });
              console.log(`[demo-cleanup] deleted ${ids.length} expired demo tenant(s)`);
            }
          } catch (err) {
            console.error("[demo-cleanup] failed:", err);
          }
        }, 8_000);

        // One-time backfill on boot so historical POs (sent before
        // we persisted gmailThreadId) become trackable by the reply
        // poller. Idempotent — already-stamped rows are skipped.
        setTimeout(() => {
          backfillGmailThreadIds(200)
            .then((r) => {
              if (r.matched > 0) {
                console.log(
                  `[gmail-thread-backfill] matched=${r.matched} scanned=${r.scanned} skipped=${r.skipped}`
                );
              }
            })
            .catch((err) =>
              console.error("[gmail-thread-backfill] failed:", err)
            );
        }, 6_000);

        const JOB_TICK_MS = 5_000;
        const SUPPLIER_REPLY_INTERVAL_MS = 5 * 60 * 1000;
        const NUDGE_INTERVAL_MS = 60 * 60 * 1000; // hourly
        const POS_TOKEN_REFRESH_MS = 12 * 60 * 60 * 1000; // twice a day
        // Poll Square/Clover/Shopify for new sales every 2 min — acts
        // as a safety net if webhooks aren't registered or fail. Short
        // enough that inventory depletion feels near-real-time.
        const POS_SALES_POLL_MS = 2 * 60 * 1000;
        let lastSupplierReplyAt = 0;
        let lastNudgeAt = 0;
        let lastTokenRefreshAt = 0;
        let lastPosSalesPollAt = 0;
        let running = false;

        const tick = async () => {
          if (running) return;
          running = true;
          try {
            await runPendingJobs(10).catch((err) =>
              console.error("[in-proc-worker] jobs", err)
            );
            await pollInboundBotChannels().catch((err) =>
              console.error("[in-proc-worker] bot polling", err)
            );

            const now = Date.now();
            if (now - lastSupplierReplyAt >= SUPPLIER_REPLY_INTERVAL_MS) {
              lastSupplierReplyAt = now;
              const replies = await pollSupplierReplies().catch((err) => {
                console.error("[in-proc-worker] supplier reply poll", err);
                return 0;
              });
              if (replies > 0) {
                console.log(
                  `[in-proc-worker] supplier replies handled: ${replies}`
                );
              }
            }
            if (now - lastNudgeAt >= NUDGE_INTERVAL_MS) {
              lastNudgeAt = now;
              const nudgeResult = await runSupplierNudges().catch((err) => {
                console.error("[in-proc-worker] supplier nudges", err);
                return { stuckReplyNudgesSent: 0, lateDeliveryPromptsSent: 0 };
              });
              if (
                nudgeResult.stuckReplyNudgesSent +
                  nudgeResult.lateDeliveryPromptsSent >
                0
              ) {
                console.log(
                  `[in-proc-worker] nudges: ${nudgeResult.stuckReplyNudgesSent} reply-followups, ${nudgeResult.lateDeliveryPromptsSent} delivery-prompts`
                );
              }
            }
            // Poll connected POS integrations for new sales. Enqueues
            // a SYNC_SALES job per CONNECTED integration; the job runs
            // on the next job tick. This is the webhook-failure safety
            // net — without it, missed webhooks = silent data loss.
            if (now - lastPosSalesPollAt >= POS_SALES_POLL_MS) {
              lastPosSalesPollAt = now;
              const { pollConnectedPosIntegrationsForSales } = await import(
                "@/modules/pos/service"
              );
              const pollResult = await pollConnectedPosIntegrationsForSales().catch(
                (err) => {
                  console.error("[in-proc-worker] pos sales poll", err);
                  return null;
                }
              );
              if (pollResult && pollResult.queued > 0) {
                console.log(
                  `[in-proc-worker] pos sales poll: queued ${pollResult.queued} SYNC_SALES`
                );
              }
            }
            // POS OAuth token refresh — Square tokens expire ~30d,
            // Clover refresh tokens expire 60d after access. Running
            // every 12h means we refresh each token ~60× before it
            // could ever die.
            if (now - lastTokenRefreshAt >= POS_TOKEN_REFRESH_MS) {
              lastTokenRefreshAt = now;
              const {
                refreshExpiringPosTokens,
                cleanupStaleConnectingPosIntegrations,
              } = await import("@/modules/pos/service");
              const result = await refreshExpiringPosTokens().catch((err) => {
                console.error("[in-proc-worker] pos token refresh", err);
                return null;
              });
              if (result && (result.refreshed > 0 || result.failed > 0)) {
                console.log(
                  `[in-proc-worker] pos tokens: refreshed=${result.refreshed} failed=${result.failed} scanned=${result.scanned}`
                );
              }
              const cleanup = await cleanupStaleConnectingPosIntegrations().catch(
                (err) => {
                  console.error("[in-proc-worker] stale-connecting cleanup", err);
                  return null;
                }
              );
              if (cleanup && (cleanup.deleted > 0 || cleanup.reverted > 0)) {
                console.log(
                  `[in-proc-worker] stale-connecting: deleted=${cleanup.deleted} reverted=${cleanup.reverted}`
                );
              }
            }
          } finally {
            running = false;
          }
        };

        // First pass after a short delay so the server is fully up.
        setTimeout(tick, 3_000);
        setInterval(tick, JOB_TICK_MS);
        console.log(
          `[in-proc-worker] started (jobs every ${JOB_TICK_MS}ms, supplier replies every ${
            SUPPLIER_REPLY_INTERVAL_MS / 1000
          }s)`
        );
      } catch (err) {
        console.error("[in-proc-worker] failed to start:", err);
      }
    })();
  }
}
