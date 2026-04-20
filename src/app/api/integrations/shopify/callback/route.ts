import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { completeShopifyOAuth } from "@/modules/pos/service";
import {
  normaliseShopifyShopDomain,
  verifyShopifyOAuthHmac,
} from "@/providers/pos/shopify";

/**
 * Shopify OAuth callback.
 *
 * Shopify redirects to this endpoint with the querystring:
 *   shop, code, state, hmac, timestamp, host
 *
 * Security:
 *   - `hmac` is an HMAC-SHA256 of the other params, keyed by our
 *     client secret. MUST be verified before trusting any field.
 *     Without this, an attacker could craft a malicious ?shop=…
 *     and trick us into fetching an access token for their shop.
 *   - `state` is our anti-CSRF nonce; contains our integration id.
 *   - `shop` must end in `.myshopify.com` after normalisation.
 *
 * Response shape matches Square/Clover callbacks — an HTML page
 * that window.opener.postMessages the outcome + closes itself, or
 * falls through to a full-tab redirect if no opener is present.
 */
function renderCallbackHtml(outcome: "connected" | "error", reason?: string) {
  const query = outcome === "connected"
    ? "shopify=connected"
    : `shopify=error&reason=${encodeURIComponent(reason ?? "oauth_failed")}`;

  const safeOutcome = outcome === "connected" ? "connected" : "error";
  const safeReason = (reason ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>StockPilot — Connecting Shopify…</title>
<meta name="robots" content="noindex" />
<style>body{font-family:system-ui,sans-serif;background:#0b0b0d;color:#f5f5f5;margin:0;display:grid;place-items:center;min-height:100vh;text-align:center}main{padding:2rem}h1{font-size:1.1rem;font-weight:600;margin:0 0 .5rem}p{margin:0;opacity:.7;font-size:.9rem}</style>
</head>
<body>
<main>
  <h1>${outcome === "connected" ? "Shopify connected." : "Shopify connection failed."}</h1>
  <p>You can close this window.</p>
</main>
<script>
(function(){
  var outcome = ${JSON.stringify(safeOutcome)};
  var reason = ${JSON.stringify(safeReason)};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "stockpilot:shopify-oauth", outcome: outcome, reason: reason }, window.location.origin);
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
  const shopParam = url.searchParams.get("shop");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const integrationId = state?.split(".")[0];

  if (error) return renderCallbackHtml("error", error);

  if (!env.SHOPIFY_CLIENT_SECRET) {
    return renderCallbackHtml("error", "shopify_not_configured");
  }

  if (!verifyShopifyOAuthHmac(url.searchParams, env.SHOPIFY_CLIENT_SECRET)) {
    return renderCallbackHtml("error", "hmac_mismatch");
  }

  const shopDomain = normaliseShopifyShopDomain(shopParam);
  if (!shopDomain || !code || !state || !integrationId) {
    return renderCallbackHtml("error", "missing_params");
  }

  try {
    await completeShopifyOAuth({
      integrationId,
      state,
      code,
      shopDomain,
    });
    return renderCallbackHtml("connected");
  } catch (err) {
    return renderCallbackHtml(
      "error",
      err instanceof Error ? err.message : "oauth_failed"
    );
  }
}
