import { NextResponse } from "next/server";

import { completeCloverOAuth } from "@/modules/pos/service";

/**
 * Clover OAuth callback.
 *
 * Clover redirects here with query params:
 *   code          — short-lived auth code to exchange for a token
 *   merchant_id   — the merchant who approved (required: Clover's
 *                   token response doesn't echo it back, so we MUST
 *                   read it from here and persist it)
 *   client_id     — our app id (ignored; used only by Clover's logs)
 *   employee_id   — the employee who approved (ignored — we don't
 *                   scope tokens per-employee)
 *   state         — our anti-CSRF nonce; contains our integration id
 *
 * Same HTML-with-JS-postMessage pattern as the Square callback so the
 * popup flow auto-closes and the parent /settings page refreshes.
 */
function renderCallbackHtml(outcome: "connected" | "error", reason?: string) {
  const query = outcome === "connected"
    ? "clover=connected"
    : `clover=error&reason=${encodeURIComponent(reason ?? "oauth_failed")}`;

  const safeOutcome = outcome === "connected" ? "connected" : "error";
  const safeReason = (reason ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>StockPilot — Connecting Clover…</title>
<meta name="robots" content="noindex" />
<style>body{font-family:system-ui,sans-serif;background:#0b0b0d;color:#f5f5f5;margin:0;display:grid;place-items:center;min-height:100vh;text-align:center}main{padding:2rem}h1{font-size:1.1rem;font-weight:600;margin:0 0 .5rem}p{margin:0;opacity:.7;font-size:.9rem}</style>
</head>
<body>
<main>
  <h1>${outcome === "connected" ? "Clover connected." : "Clover connection failed."}</h1>
  <p>You can close this window.</p>
</main>
<script>
(function(){
  var outcome = ${JSON.stringify(safeOutcome)};
  var reason = ${JSON.stringify(safeReason)};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "stockpilot:clover-oauth", outcome: outcome, reason: reason }, window.location.origin);
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
  const merchantId = url.searchParams.get("merchant_id");
  const error = url.searchParams.get("error");
  const integrationId = state?.split(".")[0];

  if (error) {
    return renderCallbackHtml("error", error);
  }

  if (!code || !state || !integrationId || !merchantId) {
    return renderCallbackHtml("error", "missing_params");
  }

  try {
    await completeCloverOAuth({
      integrationId,
      state,
      code,
      merchantId,
    });

    return renderCallbackHtml("connected");
  } catch (oauthError) {
    const message =
      oauthError instanceof Error ? oauthError.message : "oauth_failed";
    return renderCallbackHtml("error", message);
  }
}
