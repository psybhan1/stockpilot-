import { NextResponse } from "next/server";

import { completeSquareOAuth } from "@/modules/pos/service";

/**
 * Square OAuth callback.
 *
 * Returns an HTML page (not a 3xx redirect) so both flows work off
 * the same endpoint:
 *  - Popup flow: JS detects `window.opener`, postMessages the result,
 *    closes the popup. Parent page re-fetches /settings.
 *  - Full-redirect flow (no opener): JS falls through to
 *    `location.href = /settings?square=...`.
 *
 * The HTML is tiny and self-contained so it renders instantly even
 * when the popup has no CSS/fonts to cascade from — important because
 * the user only sees this page for ~50ms.
 */
function renderCallbackHtml(outcome: "connected" | "error", reason?: string) {
  const query = outcome === "connected"
    ? "square=connected"
    : `square=error&reason=${encodeURIComponent(reason ?? "oauth_failed")}`;

  const safeOutcome = outcome === "connected" ? "connected" : "error";
  const safeReason = (reason ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>StockPilot — Connecting Square…</title>
<meta name="robots" content="noindex" />
<style>body{font-family:system-ui,sans-serif;background:#0b0b0d;color:#f5f5f5;margin:0;display:grid;place-items:center;min-height:100vh;text-align:center}main{padding:2rem}h1{font-size:1.1rem;font-weight:600;margin:0 0 .5rem}p{margin:0;opacity:.7;font-size:.9rem}</style>
</head>
<body>
<main>
  <h1>${outcome === "connected" ? "Square connected." : "Square connection failed."}</h1>
  <p>You can close this window.</p>
</main>
<script>
(function(){
  var outcome = ${JSON.stringify(safeOutcome)};
  var reason = ${JSON.stringify(safeReason)};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "stockpilot:square-oauth", outcome: outcome, reason: reason }, window.location.origin);
      setTimeout(function(){ window.close(); }, 400);
      return;
    }
  } catch (e) {}
  window.location.replace("/settings?${query}");
})();
</script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const integrationId = state?.split(".")[0];

  if (error) {
    return renderCallbackHtml("error", error);
  }

  if (!code || !state || !integrationId) {
    return renderCallbackHtml("error", "missing_code");
  }

  try {
    await completeSquareOAuth({
      integrationId,
      state,
      code,
    });

    return renderCallbackHtml("connected");
  } catch (oauthError) {
    const message =
      oauthError instanceof Error ? oauthError.message : "oauth_failed";
    return renderCallbackHtml("error", message);
  }
}
