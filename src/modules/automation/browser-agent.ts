/**
 * Core browser ordering agent. Launches a headless Chromium session,
 * delegates to a site-specific adapter (Amazon, generic), captures
 * screenshots, then reports results + cart screenshot to Telegram
 * for manager approval.
 *
 * Safety invariant: this agent NEVER finalises a purchase. The
 * manager must open the cart on their own device to pay.
 *
 * Chromium is provided by @sparticuz/chromium (Lambda-optimised,
 * ~50MB) with puppeteer-core. Works on Railway without a custom
 * Docker image.
 */

import type { Browser, Page } from "puppeteer-core";
import { AgentTaskStatus, type Prisma } from "@/lib/prisma";
import { db } from "@/lib/db";
import { botTelemetry } from "@/lib/bot-telemetry";
import { sendTelegramMessage, sendTelegramPhoto } from "@/lib/telegram-bot";
import { addItemsToAmazonCart } from "@/modules/automation/sites/amazon";
import { addItemsToGenericSite } from "@/modules/automation/sites/generic";
import { AGENT_TIMEOUT_MS } from "@/modules/automation/browser-safety";
import { buildCartLinks, buildCartReadyKeyboard } from "@/modules/automation/cart-links";
import { recordAgentStep } from "@/modules/automation/agent-steps";
import { findOrDownloadChrome } from "@/modules/automation/chrome-launcher";
import { env } from "@/lib/env";

export type BrowserAgentResult = {
  ok: boolean;
  itemsAdded: number;
  itemsFailed: number;
  cartScreenshot: Buffer | null;
  summary: string;
  error?: string;
};

export async function runWebsiteOrderAgent(
  agentTaskId: string
): Promise<BrowserAgentResult> {
  const stop = botTelemetry.start("browser-agent.run", { agentTaskId });
  let browser: Browser | null = null;

  try {
    const task = await db.agentTask.findUniqueOrThrow({
      where: { id: agentTaskId },
      include: {
        purchaseOrder: {
          include: {
            supplier: true,
            lines: {
              include: { inventoryItem: true },
            },
            location: { select: { id: true } },
          },
        },
      },
    });

    if (!task.purchaseOrder) {
      return fail("No purchase order linked to this task.");
    }

    const po = task.purchaseOrder;
    const supplierUrl = po.supplier.website?.trim();
    if (!supplierUrl) {
      return fail("Supplier has no website URL configured.");
    }

    // Decrypt the manager's stored website-login credentials, if any.
    // Two paths supported (see modules/suppliers/website-credentials.ts):
    //   - "cookies": session cookies pasted from the manager's own
    //     browser → injected into the page before the first nav
    //     (preferred — bypasses captcha/2FA, robust on Amazon)
    //   - "password": classic form login → the adapter attempts a
    //     login flow before searching (best-effort; fragile on sites
    //     with bot detection)
    // Falls back to anonymous mode if no creds or decryption fails.
    const { decryptSupplierCredentials } = await import(
      "@/modules/suppliers/website-credentials"
    );
    const credentials = decryptSupplierCredentials(po.supplier.websiteCredentials);

    const searchTerms = po.lines.map((line) => ({
      query: line.description || line.inventoryItem.name,
      quantity: line.quantityOrdered,
      // When the user pasted a product URL via Telegram quick-add,
      // the bot stored it on the line (`Product URL: <url>`). Prefer
      // direct navigation to that exact product over a name-search,
      // which can match a similarly-named but different SKU.
      directUrl: extractLineProductUrl(line.notes),
    }));

    // Tell the manager we're working on it — keeps the conversation
    // flowing naturally in the Telegram chat.
    const managers = await db.user.findMany({
      where: {
        telegramChatId: { not: null },
        roles: { some: { locationId: po.location.id } },
      },
      select: { telegramChatId: true },
      take: 3,
    });
    if (managers.length === 0) {
      // Fallback: get any manager with a chat id.
      const fallback = await db.user.findMany({
        where: { telegramChatId: { not: null } },
        select: { telegramChatId: true },
        take: 3,
      });
      managers.push(...fallback);
    }

    // Sink for live-view step events. Every adapter screenshot
    // fires this, writing an AgentTaskStep row so /agent-tasks/[id]
    // can render the timeline in real time.
    const onStep = async (event: {
      name: string;
      status: "ok" | "failed";
      screenshot?: Buffer | null;
      notes?: string;
    }) => {
      await recordAgentStep(agentTaskId, event);
    };

    // Build a manager-visible live-view URL that we include in the
    // kickoff message so they can watch the agent work instead of
    // just waiting for the cart screenshot at the end.
    const appUrl = env.APP_URL?.replace(/\/$/, "");
    const liveViewUrl = appUrl ? `${appUrl}/agent-tasks/${agentTaskId}` : null;

    const itemList = searchTerms.map((t) => `• ${t.quantity}× ${t.query}`).join("\n");
    for (const m of managers) {
      if (!m.telegramChatId) continue;
      const body =
        `🌐 Opening *${po.supplier.name}*'s website to add:\n${itemList}\n\n` +
        (liveViewUrl
          ? `Watch live below or wait for the cart screenshot.`
          : `I'll send you a screenshot of the cart when it's ready.`);
      await sendTelegramMessage(m.telegramChatId, body, {
        parseMode: "Markdown",
        replyMarkup: liveViewUrl
          ? [[{ text: "📺 Watch live", url: liveViewUrl }]]
          : undefined,
      }).catch(() => {});
    }

    await recordAgentStep(agentTaskId, {
      name: "launched",
      status: "ok",
      notes: `Opening ${po.supplier.name} · ${searchTerms.length} line${searchTerms.length === 1 ? "" : "s"}`,
    });

    // Launch Chrome via the shared launcher (see chrome-launcher.ts).
    // Runtime download + cache handled there. Shared with the
    // product-metadata puppeteer fetcher so both paths reuse the
    // same /tmp/.chrome-cache binary.
    const puppeteer = (await import("puppeteer-core")).default;
    const execPath = await findOrDownloadChrome("[browser-agent]");
    console.log(`[browser-agent] Using Chrome at: ${execPath}`);
    browser = await puppeteer.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        // Anti-bot-detection flags
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--window-size=1280,900",
      ],
      defaultViewport: { width: 1280, height: 900 },
      executablePath: execPath,
      headless: "shell" as unknown as boolean, // "new" headless mode is more detectable
    });

    const page = await browser.newPage();

    // Anti-detection stealth
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      // @ts-expect-error -- fake chrome runtime
      window.chrome = { runtime: {} };
    });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
    });

    // Determine which adapter to use based on the URL.
    const isAmazon = /amazon\.(com|ca|co\.uk|de|fr|es|it|co\.jp)/i.test(supplierUrl);

    let results: Array<{ query: string; added: boolean; reason?: string }>;
    let screenshots: Array<{ stepName: string; screenshot: Buffer }>;

    // Use Promise.race for a proper timeout — setTimeout + throw
    // doesn't propagate to the async function's try/catch.
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        browser?.close().catch(() => {});
        reject(new Error("Browser agent timed out after 5 minutes."));
      }, AGENT_TIMEOUT_MS);
    });

    const adapterPromise = (async () => {
      if (isAmazon) {
        const amazonResult = await addItemsToAmazonCart(page, searchTerms, {
          domain: supplierUrl.replace(/\/+$/, ""),
          credentials,
          onStep,
        });
        return { results: amazonResult.results, screenshots: amazonResult.screenshots };
      } else {
        const genericResult = await addItemsToGenericSite(
          page,
          supplierUrl,
          searchTerms,
          { credentials, onStep }
        );
        return { results: genericResult.results, screenshots: genericResult.screenshots };
      }
    })();

    const adapterResult = await Promise.race([adapterPromise, timeoutPromise]);
    results = adapterResult.results;
    screenshots = adapterResult.screenshots;

    const itemsAdded = results.filter((r) => r.added).length;
    const itemsFailed = results.filter((r) => !r.added).length;
    const cartScreenshot = screenshots.find((s) =>
      s.stepName.startsWith("cart")
    )?.screenshot ?? screenshots[screenshots.length - 1]?.screenshot ?? null;

    // Bulleted cart contents — the USER asked for this explicitly
    // ("it doesnt send a list of the cart"). Pairs with the quantity
    // from the PO line so they see exactly what's in the cart.
    const lineSummaries = po.lines.map((line) => {
      const query = line.description || line.inventoryItem.name;
      const result = results.find((r) => r.query === query);
      const added = result ? result.added : true;
      const icon = added ? "✅" : "⚠️";
      const detail = result?.reason ? ` — _${result.reason}_` : "";
      return `${icon} ${line.quantityOrdered}× ${query}${detail}`;
    });

    const headline = allResultsSuccessful(results)
      ? `🛒 *${po.orderNumber}* cart ready on *${po.supplier.name}*`
      : itemsAdded > 0
        ? `🛒 *${po.orderNumber}* — partial cart on *${po.supplier.name}*`
        : `⚠️ *${po.orderNumber}* — couldn't build cart on *${po.supplier.name}*`;

    const footerHint =
      itemsFailed > 0
        ? `\n\n${itemsAdded}/${results.length} added. ${itemsFailed} couldn't be found — add ${itemsFailed === 1 ? "it" : "them"} manually.`
        : "";

    const summary =
      `${headline}\n\n` +
      lineSummaries.join("\n") +
      footerHint +
      `\n\nI *never* pay without your say-so. Confirm you'll handle checkout, or cancel if the cart's wrong.`;

    // Save results on the AgentTask.
    await db.agentTask.update({
      where: { id: agentTaskId },
      data: {
        status: AgentTaskStatus.READY_FOR_REVIEW,
        output: {
          summary,
          itemsAdded,
          itemsFailed,
          results,
          screenshotCount: screenshots.length,
        } satisfies Prisma.InputJsonValue,
      },
    });

    // Build cart-link buttons. Behavior depends on whether the
    // manager set up saved cookies for this supplier:
    //   - WITH cookies → agent built the cart in their REAL Amazon
    //     session, so we show "🛒 Open my Amazon cart" — clicking
    //     opens their populated cart immediately.
    //   - WITHOUT cookies → the agent's cart vanishes when the
    //     headless browser closes. Public Amazon URLs to "transfer"
    //     a cart to a logged-out user don't work (we tried, real
    //     users hit empty carts). So we instead show one product-
    //     page button per line so the manager can tap each one and
    //     add to their own cart with one extra tap. Plus a heavy
    //     hint to set up saved cookies for next time.
    const hasCredentials = !!credentials;
    // Match adapter results back to PO lines by query string so we
    // know which lines actually made it into the cart and which
    // didn't. Failed lines get a search-by-name button instead of a
    // direct product link (which would point at the same broken URL
    // that just failed).
    const cartLinks = buildCartLinks({
      supplierWebsite: po.supplier.website,
      supplierName: po.supplier.name,
      hasCredentials,
      lines: po.lines.map((l) => {
        const query = l.description || l.inventoryItem.name;
        const result = results.find((r) => r.query === query);
        return {
          description: query,
          quantityOrdered: l.quantityOrdered,
          productUrl: extractLineProductUrl(l.notes),
          added: result ? result.added : true,
        };
      }),
    });
    const replyMarkup = buildCartReadyKeyboard({ agentTaskId, links: cartLinks });

    const allFailed = itemsAdded === 0 && results.length > 0;
    const captionExtra = allFailed
      ? `\n\n_Couldn't add anything — product page didn't load or had no Add-to-Cart button (region-locked, removed, or wrong URL). Tap *Search* below to find it on ${po.supplier.name} yourself._`
      : hasCredentials
        ? `\n\n✓ Items are in *your* ${po.supplier.name} account (saved login). Tap *${cartLinks.openCartLabel}* to review and checkout.`
        : `\n\n_⚠ Cart built in an anonymous session. Tap *${cartLinks.openCartLabel}* to open your own cart; if it's empty, open the product URL you sent and tap Add to Cart in your browser. Save your ${po.supplier.name} login at Settings → Suppliers to skip this step next time._`;
    const fullCaption = `${summary}${captionExtra}`;

    // Send cart screenshot + approval buttons to the same managers
    // we messaged at the start.
    for (const m of managers) {
      if (!m.telegramChatId) continue;
      try {
        if (cartScreenshot) {
          await sendTelegramPhoto(m.telegramChatId, cartScreenshot, {
            caption: fullCaption.slice(0, 1024),
            parseMode: "Markdown",
            replyMarkup,
          });
        } else {
          await sendTelegramMessage(m.telegramChatId, fullCaption, {
            parseMode: "Markdown",
            replyMarkup,
          });
        }
      } catch (err) {
        botTelemetry.error("browser-agent.telegram_notify", err);
      }
    }

    stop({ itemsAdded, itemsFailed });
    return { ok: true, itemsAdded, itemsFailed, cartScreenshot, summary };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    botTelemetry.error("browser-agent.run", err);
    await db.agentTask.update({
      where: { id: agentTaskId },
      data: {
        status: AgentTaskStatus.FAILED,
        output: { error: errMsg } satisfies Prisma.InputJsonValue,
      },
    }).catch(() => {});

    // Notify the manager on Telegram. Previously these errors went
    // only to logs, so a Chrome-not-installed (or similar) failure
    // left the user staring at "Hang tight, I'll send a screenshot"
    // forever. Match a few common error shapes to give them actionable
    // guidance instead of the raw exception.
    try {
      const task = await db.agentTask.findUnique({
        where: { id: agentTaskId },
        select: {
          purchaseOrder: {
            select: {
              orderNumber: true,
              supplier: { select: { name: true } },
            },
          },
          location: { select: { id: true } },
        },
      });
      const managers = await db.user.findMany({
        where: {
          telegramChatId: { not: null },
          roles: task?.location
            ? { some: { locationId: task.location.id } }
            : undefined,
        },
        select: { telegramChatId: true },
        take: 3,
      });
      const orderNum = task?.purchaseOrder?.orderNumber ?? "(unknown)";
      const supplierName = task?.purchaseOrder?.supplier?.name ?? "the supplier";
      const friendly = friendlyBrowserAgentError(errMsg);
      const body =
        `⚠️ *${orderNum}* — couldn't finish adding to *${supplierName}*'s cart.\n\n` +
        `${friendly}\n\n` +
        `The order is still marked as approved so you can retry, or open ${supplierName} and add it yourself.`;
      for (const m of managers) {
        if (!m.telegramChatId) continue;
        await sendTelegramMessage(m.telegramChatId, body, { parseMode: "Markdown" }).catch(
          () => null
        );
      }
    } catch {
      /* notification is best-effort */
    }

    stop({ error: errMsg });
    return {
      ok: false,
      itemsAdded: 0,
      itemsFailed: 0,
      cartScreenshot: null,
      summary: `Browser agent failed: ${errMsg}`,
      error: errMsg,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

function fail(reason: string): BrowserAgentResult {
  return {
    ok: false,
    itemsAdded: 0,
    itemsFailed: 0,
    cartScreenshot: null,
    summary: reason,
    error: reason,
  };
}

function allResultsSuccessful(
  results: Array<{ added: boolean }>
): boolean {
  return results.length > 0 && results.every((r) => r.added);
}

/**
 * Translate a browser-agent exception into a manager-facing message.
 * Keeps common, known failure modes concise and actionable; unknown
 * errors get truncated so we don't leak a full stack trace into
 * Telegram. Exported for testing.
 */
export function friendlyBrowserAgentError(raw: string): string {
  const msg = raw.slice(0, 300);
  if (/chrome/i.test(msg) && /(not found|download|cache)/i.test(msg)) {
    return (
      "I couldn't launch Chrome to do the shopping. This is usually a Railway " +
      "deploy issue — the next deploy will re-download Chrome. Hit /api/health/chrome " +
      "to check."
    );
  }
  if (/timed out|timeout/i.test(msg)) {
    return "The supplier's site took too long to respond. Try again in a minute, or order manually this time.";
  }
  if (/net::ERR_|getaddrinfo|ENOTFOUND/i.test(msg)) {
    return "I couldn't reach the supplier's site (network/DNS). The site might be down — try again shortly.";
  }
  if (/captcha|robot|bot/i.test(msg)) {
    return (
      "The supplier flagged the session as automated. Connect your login cookies at " +
      "Settings → Suppliers → Website login and the agent will shop signed-in as you."
    );
  }
  if (/Supplier has no website/i.test(msg)) {
    return "This supplier isn't set up with a website URL. Add one in Settings → Suppliers.";
  }
  if (/No purchase order/i.test(msg)) {
    return "I couldn't find the order linked to this task. It may have been cancelled.";
  }
  return `Technical error: ${msg}`;
}

/**
 * Pulls a product URL out of a PO-line `notes` field. The bot writes
 * "Product URL: https://..." when a user pastes a link in Telegram;
 * we tolerate extra surrounding prose (managers may edit the note)
 * and any whitespace / trailing punctuation.
 */
export function extractLineProductUrl(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const match = notes.match(/Product URL:\s*(https?:\/\/\S+)/i);
  if (!match) return null;
  // Strip trailing sentence punctuation that often follows a URL when
  // the manager added prose after the line.
  return match[1].replace(/[.,;!?)\]]+$/g, "");
}
