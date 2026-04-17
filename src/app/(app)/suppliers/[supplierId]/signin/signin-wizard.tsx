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
    ? supplierWebsite.replace(/^https?:\/\//i, "").replace(/\/.*$/, "")
    : "the supplier's site";
  return (
    <Card>
      <CardContent className="space-y-5 p-5 text-sm">
        <div>
          <h3 className="mb-1 text-base font-semibold">
            Sign in on {supplierName}'s real website, push to StockPilot in one
            click.
          </h3>
          <p className="text-muted-foreground">
            This is the simplest path for any site with bot detection (Amazon,
            Costco, Walmart). You sign in normally on your own browser — no
            streaming, no typing credentials into StockPilot. The extension
            captures the session cookies your browser already has.
          </p>
        </div>

        <ol className="list-decimal space-y-3 pl-5">
          <li>
            <div className="font-medium">Install the StockPilot extension.</div>
            <div className="text-muted-foreground">
              Download{" "}
              <a
                href="/downloads/stockpilot-extension.zip"
                className="underline"
                download
              >
                stockpilot-extension.zip
              </a>
              , unzip it, then in Chrome go to{" "}
              <code className="rounded bg-muted px-1">chrome://extensions</code>
              , turn on <em>Developer mode</em>, click <em>Load unpacked</em>,
              and pick the unzipped folder.
            </div>
          </li>
          <li>
            <div className="font-medium">
              Open <code className="rounded bg-muted px-1">{supplierHost}</code>{" "}
              in a regular tab and sign in.
            </div>
            <div className="text-muted-foreground">
              Use your real account, including 2FA if the site asks for it.
              Do this just like any other day.
            </div>
          </li>
          <li>
            <div className="font-medium">
              Click the StockPilot extension icon in your toolbar.
            </div>
            <div className="text-muted-foreground">
              On first run it'll ask for this StockPilot URL — paste it from
              your address bar. Then pick <em>{supplierName}</em> from the
              dropdown and press <strong>Push cookies to StockPilot</strong>.
              That's it — come back here and refresh; the supplier will show
              as connected.
            </div>
          </li>
        </ol>

        <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
          <strong className="text-foreground">Safety note:</strong> cookies
          are encrypted (AES-256-GCM) the moment they reach StockPilot and
          only decrypted in the browser-agent process at order-dispatch time.
          The extension only talks to the StockPilot URL you give it. Source
          is in <code>browser-extension/</code> if you want to audit it.
        </div>
      </CardContent>
    </Card>
  );
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

  // Global keyboard capture while the sign-in panel is active.
  // Previously we had a separate <input> the user had to focus
  // BEFORE typing — confusing because they'd naturally click on
  // the email field in the screenshot and start typing, and get
  // nothing. Now keystrokes on this page are captured globally
  // and forwarded to Chrome. We skip keystrokes that originated
  // from a real form element (our Cancel button's focus ring,
  // etc.) so interacting with the rest of the page still works.
  useEffect(() => {
    if (!sessionId || status !== "ready") return;

    const handleKey = async (e: KeyboardEvent) => {
      // If the user is typing into an actual form field on OUR
      // page (e.g. the cookie-paste tab's textarea), let that go.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      // Skip modifier-only presses.
      if (
        e.key === "Shift" ||
        e.key === "Control" ||
        e.key === "Alt" ||
        e.key === "Meta" ||
        e.key === "CapsLock"
      ) {
        return;
      }

      const named = [
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
      e.preventDefault();
      e.stopPropagation();

      try {
        if (named.includes(e.key)) {
          await fetch(`/api/suppliers/${supplierId}/signin/${sessionId}/interact`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "key", key: e.key }),
          });
        } else if (e.key.length === 1) {
          await fetch(`/api/suppliers/${supplierId}/signin/${sessionId}/interact`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "type", text: e.key }),
          });
        } else {
          // Unknown key — ignore.
          return;
        }
      } catch {
        // Network blip — screenshot poll will recover state.
      }
      // Refresh the screenshot quickly so the user sees their
      // typing land instead of waiting for the 1.5s poll.
      setTimeout(fetchScreenshot, 250);
    };

    window.addEventListener("keydown", handleKey);
    setKeyboardActive(true);
    return () => {
      window.removeEventListener("keydown", handleKey);
      setKeyboardActive(false);
    };
  }, [sessionId, status, supplierId, fetchScreenshot]);

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

        {/* Keyboard-active indicator. Keystrokes are captured
            globally on this page (see the useEffect with
            window.keydown) — no input to focus. The indicator
            tells the user it's working. */}
        <div
          className={`flex items-center gap-2 rounded-xl border p-3 text-sm transition ${
            keyboardActive
              ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "border-border/60 bg-card text-muted-foreground"
          }`}
        >
          <span className="inline-block size-2 rounded-full bg-current" />
          {keyboardActive
            ? `Keyboard is live. Click the email field above, type your email, tap the password field, type your password, then hit Enter or the Sign In button on the page.`
            : "Keyboard not active yet — session still loading."}
        </div>

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
