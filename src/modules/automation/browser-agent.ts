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
// import { decryptCredential } from "@/lib/credential-encryption"; // v2: once Supplier has encrypted credentials
import { addItemsToAmazonCart } from "@/modules/automation/sites/amazon";
import { addItemsToGenericSite } from "@/modules/automation/sites/generic";
import { AGENT_TIMEOUT_MS } from "@/modules/automation/browser-safety";

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

    // v1: run without login — most sites (Amazon) allow adding to
    // cart anonymously. The manager logs in on their own device to
    // review the cart and pay. Credential-based login is planned
    // for v2 once we add an encrypted `websiteCredentials` JSON
    // field to the Supplier model.
    const credentials = null;

    const searchTerms = po.lines.map((line) => ({
      query: line.description || line.inventoryItem.name,
      quantity: line.quantityOrdered,
    }));

    // Launch headless Chromium.
    const chromium = (await import("@sparticuz/chromium")).default;
    const puppeteer = (await import("puppeteer-core")).default;

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1280, height: 900 },
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Determine which adapter to use based on the URL.
    const isAmazon = /amazon\.(com|ca|co\.uk|de|fr|es|it|co\.jp)/i.test(supplierUrl);

    let results: Array<{ query: string; added: boolean; reason?: string }>;
    let screenshots: Array<{ stepName: string; screenshot: Buffer }>;

    const timeout = setTimeout(() => {
      browser?.close().catch(() => {});
      throw new Error("Browser agent timed out after 5 minutes.");
    }, AGENT_TIMEOUT_MS);

    try {
      if (isAmazon) {
        const amazonResult = await addItemsToAmazonCart(page, searchTerms, {
          domain: supplierUrl.replace(/\/+$/, ""),
        });
        results = amazonResult.results;
        screenshots = amazonResult.screenshots;
      } else {
        const genericResult = await addItemsToGenericSite(
          page,
          supplierUrl,
          searchTerms
        );
        results = genericResult.results;
        screenshots = genericResult.screenshots;
      }
    } finally {
      clearTimeout(timeout);
    }

    const itemsAdded = results.filter((r) => r.added).length;
    const itemsFailed = results.filter((r) => !r.added).length;
    const cartScreenshot = screenshots.find((s) =>
      s.stepName.startsWith("cart")
    )?.screenshot ?? screenshots[screenshots.length - 1]?.screenshot ?? null;

    const summary =
      `🛒 *Website order for ${po.orderNumber}*\n\n` +
      results
        .map(
          (r) =>
            `${r.added ? "✅" : "⚠️"} ${r.query}${r.reason ? ` — _${r.reason}_` : ""}`
        )
        .join("\n") +
      `\n\n${itemsAdded}/${results.length} items added to cart on ${po.supplier.name}.` +
      (itemsFailed > 0
        ? `\n⚠️ ${itemsFailed} items need manual attention.`
        : "") +
      `\n\n_Open the cart on your device to review and pay. StockPilot will NEVER auto-complete payment._`;

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

    // Notify managers on Telegram with the cart screenshot.
    const managers = await db.user.findMany({
      where: {
        telegramChatId: { not: null },
        roles: { some: { locationId: po.location.id } },
      },
      select: { telegramChatId: true },
      take: 3,
    });

    for (const m of managers) {
      if (!m.telegramChatId) continue;
      try {
        if (cartScreenshot) {
          await sendTelegramPhoto(m.telegramChatId, cartScreenshot, {
            caption: summary.slice(0, 1024),
            parseMode: "Markdown",
            replyMarkup: [
              [
                {
                  text: "✅ Looks good — I'll pay myself",
                  callback_data: `website_cart_approve:${agentTaskId}`,
                },
              ],
              [
                {
                  text: "✖ Cancel",
                  callback_data: `website_cart_cancel:${agentTaskId}`,
                },
              ],
            ],
          });
        } else {
          await sendTelegramMessage(m.telegramChatId, summary, {
            parseMode: "Markdown",
            replyMarkup: [
              [
                {
                  text: "✅ I'll handle it from here",
                  callback_data: `website_cart_approve:${agentTaskId}`,
                },
                {
                  text: "✖ Cancel",
                  callback_data: `website_cart_cancel:${agentTaskId}`,
                },
              ],
            ],
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
