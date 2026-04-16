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

    const itemList = searchTerms.map((t) => `• ${t.quantity}× ${t.query}`).join("\n");
    for (const m of managers) {
      if (!m.telegramChatId) continue;
      await sendTelegramMessage(
        m.telegramChatId,
        `🌐 Opening *${po.supplier.name}*'s website to add:\n${itemList}\n\nHang tight — I'll send you a screenshot of the cart when it's ready.`,
        { parseMode: "Markdown" }
      ).catch(() => {});
    }

    // Launch Chrome using puppeteer's own browser management.
    // `npx puppeteer browsers install chrome` runs at build time
    // and caches the binary. puppeteer-core finds it via the
    // PUPPETEER_CACHE_DIR or default ~/.cache/puppeteer path.
    const puppeteer = (await import("puppeteer-core")).default;
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { execSync } = await import("node:child_process");

    // Find Chrome binary — check puppeteer cache, common system
    // paths, and PUPPETEER_EXECUTABLE_PATH env var.
    // Chrome is downloaded at runtime on first use and cached in
    // /tmp/.chrome-cache (survives within a container's lifetime).
    // Build-time installs don't persist on Railway nixpacks.
    const CACHE_DIR = "/tmp/.chrome-cache";
    let execPath = process.env.PUPPETEER_EXECUTABLE_PATH ?? "";

    // Check system paths first (fast)
    if (!execPath || !fs.existsSync(execPath)) {
      for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
        if (fs.existsSync(p)) { execPath = p; break; }
      }
    }

    // Check runtime cache
    if (!execPath || !fs.existsSync(execPath)) {
      try {
        const found = execSync(
          `find ${CACHE_DIR} -name "chrome" -type f 2>/dev/null | head -1`,
          { encoding: "utf8" }
        ).trim();
        if (found && fs.existsSync(found)) execPath = found;
      } catch { /* not cached yet */ }
    }

    // Download Chrome at runtime if not found (first use only, ~30-60s).
    // Uses a direct URL since npx isn't in the standalone runtime.
    if (!execPath || !fs.existsSync(execPath)) {
      console.log("[browser-agent] Chrome not found — downloading at runtime...");
      try {
        const CHROME_DIR = `${CACHE_DIR}/chrome`;
        fs.mkdirSync(CHROME_DIR, { recursive: true });

        // Fetch the latest Chrome for Testing stable version
        const versionsUrl = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";
        const versionsRes = await fetch(versionsUrl);
        const versionsData = (await versionsRes.json()) as {
          channels: {
            Stable: {
              version: string;
              downloads: {
                chrome: Array<{ platform: string; url: string }>;
              };
            };
          };
        };
        const chromeUrl = versionsData.channels.Stable.downloads.chrome
          .find((d) => d.platform === "linux64")?.url;
        if (!chromeUrl) throw new Error("No linux64 Chrome download URL found");

        console.log(`[browser-agent] Downloading from: ${chromeUrl}`);
        const zipPath = `${CACHE_DIR}/chrome.zip`;
        const downloadRes = await fetch(chromeUrl);
        const arrayBuf = await downloadRes.arrayBuffer();
        fs.writeFileSync(zipPath, Buffer.from(arrayBuf));

        // Extract using the pure-JS 'unzipper' package (no system
        // deps needed — Railway's runtime has no unzip/python3).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const unzipper = require("unzipper") as {
          Extract: (opts: { path: string }) => NodeJS.WritableStream;
        };
        const extractDir = `${CACHE_DIR}/chrome-extracted`;
        fs.mkdirSync(extractDir, { recursive: true });
        await new Promise<void>((resolve, reject) => {
          fs.createReadStream(zipPath)
            .pipe(unzipper.Extract({ path: extractDir }))
            .on("close", resolve)
            .on("error", reject);
        });

        // Find the chrome binary inside
        const found = execSync(
          `find ${CACHE_DIR}/chrome-extracted -name "chrome" -type f | head -1`,
          { encoding: "utf8" }
        ).trim();
        if (found && fs.existsSync(found)) {
          // Make ALL binaries in the Chrome directory executable —
          // unzipper strips Unix permissions so chrome, chrome_crashpad_handler,
          // and other helpers all need +x.
          const chromeDir = path.dirname(found);
          try {
            const files = fs.readdirSync(chromeDir);
            for (const f of files) {
              const full = path.join(chromeDir, f);
              try { fs.chmodSync(full, 0o755); } catch { /* skip non-files */ }
            }
          } catch { /* ignore */ }
          execPath = found;
          console.log(`[browser-agent] Chrome ready at: ${execPath}`);
        }
      } catch (dlErr) {
        throw new Error(
          `Failed to download Chrome: ${dlErr instanceof Error ? dlErr.message : String(dlErr)}`
        );
      }
    }

    if (!execPath || !fs.existsSync(execPath)) {
      throw new Error("Chrome still not found after download attempt.");
    }

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
        });
        return { results: amazonResult.results, screenshots: amazonResult.screenshots };
      } else {
        const genericResult = await addItemsToGenericSite(
          page,
          supplierUrl,
          searchTerms
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

    const summary =
      `🛒 Cart ready on *${po.supplier.name}* for *${po.orderNumber}*!\n\n` +
      results
        .map(
          (r) =>
            `${r.added ? "✅" : "⚠️"} ${r.query}${r.reason ? ` — _${r.reason}_` : ""}`
        )
        .join("\n") +
      `\n\n${itemsAdded} of ${results.length} items added.` +
      (itemsFailed > 0
        ? ` ${itemsFailed} couldn't be found — you may need to add ${itemsFailed === 1 ? "it" : "them"} manually.`
        : " Everything looks good.") +
      `\n\nI will *never* pay without your say-so. Tap below to confirm you'll handle checkout, or cancel if the cart doesn't look right.`;

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

    // Send cart screenshot + approval buttons to the same managers
    // we messaged at the start.
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
                  text: "✅ Looks good, I'll checkout myself",
                  callback_data: `website_cart_approve:${agentTaskId}`,
                },
                {
                  text: "✖ Cancel order",
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
                  text: "✅ Looks good, I'll checkout myself",
                  callback_data: `website_cart_approve:${agentTaskId}`,
                },
                {
                  text: "✖ Cancel order",
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
