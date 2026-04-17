/**
 * Server-side remote-browser sign-in sessions.
 *
 * Goal: let the manager sign in to the SUPPLIER'S real login page
 * without ever typing their password into a StockPilot form. We
 * launch Chrome server-side, navigate it to the supplier's sign-in
 * URL, stream screenshots to the client, forward mouse/keyboard
 * events from the client back to Chrome. When the supplier's site
 * redirects away from the sign-in page (= login succeeded), we grab
 * the cookies Chrome's session collected and persist them encrypted
 * on the Supplier row. Then we tear the session down.
 *
 * In-memory session map with a 5-min idle timeout and a hard 15-min
 * ceiling. Concurrency cap of 5 global sessions — this app doesn't
 * need more and each Chrome instance is ~200MB RAM.
 */

import type { Browser, Page } from "puppeteer-core";

import { findOrDownloadChrome, standardLaunchArgs } from "@/modules/automation/chrome-launcher";

export type SigninSession = {
  id: string;
  supplierId: string;
  locationId: string;
  loginUrl: string;
  loggedInUrlMatcher: RegExp;
  browser: Browser;
  page: Page;
  createdAt: number;
  lastActivityAt: number;
  /** Latest screenshot (JPEG buffer) — served to the client via GET. */
  latestScreenshot: Buffer | null;
  status: "loading" | "awaiting-login" | "capturing" | "done" | "error" | "closed";
  errorReason?: string;
};

const SESSIONS = new Map<string, SigninSession>();
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TOTAL_MS = 15 * 60 * 1000;
const MAX_CONCURRENT = 5;

/**
 * Start a sign-in session. Returns the session id + initial
 * screenshot. Callers must later poll /screenshot + forward events
 * via /interact + finish with /capture.
 */
export async function startSigninSession(input: {
  supplierId: string;
  locationId: string;
  loginUrl: string;
  /**
   * Regex that matches a URL the user lands on AFTER successful
   * login. If supplier-specific we pass it here; otherwise callers
   * can pass /.*\/.+/ and manually call capture when they decide
   * login succeeded.
   */
  loggedInUrlMatcher?: RegExp;
}): Promise<{ sessionId: string; screenshot: Buffer }> {
  pruneIdle();
  if (SESSIONS.size >= MAX_CONCURRENT) {
    throw new Error(
      `Too many concurrent sign-ins in progress (${MAX_CONCURRENT} max). Try again in a minute.`
    );
  }

  const sessionId = `ss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const puppeteer = (await import("puppeteer-core")).default;
  const execPath = await findOrDownloadChrome("[signin-session]");
  const browser = await puppeteer.launch({
    args: standardLaunchArgs(),
    executablePath: execPath,
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );

  try {
    await page.goto(input.loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (err) {
    await browser.close().catch(() => null);
    throw err;
  }

  const screenshot = (await page.screenshot({
    fullPage: false,
    type: "jpeg",
    quality: 75,
  })) as Buffer;

  const now = Date.now();
  const session: SigninSession = {
    id: sessionId,
    supplierId: input.supplierId,
    locationId: input.locationId,
    loginUrl: input.loginUrl,
    loggedInUrlMatcher: input.loggedInUrlMatcher ?? /.*/,
    browser,
    page,
    createdAt: now,
    lastActivityAt: now,
    latestScreenshot: screenshot,
    status: "awaiting-login",
  };
  SESSIONS.set(sessionId, session);
  return { sessionId, screenshot };
}

export function getSession(sessionId: string): SigninSession | null {
  const session = SESSIONS.get(sessionId);
  if (!session) return null;
  if (Date.now() - session.createdAt > MAX_TOTAL_MS) {
    closeSessionInternal(sessionId).catch(() => null);
    return null;
  }
  return session;
}

export function assertOwner(
  session: SigninSession,
  locationId: string
): void {
  if (session.locationId !== locationId) {
    throw new Error("This sign-in session belongs to another location.");
  }
}

export async function refreshScreenshot(
  sessionId: string
): Promise<Buffer | null> {
  const session = getSession(sessionId);
  if (!session) return null;
  session.lastActivityAt = Date.now();
  try {
    session.latestScreenshot = (await session.page.screenshot({
      fullPage: false,
      type: "jpeg",
      quality: 75,
    })) as Buffer;
    return session.latestScreenshot;
  } catch (err) {
    session.status = "error";
    session.errorReason = err instanceof Error ? err.message : String(err);
    return null;
  }
}

export async function forwardClick(
  sessionId: string,
  x: number,
  y: number
): Promise<void> {
  const session = getSession(sessionId);
  if (!session) throw new Error("Session not found");
  session.lastActivityAt = Date.now();
  await session.page.mouse.click(x, y);
}

export async function forwardType(
  sessionId: string,
  text: string
): Promise<void> {
  const session = getSession(sessionId);
  if (!session) throw new Error("Session not found");
  session.lastActivityAt = Date.now();
  // Keyboard.type handles printable characters; special keys go
  // through Keyboard.press. For MVP we support plain printable
  // text; Enter/Tab/Backspace go through forwardKey below.
  await session.page.keyboard.type(text, { delay: 10 });
}

export async function forwardKey(sessionId: string, key: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) throw new Error("Session not found");
  session.lastActivityAt = Date.now();
  // Allowlist of named keys puppeteer accepts. Anything else is
  // ignored — we don't want arbitrary string-to-KeyInput coercion.
  const allowed: Array<import("puppeteer-core").KeyInput> = [
    "Enter",
    "Tab",
    "Backspace",
    "Escape",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Delete",
    "Home",
    "End",
  ];
  const match = allowed.find((k) => k === key);
  if (!match) return;
  await session.page.keyboard.press(match);
}

/**
 * Pull the session's cookies. Caller decides whether login
 * succeeded (typically by checking page.url()) and passes them
 * down to Supplier.websiteCredentials via the existing
 * encryptSupplierCredentials helper.
 */
export async function captureCookies(
  sessionId: string
): Promise<Array<{ name: string; value: string; domain?: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: "Strict" | "Lax" | "None" }>> {
  const session = getSession(sessionId);
  if (!session) throw new Error("Session not found");
  session.status = "capturing";
  session.lastActivityAt = Date.now();
  const cookies = await session.page.cookies();
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: typeof c.expires === "number" && c.expires > 0 ? c.expires : undefined,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite:
      c.sameSite === "Strict" || c.sameSite === "Lax" || c.sameSite === "None"
        ? c.sameSite
        : undefined,
  }));
}

export async function closeSession(sessionId: string): Promise<void> {
  await closeSessionInternal(sessionId);
}

async function closeSessionInternal(sessionId: string): Promise<void> {
  const session = SESSIONS.get(sessionId);
  if (!session) return;
  SESSIONS.delete(sessionId);
  session.status = "closed";
  try {
    await session.browser.close();
  } catch {
    /* ignore */
  }
}

function pruneIdle(): void {
  const now = Date.now();
  for (const [id, session] of SESSIONS.entries()) {
    if (
      now - session.lastActivityAt > IDLE_TIMEOUT_MS ||
      now - session.createdAt > MAX_TOTAL_MS
    ) {
      closeSessionInternal(id).catch(() => null);
    }
  }
}

/**
 * Peek at current page URL — client uses this to decide whether
 * the user has finished logging in (URL is no longer on the
 * sign-in page).
 */
export function currentUrl(sessionId: string): string | null {
  const session = getSession(sessionId);
  if (!session) return null;
  try {
    return session.page.url();
  } catch {
    return null;
  }
}

/**
 * Test-only: reset the session map. Useful when tests spin up
 * multiple fake sessions.
 */
export function _resetSigninSessionsForTests(): void {
  SESSIONS.clear();
}
