/**
 * Tiny CORS helper for the "StockPilot — Sign in helper" browser
 * extension. The extension's popup runs on a `chrome-extension://`
 * (or `moz-extension://`) origin and fetches StockPilot endpoints
 * with `credentials: "include"` so the session cookie goes along.
 *
 * To accept that with credentials, the response must echo the
 * exact Origin header (wildcards don't work with credentials) and
 * set `Access-Control-Allow-Credentials: true`. We intentionally
 * do NOT echo arbitrary web origins — only the two extension
 * schemes — so this doesn't open our APIs to random sites.
 */
import { NextResponse } from "next/server";

const ALLOWED_SCHEMES = ["chrome-extension://", "moz-extension://"];

export function isExtensionOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return ALLOWED_SCHEMES.some((s) => origin.startsWith(s));
}

export function extensionCorsHeaders(origin: string | null | undefined): Record<string, string> {
  if (!isExtensionOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin as string,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, accept",
    "Vary": "Origin",
  };
}

export function extensionOptionsResponse(request: Request): NextResponse {
  const origin = request.headers.get("origin");
  const headers = extensionCorsHeaders(origin);
  return new NextResponse(null, { status: 204, headers });
}

export function withExtensionCors<T>(
  request: Request,
  response: NextResponse<T>
): NextResponse<T> {
  const origin = request.headers.get("origin");
  const headers = extensionCorsHeaders(origin);
  for (const [k, v] of Object.entries(headers)) {
    response.headers.set(k, v);
  }
  return response;
}
