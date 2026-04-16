/**
 * GET /api/health/chrome
 *
 * Reports whether the headless-browser ordering agent can launch
 * Chrome on this host. Hit this endpoint after each Railway deploy
 * (or set up a cron / Pingdom check on it) to catch breakage in the
 * Chrome download/extraction/permission chain BEFORE a real customer
 * triggers a website-mode PO and finds the agent dead.
 *
 * Returns 200 with diagnostic JSON either way — the body's
 * `ok: true|false` field is the signal. We don't 5xx because uptime
 * monitors should distinguish "Chrome is broken" (a soft alert) from
 * "the whole app is down" (a hard alert).
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ChromeProbeResult = {
  ok: boolean;
  reason: string;
  execPath: string | null;
  cacheDir: string;
  durationMs: number;
  steps: string[];
};

async function probeChrome(): Promise<ChromeProbeResult> {
  const started = Date.now();
  const steps: string[] = [];
  const CACHE_DIR = "/tmp/.chrome-cache";

  try {
    const fs = await import("node:fs");
    const { execSync } = await import("node:child_process");

    let execPath = process.env.PUPPETEER_EXECUTABLE_PATH ?? "";
    if (execPath && fs.existsSync(execPath)) {
      steps.push(`env PUPPETEER_EXECUTABLE_PATH found: ${execPath}`);
    } else {
      execPath = "";
    }

    if (!execPath) {
      for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
        if (fs.existsSync(p)) {
          execPath = p;
          steps.push(`system path found: ${execPath}`);
          break;
        }
      }
    }

    if (!execPath && fs.existsSync(CACHE_DIR)) {
      try {
        const found = execSync(
          `find ${CACHE_DIR} -name "chrome" -type f 2>/dev/null | head -1`,
          { encoding: "utf8" }
        ).trim();
        if (found && fs.existsSync(found)) {
          execPath = found;
          steps.push(`runtime cache found: ${execPath}`);
        }
      } catch {
        steps.push(`find in cache failed (probably empty)`);
      }
    }

    if (!execPath) {
      return {
        ok: false,
        reason:
          "No Chrome binary on this host. Browser ordering agent will fail on first website-mode PO. " +
          "On Railway this normally self-heals on first use (runtime download to /tmp/.chrome-cache).",
        execPath: null,
        cacheDir: CACHE_DIR,
        durationMs: Date.now() - started,
        steps,
      };
    }

    // Try to actually launch Chrome — proves the binary is loadable
    // (correct shared libs, executable bit, not corrupted).
    const puppeteer = (await import("puppeteer-core")).default;
    const browser = await puppeteer.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
      ],
      executablePath: execPath,
      headless: true,
    });
    const version = await browser.version();
    steps.push(`launched, version: ${version}`);
    await browser.close();

    return {
      ok: true,
      reason: `Chrome launched cleanly (${version})`,
      execPath,
      cacheDir: CACHE_DIR,
      durationMs: Date.now() - started,
      steps,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: `Chrome probe failed: ${message.slice(0, 300)}`,
      execPath: null,
      cacheDir: CACHE_DIR,
      durationMs: Date.now() - started,
      steps,
    };
  }
}

export async function GET() {
  const result = await probeChrome();
  return NextResponse.json(result, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
