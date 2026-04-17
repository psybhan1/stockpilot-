"use client";

/**
 * Interactive sign-in wizard. Three tabs:
 *
 *   1. Browser extension (default / recommended) — user installs the
 *      StockPilot extension once, signs in to the supplier on the
 *      real supplier.com tab they're used to, then clicks the
 *      extension icon to push their session cookies to StockPilot.
 *      Zero streaming, zero bot-detection collisions, real browser.
 *
 *   2. Sign in here — server launches Chrome, streams screenshots
 *      back to this component via periodic polling. Fallback for
 *      users who can't install the extension (e.g. locked-down
 *      corporate devices).
 *
 *   3. Paste cookies — escape hatch for power users with Cookie-
 *      Editor already set up.
 *
 * The remote-browser path uses ~1.5s screenshot polling — not as
 * smooth as real-time VNC but adequate for typing credentials on a
 * simple login form. Clicks are snappy.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Save, X, Clipboard, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

type WizardTab = "extension" | "remote" | "paste";

export function SigninWizard({
  supplierId,
  supplierName,
  supplierWebsite,
}: {
  supplierId: string;
  supplierName: string;
  supplierWebsite: string | null;
}) {
  const [tab, setTab] = useState<WizardTab>("extension");

  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap rounded-2xl border border-border/60 bg-card p-1 text-sm">
        <button
          type="button"
          onClick={() => setTab("extension")}
          className={`rounded-xl px-4 py-2 transition ${
            tab === "extension"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          🧩 Use browser extension (easiest)
        </button>
        <button
          type="button"
          onClick={() => setTab("remote")}
          className={`rounded-xl px-4 py-2 transition ${
            tab === "remote"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          🔐 Sign in here
        </button>
        <button
          type="button"
          onClick={() => setTab("paste")}
          className={`rounded-xl px-4 py-2 transition ${
            tab === "paste"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          📋 Paste cookies (advanced)
        </button>
      </div>

      {tab === "extension" ? (
        <ExtensionPanel
          supplierName={supplierName}
          supplierWebsite={supplierWebsite}
        />
      ) : tab === "remote" ? (
        <RemoteSigninPanel
          supplierId={supplierId}
          supplierName={supplierName}
          supplierWebsite={supplierWebsite}
        />
      ) : (
        <CookiePastePanel supplierId={supplierId} supplierName={supplierName} />
      )}
    </div>
  );
}

// ── Browser extension (recommended path) ───────────────────────────

function ExtensionPanel({
  supplierName,
  supplierWebsite,
}: {
  supplierName: string;
  supplierWebsite: string | null;
}) {
  const supplierHost = supplierWebsite
    ? (() => {
        const raw = supplierWebsite.trim();
        try {
          const u = new URL(
            /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
          );
          return u.host.replace(/^www\./, "");
        } catch {
          return raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
        }
      })()
    : "the supplier's site";

  // Auto-link the extension session cookie on mount. Idempotent —
  // visiting this tab just refreshes the cookie's 30-day expiry.
  const [linkState, setLinkState] = useState<"pending" | "linked" | "failed">(
    "pending"
  );
  const [linkError, setLinkError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/extension/link", {
          method: "POST",
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (cancelled) return;
        if (res.ok) {
          setLinkState("linked");
          return;
        }
        let message = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { message?: string };
          if (body && typeof body.message === "string") message = body.message;
        } catch {
          /* not JSON */
        }
        setLinkError(message);
        setLinkState("failed");
      } catch (err) {
        if (cancelled) return;
        setLinkError(err instanceof Error ? err.message : String(err));
        setLinkState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const browserKind = detectBrowser();
  const extensionsUrl = browserKind === "edge" ? "edge://extensions" : "chrome://extensions";
  const downloadHref = "/downloads/stockpilot-extension.zip";

  return (
    <Card>
      <CardContent className="space-y-5 p-5 text-sm">
        <div>
          <h3 className="mb-1 text-base font-semibold">
            Install once. Sign in on any supplier. One click to save.
          </h3>
          <p className="text-muted-foreground">
            The fastest, most reliable way for sites with captchas (Amazon,
            Costco, LCBO). You sign in on your normal browser tab — no
            StockPilot form, no streamed browser, no password typing.
          </p>
        </div>

        {linkState === "linked" ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3 text-xs text-emerald-800 dark:text-emerald-200">
            <Check className="h-4 w-4 shrink-0" />
            <span>
              This browser is linked to StockPilot — every supplier on this
              account can push cookies from the extension.
            </span>
          </div>
        ) : linkState === "failed" ? (
          <div className="rounded-lg border border-amber-600/30 bg-amber-600/5 p-3 text-xs text-amber-900 dark:text-amber-200">
            Couldn't link this browser ({linkError}). Reload the page — if it
            keeps failing, the extension will show "connect this browser" on
            first use and guide you through it.
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
            Linking this browser to StockPilot…
          </div>
        )}

        {/* Headline CTA — the download is the first + most obvious
            step. The whole card is the click target. */}
        <a href={downloadHref} download className="block">
          <div className="flex items-center justify-between rounded-2xl border-2 border-primary/50 bg-primary/5 p-5 transition hover:border-primary hover:bg-primary/10">
            <div>
              <div className="text-base font-semibold text-foreground">
                ⬇ Download the StockPilot extension
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                ≈ 12 KB. Works on {browserKind === "edge" ? "Microsoft Edge" : browserKind === "firefox" ? "Firefox (developer mode)" : "Chrome, Brave, Arc, and other Chromium browsers"}. Takes about 90 seconds after download.
              </div>
            </div>
            <span aria-hidden="true" className="text-2xl">→</span>
          </div>
        </a>

        {/* Three step cards with visual hints (SVG mini-mockups). The
            mockups are inline SVG instead of PNG screenshots so the
            page stays ~kilobytes and renders crisp on retina. */}
        <div className="grid gap-3 md:grid-cols-3">
          <InstallStep
            n={1}
            title="Unzip the download"
            diagram={<UnzipDiagram />}
            body={
              <>
                Double-click <code className="rounded bg-muted px-1">stockpilot-extension.zip</code> in your Downloads folder. Keep the unzipped folder where it is — the browser reads the extension directly from there.
              </>
            }
          />
          <InstallStep
            n={2}
            title="Load it in your browser"
            diagram={<DevModeDiagram />}
            body={
              <>
                Paste this in your address bar (can&apos;t click{" "}
                <code>chrome://</code> links, browsers block them):
                <CopyableCode value={extensionsUrl} />
                Then toggle <strong>Developer mode</strong> on, click{" "}
                <strong>Load unpacked</strong>, and pick the unzipped folder
                from step 1.
              </>
            }
          />
          <InstallStep
            n={3}
            title="Save a supplier session"
            diagram={<PushDiagram supplierHost={supplierHost} />}
            body={
              <>
                Open <code className="rounded bg-muted px-1">{supplierHost}</code> in a tab and sign in like you normally would. Click the new StockPilot icon in your toolbar, pick <em>{supplierName}</em>, press <strong>Push cookies</strong>.
              </>
            }
          />
        </div>

        {browserKind === "firefox" ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-200">
            Firefox only runs unsigned extensions in Developer Edition /
            Nightly. On regular Firefox you&apos;ll need to wait until we publish
            to AMO (coming soon) or use Chrome / Edge / Brave instead.
          </div>
        ) : browserKind === "safari" ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-200">
            Safari doesn&apos;t support the MV3 extension format without an Xcode
            wrapper. Use Chrome or Brave for now — we&apos;re working on a Safari
            build.
          </div>
        ) : null}

        <details className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
          <summary className="cursor-pointer font-medium text-foreground">
            Stuck on a step?
          </summary>
          <div className="mt-2 space-y-2 text-muted-foreground">
            <p>
              <strong>Can&apos;t find Developer mode?</strong> It&apos;s a toggle in
              the top-right corner of the <code>{extensionsUrl}</code>{" "}
              page. If the toggle isn&apos;t there, your browser admin may have
              disabled extensions — check with your IT team.
            </p>
            <p>
              <strong>&quot;Load unpacked&quot; button missing?</strong> Developer
              mode isn&apos;t on yet. Toggle it, then the button appears.
            </p>
            <p>
              <strong>Picked the wrong folder?</strong> Make sure you pick
              the folder that <em>contains</em> <code>manifest.json</code> (the
              unzipped folder itself, not the parent Downloads folder).
            </p>
            <p>
              <strong>Extension icon doesn&apos;t show in toolbar?</strong> Click
              the puzzle-piece icon next to the address bar, find StockPilot,
              click the pin so it stays visible.
            </p>
          </div>
        </details>

        <details className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
          <summary className="cursor-pointer font-medium text-foreground">
            What does the extension read, exactly?
          </summary>
          <div className="mt-2 space-y-2 text-muted-foreground">
            <p>
              Only cookies for the supplier domain you&apos;re on, and only at
              the moment you click <strong>Push cookies</strong>. No
              background script, no polling, no access to other tabs.
            </p>
            <p>
              Cookies are encrypted (AES-256-GCM) the moment they reach
              StockPilot and only decrypted in the browser-agent process at
              order-dispatch time.
            </p>
            <p>
              Full details:{" "}
              <a
                href="/privacy/extension"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                /privacy/extension
              </a>
              . Source code is in{" "}
              <code className="rounded bg-background px-1">
                browser-extension/
              </code>{" "}
              in the StockPilot repo (no minification, about 500 lines).
            </p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function InstallStep({
  n,
  title,
  body,
  diagram,
}: {
  n: number;
  title: string;
  body: React.ReactNode;
  diagram?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border/60 bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {n}
        </span>
        <span className="font-medium">{title}</span>
      </div>
      {diagram ? (
        <div className="mb-3 overflow-hidden rounded-lg border border-border/40 bg-muted/30">
          {diagram}
        </div>
      ) : null}
      <div className="text-xs text-muted-foreground leading-relaxed">
        {body}
      </div>
    </div>
  );
}

/**
 * Three tiny SVG "mockups" of what each step looks like in the
 * browser. SVG keeps them resolution-independent and adds ~1kb to
 * the page, vs ~100kb each for screenshots (and screenshots would
 * go stale every Chrome redesign).
 */

function UnzipDiagram() {
  return (
    <svg
      viewBox="0 0 220 96"
      role="img"
      aria-label="A zip file turns into a folder"
      className="block h-24 w-full"
    >
      {/* zip */}
      <g transform="translate(24,20)">
        <rect x="0" y="0" width="44" height="56" rx="4" fill="#94a3b8" />
        <rect x="18" y="0" width="8" height="14" fill="#64748b" />
        <rect x="18" y="16" width="8" height="6" fill="#64748b" />
        <rect x="18" y="24" width="8" height="6" fill="#64748b" />
        <text
          x="22"
          y="48"
          textAnchor="middle"
          fontSize="9"
          fill="#1e293b"
          fontFamily="ui-monospace, monospace"
        >
          .zip
        </text>
      </g>
      {/* arrow */}
      <g transform="translate(80,40)">
        <line x1="0" y1="8" x2="50" y2="8" stroke="currentColor" strokeWidth="2" />
        <polygon points="50,2 60,8 50,14" fill="currentColor" />
      </g>
      {/* folder */}
      <g transform="translate(148,18)">
        <path
          d="M0 8 L0 56 L52 56 L52 14 L22 14 L18 8 Z"
          fill="#fbbf24"
          stroke="#b45309"
          strokeWidth="1"
        />
        <rect x="6" y="30" width="40" height="4" fill="#b45309" opacity="0.25" />
        <rect x="6" y="38" width="28" height="4" fill="#b45309" opacity="0.25" />
      </g>
    </svg>
  );
}

function DevModeDiagram() {
  return (
    <svg
      viewBox="0 0 220 96"
      role="img"
      aria-label="Developer mode toggle in the extensions page"
      className="block h-24 w-full"
    >
      {/* browser chrome */}
      <rect x="4" y="4" width="212" height="88" rx="6" fill="#fff" stroke="#cbd5e1" />
      <rect x="4" y="4" width="212" height="14" rx="6" fill="#f1f5f9" />
      <circle cx="12" cy="11" r="2" fill="#ef4444" />
      <circle cx="20" cy="11" r="2" fill="#f59e0b" />
      <circle cx="28" cy="11" r="2" fill="#22c55e" />
      <rect x="44" y="7" width="110" height="8" rx="2" fill="#e2e8f0" />
      <text
        x="50"
        y="13.5"
        fontSize="6"
        fill="#475569"
        fontFamily="ui-monospace, monospace"
      >
        chrome://extensions
      </text>
      {/* top-right toggle highlight */}
      <g transform="translate(150,26)">
        <text x="0" y="7" fontSize="7" fill="#0f172a">
          Developer mode
        </text>
        {/* toggle ON */}
        <rect x="48" y="1" width="18" height="9" rx="4.5" fill="#16a34a" />
        <circle cx="61" cy="5.5" r="3.5" fill="#fff" />
        {/* highlight ring */}
        <rect
          x="45"
          y="-2"
          width="24"
          height="15"
          rx="6"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="1.5"
          strokeDasharray="3 2"
        />
      </g>
      {/* Load unpacked button */}
      <g transform="translate(14,46)">
        <rect x="0" y="0" width="58" height="16" rx="3" fill="#0f172a" />
        <text
          x="29"
          y="10.5"
          textAnchor="middle"
          fontSize="6.5"
          fill="#f8fafc"
          fontFamily="ui-sans-serif, system-ui"
        >
          Load unpacked
        </text>
        {/* highlight arrow */}
        <g transform="translate(64,8)">
          <line x1="0" y1="0" x2="10" y2="0" stroke="#f59e0b" strokeWidth="1.5" />
          <polygon points="0,-3 -5,0 0,3" fill="#f59e0b" />
        </g>
      </g>
      {/* extension tile placeholder */}
      <rect x="14" y="68" width="80" height="18" rx="3" fill="#e2e8f0" />
      <rect x="104" y="68" width="80" height="18" rx="3" fill="#e2e8f0" />
    </svg>
  );
}

function PushDiagram({ supplierHost }: { supplierHost: string }) {
  return (
    <svg
      viewBox="0 0 220 96"
      role="img"
      aria-label="Click the StockPilot icon, pick the supplier, push cookies"
      className="block h-24 w-full"
    >
      {/* popup */}
      <rect
        x="8"
        y="10"
        width="120"
        height="76"
        rx="6"
        fill="#fff"
        stroke="#cbd5e1"
      />
      <text x="16" y="24" fontSize="8" fontWeight="bold" fill="#0f172a">
        StockPilot
      </text>
      <text
        x="16"
        y="34"
        fontSize="6"
        fill="#64748b"
        fontFamily="ui-monospace, monospace"
      >
        {supplierHost.length > 22 ? supplierHost.slice(0, 22) + "…" : supplierHost}
      </text>
      <rect x="16" y="40" width="104" height="10" rx="2" fill="#f1f5f9" />
      <text x="21" y="47.5" fontSize="6" fill="#334155">
        Supplier: (auto-matched)
      </text>
      <rect x="16" y="56" width="104" height="14" rx="3" fill="#0b3d2e" />
      <text
        x="68"
        y="65.5"
        textAnchor="middle"
        fontSize="6.5"
        fill="#f8fafc"
      >
        💾 Push cookies
      </text>
      {/* arrow out of popup */}
      <g transform="translate(136,46)">
        <line x1="0" y1="0" x2="24" y2="0" stroke="currentColor" strokeWidth="2" />
        <polygon points="24,-4 32,0 24,4" fill="currentColor" />
      </g>
      {/* StockPilot server box */}
      <g transform="translate(172,30)">
        <rect x="0" y="0" width="40" height="36" rx="4" fill="#0b3d2e" />
        <text
          x="20"
          y="20"
          textAnchor="middle"
          fontSize="6"
          fill="#f8fafc"
          fontFamily="ui-sans-serif, system-ui"
        >
          StockPilot
        </text>
        <text
          x="20"
          y="28"
          textAnchor="middle"
          fontSize="5"
          fill="#a7f3d0"
        >
          encrypted
        </text>
      </g>
    </svg>
  );
}

function CopyableCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* browser blocked clipboard — user can still read the URL */
        }
      }}
      className="mt-2 inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
    >
      <Clipboard className="h-3 w-3" />
      {copied ? "Copied" : "Copy URL"}
    </button>
  );
}

function detectBrowser(): "chrome" | "edge" | "firefox" | "safari" | "other" {
  if (typeof navigator === "undefined") return "chrome";
  const ua = navigator.userAgent.toLowerCase();
  if (/edg\//.test(ua)) return "edge";
  if (/firefox|fxios/.test(ua)) return "firefox";
  if (/safari/.test(ua) && !/chrome|chromium|crios/.test(ua)) return "safari";
  if (/chrome|chromium|crios|brave|opera|opr\/|arc/.test(ua)) return "chrome";
  return "other";
}

// ── Remote sign-in (primary path) ──────────────────────────────────

function RemoteSigninPanel({
  supplierId,
  supplierName,
  supplierWebsite,
}: {
  supplierId: string;
  supplierName: string;
  supplierWebsite: string | null;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "idle" | "starting" | "ready" | "saving" | "saved" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Persistence of the sign-in session across accidental page
  // reloads. We stash the sessionId in sessionStorage keyed by
  // supplier. On mount we try to resume by hitting the screenshot
  // endpoint — if the server still has the session alive, we pick
  // up where the user left off. If it 404s (session aged out), we
  // clear the stale key and drop back to idle. sessionStorage (not
  // localStorage) so closing the tab cleans everything up without
  // leaving a dormant remote Chrome around.
  const storageKey = `stockpilot.signin.${supplierId}`;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(storageKey);
    if (!stored || sessionId) return;
    (async () => {
      try {
        const res = await fetch(
          `/api/suppliers/${supplierId}/signin/${stored}/screenshot`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          window.sessionStorage.removeItem(storageKey);
          return;
        }
        setSessionId(stored);
        setStatus("ready");
      } catch {
        window.sessionStorage.removeItem(storageKey);
      }
    })();
  }, [supplierId, storageKey, sessionId]);

  const fetchScreenshot = useCallback(async () => {
    if (!sessionId) return;
    const res = await fetch(
      `/api/suppliers/${supplierId}/signin/${sessionId}/screenshot`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      if (res.status === 404) {
        setStatus("error");
        setErrorMsg("Session expired. Start a new one below.");
      }
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    setScreenshot((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    const urlHeader = res.headers.get("X-Current-Url");
    if (urlHeader) setCurrentUrl(urlHeader);
  }, [sessionId, supplierId]);

  useEffect(() => {
    if (!sessionId) return;
    fetchScreenshot();
    pollRef.current = setInterval(fetchScreenshot, 1500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [sessionId, fetchScreenshot]);

  // Abort on unmount if we still have an open session.
  useEffect(() => {
    return () => {
      if (sessionId) {
        navigator.sendBeacon?.(
          `/api/suppliers/${supplierId}/signin/${sessionId}/abort`
        );
      }
    };
  }, [sessionId, supplierId]);

  // Global keyboard + paste capture while the sign-in panel is
  // active. Keystrokes are forwarded to the server's Chrome as
  // `type` / `key` interactions. Pastes are intercepted via a
  // dedicated `paste` event listener so clipboard text (often a
  // password manager dump) hits the page as ONE type call instead
  // of N char-by-char round-trips. We skip events originating from
  // a real form element on OUR page (e.g. the cookie-paste tab's
  // textarea) so our own forms still work.
  useEffect(() => {
    if (!sessionId || status !== "ready") return;

    const targetIsOurFormField = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      );
    };

    const sendType = async (text: string) => {
      if (!text) return;
      try {
        await fetch(`/api/suppliers/${supplierId}/signin/${sessionId}/interact`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "type", text }),
        });
      } catch {
        /* screenshot poll recovers */
      }
      setTimeout(fetchScreenshot, 250);
    };

    const sendKey = async (key: string) => {
      try {
        await fetch(`/api/suppliers/${supplierId}/signin/${sessionId}/interact`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "key", key }),
        });
      } catch {
        /* screenshot poll recovers */
      }
      setTimeout(fetchScreenshot, 250);
    };

    const named = new Set([
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
    ]);

    const handleKey = (e: KeyboardEvent) => {
      if (targetIsOurFormField(e.target)) return;
      // Let Ctrl/Cmd+V fall through to the paste handler — don't
      // swallow it as a literal "v" keypress.
      if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) {
        return;
      }
      // Let copy/cut alone (nothing on our page to copy from, but
      // don't interfere with the user's clipboard shortcuts).
      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C" || e.key === "x" || e.key === "X")) {
        return;
      }
      if (
        e.key === "Shift" ||
        e.key === "Control" ||
        e.key === "Alt" ||
        e.key === "Meta" ||
        e.key === "CapsLock"
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (named.has(e.key)) {
        void sendKey(e.key);
      } else if (e.key.length === 1) {
        void sendType(e.key);
      }
    };

    const handlePaste = (e: ClipboardEvent) => {
      if (targetIsOurFormField(e.target)) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;
      e.preventDefault();
      e.stopPropagation();
      void sendType(text);
    };

    window.addEventListener("keydown", handleKey);
    window.addEventListener("paste", handlePaste);
    setKeyboardActive(true);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("paste", handlePaste);
      setKeyboardActive(false);
    };
  }, [sessionId, status, supplierId, fetchScreenshot]);

  /** Send an explicit chunk of text from the quick-entry panel. */
  const sendTextChunk = useCallback(
    async (text: string) => {
      if (!sessionId || !text) return;
      try {
        await fetch(`/api/suppliers/${supplierId}/signin/${sessionId}/interact`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "type", text }),
        });
      } catch {
        /* caller doesn't care — screenshot poll catches up */
      }
      setTimeout(fetchScreenshot, 250);
    },
    [sessionId, supplierId, fetchScreenshot]
  );

  const sendEnter = useCallback(async () => {
    if (!sessionId) return;
    try {
      await fetch(`/api/suppliers/${supplierId}/signin/${sessionId}/interact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "key", key: "Enter" }),
      });
    } catch {
      /* ignore */
    }
    setTimeout(fetchScreenshot, 250);
  }, [sessionId, supplierId, fetchScreenshot]);

  const sendTab = useCallback(async () => {
    if (!sessionId) return;
    try {
      await fetch(`/api/suppliers/${supplierId}/signin/${sessionId}/interact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "key", key: "Tab" }),
      });
    } catch {
      /* ignore */
    }
    setTimeout(fetchScreenshot, 250);
  }, [sessionId, supplierId, fetchScreenshot]);

  const start = async () => {
    setStatus("starting");
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/suppliers/${supplierId}/signin/start`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ message: "" }))) as {
          message?: string;
        };
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const { sessionId: id, screenshot: initial } = (await res.json()) as {
        sessionId: string;
        screenshot: string;
      };
      setSessionId(id);
      setScreenshot(`data:image/jpeg;base64,${initial}`);
      setStatus("ready");
      // Persist so an accidental page reload resumes this session
      // instead of spinning up a fresh Chrome from scratch.
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(storageKey, id);
      }
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const onImageClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!sessionId || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    // The server uses 1280x800 viewport. Scale the click to match.
    const scaleX = 1280 / rect.width;
    const scaleY = 800 / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    await fetch(`/api/suppliers/${supplierId}/signin/${sessionId}/interact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "click", x, y }),
    });
    // Snapshot straight away so the user sees their click land.
    setTimeout(fetchScreenshot, 200);
  };

  // Wheel-scroll forwarding. Wheel events fire ~60×/sec during a
  // scroll; we coalesce into 50ms windows so the server gets one
  // batched `page.mouse.wheel({deltaX, deltaY})` per window instead
  // of 60 HTTP requests that'd overwhelm both Chrome and Neon.
  const scrollAccumRef = useRef({ x: 0, y: 0 });
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushScroll = useCallback(async () => {
    if (!sessionId) return;
    const { x, y } = scrollAccumRef.current;
    if (x === 0 && y === 0) return;
    scrollAccumRef.current = { x: 0, y: 0 };
    try {
      await fetch(
        `/api/suppliers/${supplierId}/signin/${sessionId}/interact`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "scroll", deltaX: x, deltaY: y }),
        }
      );
    } catch {
      /* screenshot poll will catch up */
    }
    setTimeout(fetchScreenshot, 200);
  }, [sessionId, supplierId, fetchScreenshot]);

  const onImageWheel = (e: React.WheelEvent<HTMLImageElement>) => {
    if (!sessionId) return;
    // Stop the page from scrolling — we want the remote Chrome to
    // scroll instead.
    e.preventDefault();
    // deltaMode: 0=pixels, 1=lines, 2=pages. Normalise to pixels
    // so the same scroll feels the same on any device.
    const multiplier = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 800 : 1;
    scrollAccumRef.current.x += e.deltaX * multiplier;
    scrollAccumRef.current.y += e.deltaY * multiplier;
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(flushScroll, 50);
  };

  // Flush any pending scroll on unmount so nothing gets dropped.
  useEffect(() => {
    return () => {
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
        flushScroll();
      }
    };
  }, [flushScroll]);

  const save = async () => {
    if (!sessionId) return;
    setStatus("saving");
    try {
      const res = await fetch(
        `/api/suppliers/${supplierId}/signin/${sessionId}/capture`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ message: "" }))) as {
          message?: string;
        };
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      setStatus("saved");
      // Session is captured + closed server-side; drop the resume
      // key so an accidental reload doesn't try to rehydrate a
      // finished session.
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(storageKey);
      }
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  if (status === "idle") {
    return (
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="space-y-2">
            <p className="font-medium">How this works (30 seconds, one time):</p>
            <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
              <li>Tap <span className="font-medium text-foreground">Open {supplierName} sign-in</span>.</li>
              <li>You'll see {supplierName}'s real login page embedded below.</li>
              <li>Type your email + password (your keystrokes go directly to {supplierName}, not StockPilot).</li>
              <li>Once you're signed in, tap <span className="font-medium text-foreground">Save my login</span>. Done.</li>
            </ol>
          </div>
          <Button onClick={start} className="rounded-2xl">
            🔓 Open {supplierName} sign-in
          </Button>
          {!supplierWebsite ? (
            <p className="text-sm text-amber-600">
              Can't sign in — {supplierName} has no website configured. Add one on the supplier
              page first.
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (status === "starting") {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-8 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          Launching a fresh browser on our server for you…
        </CardContent>
      </Card>
    );
  }

  if (status === "saved") {
    return (
      <Card className="border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
        <CardContent className="space-y-3 p-6">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <Check className="size-5" />
            <p className="text-lg font-medium">Signed in to {supplierName}.</p>
          </div>
          <p className="text-sm text-muted-foreground">
            Your session is saved. From now on, when you approve a {supplierName} order,
            the agent will put items straight into your real cart.
          </p>
          <a href={`/suppliers/${supplierId}`}>
            <Button variant="outline" className="rounded-2xl">
              Back to {supplierName}
            </Button>
          </a>
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card className="border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30">
        <CardContent className="space-y-3 p-6">
          <p className="font-medium text-rose-700 dark:text-rose-300">
            Sign-in failed: {errorMsg}
          </p>
          <div className="flex gap-2">
            <Button onClick={start} className="rounded-2xl">
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // status === "ready" | "saving"
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {screenshot ? (
          <div className="relative overflow-hidden rounded-xl border border-border/60 bg-black">
            <img
              ref={imgRef}
              src={screenshot}
              alt={`${supplierName} sign-in`}
              onClick={onImageClick}
              onWheel={onImageWheel}
              className="block w-full cursor-pointer select-none"
              draggable={false}
            />
            {status === "saving" ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-black">
                  <Loader2 className="size-4 animate-spin" /> Saving your login…
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center justify-center p-8 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" /> Loading…
          </div>
        )}

        {/* Captcha-warning banner for sites where the remote
            browser reliably gets blocked. The right answer for
            those sites is the Extension tab, not more polish on
            this flow. Honesty saves the user an hour of frustration. */}
        <BotBlockedWarning supplierName={supplierName} supplierWebsite={supplierWebsite} />

        {/* Keyboard-active indicator + quick-entry panel. Keystrokes
            are captured globally (see the useEffect with window.
            keydown + window.paste) — and these explicit inputs are
            the reliable fallback for password managers and copy/
            paste workflows that don't play nice with the image. */}
        <div
          className={`rounded-xl border p-3 text-sm transition ${
            keyboardActive
              ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "border-border/60 bg-card text-muted-foreground"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="inline-block size-2 rounded-full bg-current" />
            <span>
              {keyboardActive
                ? "Keyboard + paste are live. Click a field in the image, type or paste — it goes straight to the page."
                : "Keyboard not active yet — session still loading."}
            </span>
          </div>
        </div>

        {status === "ready" ? (
          <QuickEntryPanel
            onSendText={sendTextChunk}
            onPressTab={sendTab}
            onPressEnter={sendEnter}
          />
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {currentUrl ? `Page: ${truncate(currentUrl, 60)}` : ""}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                if (sessionId) {
                  await fetch(
                    `/api/suppliers/${supplierId}/signin/${sessionId}/abort`,
                    { method: "POST" }
                  ).catch(() => null);
                }
                if (typeof window !== "undefined") {
                  window.sessionStorage.removeItem(storageKey);
                }
                setSessionId(null);
                setScreenshot(null);
                setStatus("idle");
              }}
              className="rounded-2xl"
            >
              <X className="mr-1 size-4" />
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={status !== "ready"}
              className="rounded-2xl bg-emerald-600 hover:bg-emerald-700"
            >
              <Save className="mr-1 size-4" />
              Save my login
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Only tap <span className="font-medium">Save my login</span> once the {supplierName} page
          shows you're signed in (your name / account menu visible).
        </p>
      </CardContent>
    </Card>
  );
}

// ── Cookie-paste (advanced) ────────────────────────────────────────

function CookiePastePanel({
  supplierId,
  supplierName,
}: {
  supplierId: string;
  supplierName: string;
}) {
  const [cookieJson, setCookieJson] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setCookieJson(text);
    } catch {
      setErrorMsg("Couldn't read clipboard. Paste manually.");
    }
  };

  const save = async () => {
    setStatus("saving");
    setErrorMsg(null);
    const formData = new FormData();
    formData.append("supplierId", supplierId);
    formData.append("credentialKind", "cookies");
    formData.append("cookieJson", cookieJson);
    try {
      const res = await fetch(`/suppliers/${supplierId}`, {
        method: "POST",
        body: formData,
      });
      // The supplier page server-action accepts FormData; result is
      // a redirect on success. The fetch will return 200 on success.
      if (!res.ok && res.status !== 0) {
        const body = await res.text();
        throw new Error(body.slice(0, 200));
      }
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  if (status === "saved") {
    return (
      <Card className="border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
        <CardContent className="space-y-2 p-6">
          <p className="font-medium text-emerald-700 dark:text-emerald-300">
            Cookies saved.
          </p>
          <p className="text-sm text-muted-foreground">
            Next {supplierName} order will use your session.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6 text-sm">
        <p>
          Use this path if the "Sign in here" tab doesn't work (corporate firewall,
          multi-factor auth, etc.). Requires the free{" "}
          <a
            href="https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            Cookie-Editor
          </a>{" "}
          browser extension.
        </p>
        <ol className="list-inside list-decimal space-y-1 text-muted-foreground">
          <li>Open {supplierName} in a new tab and sign in.</li>
          <li>Click the Cookie-Editor icon in your browser toolbar.</li>
          <li>Click <span className="font-medium text-foreground">Export → JSON</span>.</li>
          <li>Paste the JSON below and Save.</li>
        </ol>
        <Textarea
          placeholder='[{"name":"session-token","value":"...","domain":".amazon.com"},...]'
          value={cookieJson}
          onChange={(e) => setCookieJson(e.target.value)}
          className="min-h-40 rounded-[20px] font-mono text-xs"
        />
        {errorMsg ? (
          <p className="text-sm text-rose-600 dark:text-rose-400">{errorMsg}</p>
        ) : null}
        <div className="flex gap-2">
          <Button variant="outline" onClick={pasteFromClipboard} className="rounded-2xl">
            <Clipboard className="mr-1 size-4" />
            Paste from clipboard
          </Button>
          <Button
            onClick={save}
            disabled={status === "saving" || cookieJson.trim().length < 10}
            className="rounded-2xl"
          >
            <Save className="mr-1 size-4" />
            {status === "saving" ? "Saving…" : "Save cookies"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// ── Quick-entry panel + bot-blocked warning (RemoteSigninPanel helpers) ──

/**
 * A pair of dedicated inputs for getting text into the remote
 * Chrome reliably. The image above does have global keyboard +
 * paste capture, but those get swallowed on some hosts (password
 * managers that autofill without focus, certain Chrome-for-Testing
 * builds that drop events on hidden iframes, etc.) — this panel is
 * the deterministic fallback.
 *
 * Two inputs because a single input would either expose the
 * password (if not masked) or force the user to type twice (if
 * masked, since browsers refuse autofill into type=password unless
 * the form semantics match). Keeping them separate:
 *   - "Type or paste" — plain text input; each keystroke is sent
 *     immediately so the user sees their typing land in the image.
 *   - "Password (hidden)" — masked input; paste your password, the
 *     whole thing ships on Send. Value is wiped after send.
 */
function QuickEntryPanel({
  onSendText,
  onPressTab,
  onPressEnter,
}: {
  onSendText: (text: string) => Promise<void>;
  onPressTab: () => Promise<void>;
  onPressEnter: () => Promise<void>;
}) {
  const [liveText, setLiveText] = useState("");
  const [password, setPassword] = useState("");
  const [pwSending, setPwSending] = useState(false);

  const handleLiveKey = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Translate Enter here into an Enter key forwarded to the page
    // (submit the form). Don't add a newline to the input.
    if (e.key === "Enter") {
      e.preventDefault();
      await onPressEnter();
    } else if (e.key === "Tab") {
      e.preventDefault();
      await onPressTab();
    }
  };

  // The "type" input forwards each keystroke for live feedback —
  // we debounce so a fast typer sends 1 call per 120ms with the
  // accumulated delta instead of one per character.
  const lastSentRef = useRef("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushLive = async (value: string) => {
    const prev = lastSentRef.current;
    if (value === prev) return;
    if (value.startsWith(prev)) {
      // Common case: user typed more characters.
      const delta = value.slice(prev.length);
      await onSendText(delta);
    } else {
      // Edit case — can't send "backspace N times" cleanly without
      // knowing focus state. Simplest: user will click the field
      // in the image and retype. Reset tracker to sync.
    }
    lastSentRef.current = value;
  };
  const handleLiveChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setLiveText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void flushLive(value), 120);
  };
  const clearLive = () => {
    setLiveText("");
    lastSentRef.current = "";
  };

  const sendPassword = async () => {
    if (!password) return;
    setPwSending(true);
    try {
      await onSendText(password);
    } finally {
      setPassword("");
      setPwSending(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-card p-3 text-sm">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Paste directly into the page (reliable fallback)
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        <div>
          <label
            htmlFor="remote-quick-text"
            className="block text-xs text-muted-foreground"
          >
            Type or paste (email, OTP, username)
          </label>
          <div className="mt-1 flex gap-1">
            <Input
              id="remote-quick-text"
              type="text"
              value={liveText}
              onChange={handleLiveChange}
              onKeyDown={handleLiveKey}
              placeholder="Click a field in the image, then type here"
              className="h-10 rounded-xl"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearLive}
              className="rounded-xl"
            >
              Clear
            </Button>
          </div>
        </div>
        <div>
          <label
            htmlFor="remote-quick-password"
            className="block text-xs text-muted-foreground"
          >
            Password (hidden; value cleared after send)
          </label>
          <div className="mt-1 flex gap-1">
            <Input
              id="remote-quick-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void sendPassword();
                }
              }}
              placeholder="Click the password field, paste, Send"
              className="h-10 rounded-xl"
              autoComplete="off"
            />
            <Button
              type="button"
              size="sm"
              disabled={!password || pwSending}
              onClick={sendPassword}
              className="rounded-xl"
            >
              {pwSending ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPressTab}
          className="rounded-xl"
        >
          Tab
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPressEnter}
          className="rounded-xl"
        >
          Enter (submit)
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Tip: click the email field <em>in the image above</em> first so the
        page's cursor is in the right spot, then paste/type here.
      </p>
    </div>
  );
}

/**
 * List of supplier hostnames that run aggressive bot-detection
 * (reCAPTCHA / Cloudflare turnstile / Amazon's proprietary
 * challenges). On those sites, the remote-Chrome flow is not the
 * right tool — the user needs the browser extension instead. We
 * show a banner that's honest about this BEFORE they spend five
 * minutes fighting the captcha.
 */
const BOT_BLOCKED_HOSTS = [
  /amazon\./i,
  /costco\./i,
  /walmart\./i,
  /samsclub\./i,
  /target\./i,
  /lcbo\.com/i,
  /saq\./i,
  /bevmo\./i,
  /totalwine\./i,
  /instacart\./i,
];

function BotBlockedWarning({
  supplierName,
  supplierWebsite,
}: {
  supplierName: string;
  supplierWebsite: string | null;
}) {
  if (!supplierWebsite) return null;
  const blocked = BOT_BLOCKED_HOSTS.some((re) => re.test(supplierWebsite));
  if (!blocked) return null;
  return (
    <div className="rounded-xl border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-100">
      <p className="font-medium">
        {supplierName} uses captchas that block automated browsers.
      </p>
      <p className="mt-1 text-xs">
        You might still succeed here if the captcha happens to skip —
        but the reliable path is the{" "}
        <strong>Use browser extension</strong> tab at the top. It ships
        the cookies from <em>your</em> real browser, so the captcha is
        already solved before StockPilot ever touches the cart.
      </p>
    </div>
  );
}
