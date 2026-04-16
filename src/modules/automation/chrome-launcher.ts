/**
 * Chrome executable discovery + runtime download. Shared between the
 * browser-ordering agent and the product-metadata puppeteer fallback
 * so both reuse the same cached binary (no extra download per
 * metadata fetch).
 *
 * Lookup order:
 *   1. PUPPETEER_EXECUTABLE_PATH env var (operator override)
 *   2. System-installed Chromium (/usr/bin/chromium etc.)
 *   3. Runtime cache at /tmp/.chrome-cache
 *   4. Download Chrome for Testing Stable + extract to cache
 *
 * The runtime-download path is only hit the FIRST time any agent
 * launches Chrome after a container (re)start. Subsequent launches
 * hit the cache and take <1s.
 */

export const CHROME_CACHE_DIR = "/tmp/.chrome-cache";

let cachedExecPath: string | null = null;
let inFlight: Promise<string> | null = null;

export async function findOrDownloadChrome(
  logPrefix = "[chrome-launcher]"
): Promise<string> {
  // Fast path: we already resolved this in this process.
  if (cachedExecPath) {
    const fs = await import("node:fs");
    if (fs.existsSync(cachedExecPath)) return cachedExecPath;
    cachedExecPath = null; // binary got deleted somehow; rediscover
  }

  // Dedupe concurrent callers so we don't run the discovery/download
  // pipeline twice when two Chrome-using code paths fire back-to-back.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const path = await discoverOrDownload(logPrefix);
      cachedExecPath = path;
      return path;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function discoverOrDownload(logPrefix: string): Promise<string> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { execSync } = await import("node:child_process");

  let execPath = process.env.PUPPETEER_EXECUTABLE_PATH ?? "";

  // 1. System paths.
  if (!execPath || !fs.existsSync(execPath)) {
    for (const candidate of [
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome",
    ]) {
      if (fs.existsSync(candidate)) {
        execPath = candidate;
        break;
      }
    }
  }

  // 2. Runtime cache.
  if (!execPath || !fs.existsSync(execPath)) {
    try {
      const found = execSync(
        `find ${CHROME_CACHE_DIR} -name "chrome" -type f 2>/dev/null | head -1`,
        { encoding: "utf8" }
      ).trim();
      if (found && fs.existsSync(found)) execPath = found;
    } catch {
      /* not cached yet */
    }
  }

  // 3. Download + extract.
  if (!execPath || !fs.existsSync(execPath)) {
    console.log(`${logPrefix} Chrome not found — downloading at runtime (one-time, ~30-60s)`);
    const CHROME_DIR = `${CHROME_CACHE_DIR}/chrome`;
    fs.mkdirSync(CHROME_DIR, { recursive: true });

    const versionsUrl =
      "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";
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
    const chromeUrl = versionsData.channels.Stable.downloads.chrome.find(
      (d) => d.platform === "linux64"
    )?.url;
    if (!chromeUrl) throw new Error("No linux64 Chrome download URL found");

    const zipPath = `${CHROME_CACHE_DIR}/chrome.zip`;
    const downloadRes = await fetch(chromeUrl);
    const arrayBuf = await downloadRes.arrayBuffer();
    fs.writeFileSync(zipPath, Buffer.from(arrayBuf));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const unzipper = require("unzipper") as {
      Extract: (opts: { path: string }) => NodeJS.WritableStream;
    };
    const extractDir = `${CHROME_CACHE_DIR}/chrome-extracted`;
    fs.mkdirSync(extractDir, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: extractDir }))
        .on("close", resolve)
        .on("error", reject);
    });

    const found = execSync(
      `find ${CHROME_CACHE_DIR}/chrome-extracted -name "chrome" -type f | head -1`,
      { encoding: "utf8" }
    ).trim();
    if (found && fs.existsSync(found)) {
      const chromeDir = path.dirname(found);
      try {
        for (const f of fs.readdirSync(chromeDir)) {
          const full = path.join(chromeDir, f);
          try {
            fs.chmodSync(full, 0o755);
          } catch {
            /* skip non-files */
          }
        }
      } catch {
        /* ignore */
      }
      execPath = found;
      console.log(`${logPrefix} Chrome ready at: ${execPath}`);
    }
  }

  if (!execPath || !fs.existsSync(execPath)) {
    throw new Error("Chrome still not found after download attempt.");
  }
  return execPath;
}

/**
 * Standard launch args shared between the ordering agent and the
 * metadata fetcher. The metadata fetcher overrides `headless` to
 * true (new) since there's no bot-detection requirement for a
 * plain title-read — the ordering agent uses "shell" for stealth.
 */
export function standardLaunchArgs() {
  return [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-zygote",
    "--single-process",
  ];
}
